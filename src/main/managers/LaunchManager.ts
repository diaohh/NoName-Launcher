import path from 'path'
import fs from 'fs-extra'
import AuthManager from './AuthManager'
import DistributionManager from './DistributionManager'
import GameProcess from './GameProcess'
import JavaManager from './JavaManager'
import LaunchCommand from './LaunchCommand'
import ManifestManager from './ManifestManager'
import ModLoaderManager from './ModLoaderManager'
import MinecraftDownloadManager from './MinecraftDownloadManager'
import Logger from '../utils/Logger'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError, errorCodeOf } from '../../shared/LauncherError'
import type { LaunchProgress } from '../../shared/launchProgress'
import type { LaunchStarted } from '../../shared/ipcContract'

const logger = Logger.getLogger('LaunchManager')

type ProgressCallback = (progress: LaunchProgress) => void

// Minecraft 1.17 introduced the `arguments` manifest format and stopped shipping
// natives as library classifiers. Older releases would need a separate code path.
const MIN_SUPPORTED_MINOR = 17

/**
 * The launch flow, from validating the account to the spawned game, and the lock that keeps it
 * to one at a time. Each step is someone else's: the instance sync (`DistributionManager`),
 * Java (`JavaManager`), the command line (`LaunchCommand`) and the running game (`GameProcess`).
 *
 * One progress shape for the whole flow: every callback in the chain takes a single object,
 * `{ current, total, message }`. The managers underneath report only their own numbers — they
 * have no idea which launch phase they are being run for. LaunchManager is the one layer that
 * knows, so it is the one that adds `type`, and `type` is what LaunchContext switches on. The
 * exceptions are Java's own sub-phases and the game's lifecycle events (ADR-0005 addendum).
 */
class LaunchManager {

    /**
     * Held for the length of the preparation, which is everything up to the spawn. Once the
     * game is up `GameProcess.gameProcess` is the lock; between the two there is nothing else,
     * and two concurrent flows would sync the same instance directory against each other and
     * leave the first process orphaned when the second overwrote `gameProcess`.
     */
    static launchInProgress = false

    static assertSupportedVersion(minecraftVersion: string): void {
        const [major, minor] = minecraftVersion.split('.').map(part => parseInt(part))

        if (major === 1 && minor !== undefined && minor < MIN_SUPPORTED_MINOR) {
            throw new LauncherError(
                ERROR_CODE.UNSUPPORTED_MC_VERSION,
                `Minecraft ${minecraftVersion} no es compatible con este launcher. ` +
                `Solo se admiten versiones 1.${MIN_SUPPORTED_MINOR} o superiores.`
            )
        }
    }

    static async launchMinecraft(progressCallback?: ProgressCallback): Promise<LaunchStarted> {
        // Checked before the try, and deliberately not reported through `progressCallback`:
        // an `{type:'error'}` event here would drive LaunchContext into its error state and
        // tear down the UI of the launch that is actually running.
        if (this.launchInProgress || GameProcess.gameProcess != null) {
            logger.warn('Refused a concurrent launch')
            throw new LauncherError(ERROR_CODE.LAUNCH_ALREADY_RUNNING, 'Ya hay un lanzamiento en curso o Minecraft ya esta abierto.')
        }

        this.launchInProgress = true

        try {
            // The game outlives the launcher, so one may still be running from a previous
            // session that this process knows nothing about. Syncing the instance under it
            // would rewrite jars it has open; starting a second one would fight over saves.
            const orphan = await GameProcess.findOrphanGame()
            if (orphan) {
                throw new LauncherError(
                    ERROR_CODE.LAUNCH_ALREADY_RUNNING,
                    'Minecraft sigue abierto desde una sesion anterior del launcher. Cierralo antes de volver a jugar.'
                )
            }

            if (progressCallback) progressCallback({ type: 'auth', message: 'Validando cuenta...' })

            const validation = await AuthManager.validateSelectedMicrosoftAccount()
            if (!validation.ok) {
                // The renderer decides whether to bounce the player to the login screen
                // from `code`, not from this text, so a recoverable failure can keep its
                // own message: a network blip must not read like a dead session.
                throw new LauncherError(
                    validation.code,
                    AuthManager.isTerminalError(validation.code)
                        ? 'Tu sesion ha caducado. Vuelve a iniciar sesion.'
                        : validation.message
                )
            }

            const account = AuthManager.getSelectedAccount()
            if (!account) {
                throw new LauncherError(ERROR_CODE.AUTH_NO_ACCOUNT, 'No hay ninguna cuenta iniciada. Inicia sesion con Microsoft.')
            }

            const server = DistributionManager.getSelectedServer()
            if (!server) {
                throw new LauncherError(ERROR_CODE.LAUNCH_NO_SERVER, 'No hay ningun modpack seleccionado.')
            }

            // The renderer re-reads the modpack document right before launching, so this
            // is the current value, not whatever was cached when the list was loaded.
            if (server.rawServer.maintenance) {
                throw new LauncherError(
                    ERROR_CODE.MODPACK_MAINTENANCE,
                    server.rawServer.maintenanceMessage
                    || 'El modpack esta en mantenimiento. Intentalo de nuevo en unos minutos.'
                )
            }

            logger.info('Launching server:', server.rawServer.name)

            if (progressCallback) progressCallback({ type: 'manifest', message: 'Descargando manifest del modpack...' })
            const { manifest, baseUrl } = await ManifestManager.fetch(server.rawServer.manifest)

            // The manifest is authoritative for launching; the Firestore field of the
            // same name exists only so the sidebar can show a version without fetching it.
            const minecraftVersion = manifest.minecraft.version
            this.assertSupportedVersion(minecraftVersion)

            if (progressCallback) progressCallback({ type: 'validation', message: 'Validando archivos del modpack...' })

            const plan = await DistributionManager.planSync(server, manifest, (progress) => {
                if (progressCallback) progressCallback({ type: 'validation', ...progress })
            })

            if (plan.toDownload.length > 0 || plan.toDelete.length > 0) {
                if (progressCallback) {
                    progressCallback({
                        type: 'download_mods',
                        message: `Actualizando modpack: ${plan.toDownload.length} archivos nuevos, ${plan.toDelete.length} obsoletos...`
                    })
                }
            }

            await DistributionManager.applySync(server, manifest, baseUrl, plan, (progress) => {
                if (progressCallback) progressCallback({ type: 'download_mods', ...progress })
            })

            if (progressCallback) progressCallback({ type: 'download', message: 'Preparando descarga de Minecraft...' })

            const vanillaManifest = await MinecraftDownloadManager.downloadMinecraft(minecraftVersion, (progress) => {
                if (progressCallback) {
                    progressCallback({
                        ...progress,
                        type: 'download',
                        phase: MinecraftDownloadManager.getPhaseDisplayName(progress.phase)
                    })
                }
            })

            // Java must be available before the mod loader step: the Forge installer runs on a JVM.
            if (progressCallback) progressCallback({ type: 'java', message: 'Validando Java...' })

            const requiredJavaVersion = JavaManager.getRequiredJavaVersion(minecraftVersion, vanillaManifest)
            const javaPath = await JavaManager.ensureJava(requiredJavaVersion, progressCallback)

            const loader = manifest.loader
            const loaderType = ModLoaderManager.detectModLoader(loader)
            const versionString = ModLoaderManager.getVersionString(loader, minecraftVersion)
            const instanceDir = DistributionManager.getInstanceDir(server)

            if (loaderType !== 'vanilla') {
                if (!ModLoaderManager.isModLoaderInstalled(loader, minecraftVersion)) {
                    if (progressCallback) progressCallback({ type: 'modloader', message: `Instalando ${loaderType}...` })
                    await ModLoaderManager.installModLoader(loader, minecraftVersion, javaPath, instanceDir, (progress) => {
                        if (progressCallback) progressCallback({ type: 'modloader', ...progress })
                    })
                }

                // Its own phase, not `download`: the vanilla download already used that
                // one earlier in the flow, and a phase that appears twice makes the
                // progress bar run backwards.
                if (progressCallback) progressCallback({ type: 'download_libraries', message: `Descargando librerias de ${loaderType}...` })
                await LaunchCommand.downloadModLoaderLibraries(versionString, (progress) => {
                    if (progressCallback) progressCallback({ type: 'download_libraries', ...progress })
                })
            }

            if (progressCallback) progressCallback({ type: 'launch', message: 'Construyendo comando de lanzamiento...' })

            const args = await LaunchCommand.buildLaunchCommand(account, versionString, server)

            if (progressCallback) progressCallback({ type: 'launch', message: 'Iniciando Minecraft...' })

            await fs.ensureDir(instanceDir)
            await fs.ensureDir(path.join(instanceDir, 'natives'))

            const pid = await GameProcess.start(javaPath, args, instanceDir, (event) => {
                if (progressCallback) progressCallback(event)
            })

            return { pid }
        } catch (err) {
            logger.error('Launch failed:', err)
            if (progressCallback) {
                // The same code the IPC envelope gives the rejection (`errorCodeOf`), so the
                // event and the failed `launch:game` call never disagree.
                progressCallback({ type: 'error', error: err instanceof Error ? err.message : String(err), code: errorCodeOf(err) })
            }
            throw err
        } finally {
            this.launchInProgress = false
        }
    }
}

export default LaunchManager
