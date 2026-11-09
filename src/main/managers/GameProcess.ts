import child_process, { type ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs-extra'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'
import { readLines } from '../utils/GameOutput'
import { createStartupTracker, type StartupTracker } from '../utils/StartupTracker'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'
import { isPlainObject } from '../../shared/guards'
import type { ExitEvent, GameOutputEvent, GameStartupEvent, StartedEvent } from '../../shared/launchProgress'
import type { LaunchStatus } from '../../shared/ipcContract'

const logger = Logger.getLogger('GameProcess')

/** What the running game reports, from the spawn to its exit. Its own events, not phases. */
export type GameEvent = StartedEvent | GameStartupEvent | GameOutputEvent | ExitEvent

/** What `running-game.json` records between the spawn and `close`. */
export interface RunningGame {
    pid: number
    gameDir: string
}

/** PowerShell's first start on a cold machine is slow; past this the orphan check gives way. */
const ORPHAN_CHECK_TIMEOUT_MS = 15 * 1000

/**
 * The game once it is spawned: its process, its output, the startup bar, and the record that
 * lets the next session know it is still running. The game outlives the launcher (ADR-0013).
 *
 * `gameProcess` is the lock once the game is up; `LaunchManager.launchInProgress` is the one
 * before it.
 */
class GameProcess {

    static gameProcess: ChildProcess | null = null

    /** Drives the second progress bar while the game starts up; null once it has exited. */
    static startupTracker: StartupTracker | null = null

    /**
     * Spawns the game and wires it up until it exits.
     *
     * @returns The PID, once the OS has actually started the process.
     * @throws {LauncherError} GAME_SPAWN_FAILED
     */
    static async start(javaPath: string, args: string[], gameDir: string, report: (event: GameEvent) => void): Promise<number> {
        const normalizedJavaPath = path.normalize(javaPath)
        // Detached, so the game outlives the launcher (ADR-0013). Without it Windows puts
        // the child in libuv's kill-on-close job object, and closing the launcher killed
        // the game with everything that had not been saved. `windowsHide` stays off: it
        // reaches the JVM as the show flag of its first window, which is the game's own.
        const child = child_process.spawn(normalizedJavaPath, args, {
            cwd: gameDir, detached: true, windowsHide: false
        })

        // `spawn` returns before the OS has tried to start anything; a missing javaw only
        // shows up afterwards as an `error` event. Waiting here keeps `started` honest and
        // lets a failure take the same path as every other launch error.
        await this.waitForSpawn(child, normalizedJavaPath)

        // Only undefined when the spawn failed, and `waitForSpawn` has rejected in that case.
        const pid = child.pid as number

        this.gameProcess = child
        this.recordRunningGame(pid, gameDir)
        logger.info('Minecraft process started, PID:', pid)
        report({ type: 'started', message: 'Minecraft iniciado correctamente', pid })

        // The second bar: `started` only means the OS started the JVM, and the window
        // takes a while longer. Created after `started` so its first report lands after it.
        this.startupTracker = createStartupTracker((progress) => {
            report({ type: 'game_startup', ...progress })
        })

        const forward = (type: 'stdout' | 'stderr') => (lines: string[]) => {
            this.startupTracker?.feed(lines)
            report({ type, lines })
        }
        const flushStdout = readLines(child.stdout, forward('stdout'))
        const flushStderr = readLines(child.stderr, forward('stderr'))

        child.on('close', (code) => {
            flushStdout()
            flushStderr()
            // The latch goes with the process: the next game starts its bar from zero.
            this.startupTracker?.dispose()
            this.startupTracker = null
            this.gameProcess = null
            this.clearRunningGame()
            report({ type: 'exit', code })
        })

        // Once running, `error` only means a signal could not be delivered: the process is
        // still there, and `close` remains the one place that ends the game.
        child.on('error', (err) => {
            logger.error('Minecraft process error:', err)
        })

        return pid
    }

    /**
     * Resolves once the OS has started the process, or rejects with GAME_SPAWN_FAILED when it
     * could not (ENOENT, EACCES). Node still emits `close` after a failed spawn, which is why
     * `start` attaches its own `close` handler only after this resolves.
     */
    static waitForSpawn(child: ChildProcess, javaPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const onSpawn = () => {
                child.off('error', onError)
                resolve()
            }
            const onError = (err: Error) => {
                child.off('spawn', onSpawn)
                reject(new LauncherError(
                    ERROR_CODE.GAME_SPAWN_FAILED,
                    `No se ha podido iniciar Java (${javaPath}). ` +
                    'Comprueba la ruta de Java en Ajustes, o quitala para que el launcher busque uno.',
                    err
                ))
            }
            child.once('spawn', onSpawn)
            child.once('error', onError)
        })
    }

    /**
     * Asks the game to close. The `close` handler stays the only place that clears
     * `gameProcess`: nulling it here would tell `config:setDataDirectory` that no game is
     * running while the JVM is still shutting down with files open in the instance.
     */
    static killGame(): boolean {
        if (!this.gameProcess) return false

        logger.info('Killing Minecraft, PID:', this.gameProcess.pid)
        this.gameProcess.kill()
        return true
    }

    /**
     * Lets go of the game when the launcher quits. It was spawned detached, so it keeps
     * running; what goes are the pipes and the handle, which would otherwise hold the event
     * loop open. Java swallows the broken pipe (`PrintStream` only sets its error flag), which
     * was measured with a JVM writing to both streams after its parent exited.
     *
     * `running-game.json` stays on disk: it is what stops the next session from starting a
     * second game on top of this one (see `findOrphanGame`).
     */
    static releaseGame(): void {
        const child = this.gameProcess
        if (!child) return

        logger.info(`Launcher quitting, leaving Minecraft running (PID ${child.pid})`)
        this.startupTracker?.dispose()
        this.startupTracker = null
        child.removeAllListeners('close')
        child.stdout?.destroy()
        child.stderr?.destroy()
        child.unref()
    }

    /**
     * True while this launcher has a game running, or one survives from a previous session.
     * What `config:setDataDirectory` checks before moving the root out from under it.
     */
    static async isGameRunning(): Promise<boolean> {
        return this.gameProcess != null || await this.findOrphanGame() != null
    }

    static recordRunningGame(pid: number, gameDir: string): void {
        try {
            fs.writeJsonSync(ConfigManager.getRunningGamePath(), { pid, gameDir, startedAt: Date.now() })
        } catch (err) {
            // Only the guard against a second game after a relaunch is lost.
            logger.warn('Could not record the running game', err)
        }
    }

    static clearRunningGame(): void {
        try {
            fs.removeSync(ConfigManager.getRunningGamePath())
        } catch (err) {
            logger.warn('Could not clear the running game record', err)
        }
    }

    /**
     * The game a previous launcher session left running, or null.
     *
     * A PID alone proves nothing once its process is gone: the OS hands the number out again,
     * and refusing to launch because some unrelated program inherited it would block the player
     * for no reason. So the process must also carry the instance directory on its command line,
     * which only a Minecraft started by this launcher does (`--gameDir`). A record that fails
     * either check is stale and deleted. When the command line cannot be read at all the guard
     * gives way rather than block: the cost is the behaviour from before it existed.
     */
    static async findOrphanGame(): Promise<RunningGame | null> {
        let record: unknown
        try {
            record = fs.readJsonSync(ConfigManager.getRunningGamePath())
        } catch {
            return null
        }

        // The PID is interpolated into a PowerShell command by `readCommandLine`, so it is
        // checked to be a positive integer before anything else touches it.
        const pid = isPlainObject(record) ? record.pid : undefined
        const gameDir = isPlainObject(record) ? record.gameDir : undefined
        if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && typeof gameDir === 'string' && this.isProcessAlive(pid)) {
            const commandLine = await this.readCommandLine(pid)
            if (commandLine?.includes(gameDir)) {
                logger.info(`Minecraft from a previous session is still running (PID ${pid})`)
                return { pid, gameDir }
            }
        }

        this.clearRunningGame()
        return null
    }

    static isProcessAlive(pid: number): boolean {
        try {
            process.kill(pid, 0)
            return true
        } catch (err) {
            // EPERM: it exists, it just belongs to someone else.
            return (err as NodeJS.ErrnoException).code === 'EPERM'
        }
    }

    /** The full command line of a process, or null when it cannot be read. */
    static readCommandLine(pid: number): Promise<string | null> {
        const [file, args]: [string, string[]] = process.platform === 'win32'
            ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]]
            : ['ps', ['-p', String(pid), '-o', 'args=']]

        return new Promise((resolve) => {
            child_process.execFile(file, args, { timeout: ORPHAN_CHECK_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
                if (err) {
                    logger.warn(`Could not read the command line of PID ${pid}`, err)
                    resolve(null)
                    return
                }
                resolve(stdout)
            })
        })
    }

    /**
     * Lets the renderer rebuild its state after a reload: without it a refresh during a
     * game leaves the UI believing nothing is running, and the kill button never appears.
     */
    static getStatus(): LaunchStatus {
        return {
            running: this.gameProcess != null,
            pid: this.gameProcess?.pid ?? null
        }
    }
}

export default GameProcess
