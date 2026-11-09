import type { StartupProgress } from '../../shared/launchProgress'

export interface StartupMilestone {
    pattern: RegExp
    percent: number
    message: string
}

/**
 * Lines Minecraft prints on its way to the title screen, in the order they normally appear,
 * and where each one puts the startup bar.
 *
 * Heuristic by nature. The log format moves with the loader, the Minecraft version and the
 * mods, so a milestone that never matches is expected: the bar simply skips that step. The
 * percentages are rough weights, not measurements, and the table was written against Fabric
 * on 1.20.x logs — it only gets calibrated for real by launching the modpacks being shipped.
 * Each pattern is tested against one whole line (see `readLines`).
 */
export const STARTUP_MILESTONES: readonly StartupMilestone[] = [
    { pattern: /Loading Minecraft \S+ with Fabric Loader/, percent: 5, message: 'Cargando Fabric Loader...' },
    { pattern: /Loading \d+ mods:/, percent: 10, message: 'Cargando mods...' },
    // "188 Datafixer optimizations took 361 milliseconds" since 1.20; "Building optimized
    // datafixer" before.
    { pattern: /Datafixer optimizations took|Building (un)?optimized datafixer/i, percent: 20, message: 'Preparando los datos del juego...' },
    { pattern: /Setting user: /, percent: 30, message: 'Iniciando el cliente...' },
    { pattern: /Backend library: LWJGL/, percent: 40, message: 'Creando la ventana...' },
    { pattern: /Reloading ResourceManager:/, percent: 50, message: 'Cargando recursos...' },
    { pattern: /OpenAL initialized|Sound engine started/, percent: 75, message: 'Iniciando el sonido...' },
    { pattern: /Created: \d+x\d+x\d+ minecraft:textures\/atlas\/blocks\.png-atlas/, percent: 85, message: 'Cargando texturas...' }
]

/**
 * Nothing in the log says "the title screen is up". Once the late milestones have been seen,
 * a few seconds without a new line is taken to mean the resource reload is over.
 */
const SETTLE_FROM_PERCENT = 75
const SETTLE_MS = 4000

/**
 * A log the table does not recognise at all must not leave the bar up forever. Past this the
 * bar is closed regardless: a modded first start can take minutes, but not this many.
 */
const GIVE_UP_MS = 3 * 60 * 1000

/**
 * Turns the game's output into progress for the startup bar.
 *
 * `report` receives `{ current, total, message, done }`. `current` is null until the first
 * milestone is recognised, which the renderer shows as an indeterminate bar — the honest
 * answer while nothing has been understood yet. `done` is sent exactly once; after it, the
 * tracker ignores everything, which is the latch that keeps gameplay output from moving it.
 *
 * `dispose` stops the timers without reporting; call it when the game exits or the launcher
 * lets go of it.
 */
export function createStartupTracker(report: (progress: StartupProgress) => void): StartupTracker {
    let percent: number | null = null
    let done = false
    let settleTimer: NodeJS.Timeout | undefined

    const dispose = () => {
        clearTimeout(giveUpTimer)
        clearTimeout(settleTimer)
    }

    const finish = (message: string) => {
        if (done) return
        done = true
        dispose()
        report({ current: 100, total: 100, message, done: true })
    }

    const giveUpTimer = setTimeout(() => finish('Minecraft deberia estar abierto'), GIVE_UP_MS)

    report({ current: null, total: 0, message: 'Arrancando Java...', done: false })

    const feed = (lines: string[]) => {
        if (done) return

        for (const line of lines) {
            // Only forward: a milestone printed out of order never pulls the bar back.
            const milestone = STARTUP_MILESTONES.find(m => m.percent > (percent ?? -1) && m.pattern.test(line))
            if (!milestone) continue

            percent = milestone.percent
            report({ current: percent, total: 100, message: milestone.message, done: false })
        }

        if (percent != null && percent >= SETTLE_FROM_PERCENT) {
            clearTimeout(settleTimer)
            settleTimer = setTimeout(() => finish('Minecraft listo'), SETTLE_MS)
        }
    }

    return { feed, dispose }
}

export interface StartupTracker {
    feed: (lines: string[]) => void
    dispose: () => void
}
