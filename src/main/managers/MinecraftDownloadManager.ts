import { MojangIndexProcessor, downloadQueue, getExpectedDownloadSize } from 'helios-core/dl'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'
import type { StepProgress } from '../../shared/launchProgress'
import type { VersionJson } from '../types/minecraft'

const logger = Logger.getLogger('MinecraftDownloadManager')

/** This manager's own sub-phases; `getPhaseDisplayName` turns them into the bar's header. */
export type DownloadPhase = 'init' | 'validation' | 'download' | 'complete'

export interface DownloadProgress extends StepProgress {
    phase: DownloadPhase
}

class MinecraftDownloadManager {

    /**
     * Downloads the vanilla client, libraries and assets for a version.
     *
     * @param progressCallback Receives `{ current, total, phase, message }`, the one
     * progress shape used across the launch flow. `phase` is this manager's own
     * sub-phase; the launch `type` is added by LaunchManager, which owns it.
     * @returns The Mojang version manifest, which carries the required Java major version
     * among other launch metadata.
     */
    static async downloadMinecraft(minecraftVersion: string, progressCallback?: (progress: DownloadProgress) => void): Promise<VersionJson> {
        try {
            logger.info('Starting Minecraft download for version:', minecraftVersion)

            const commonDir = ConfigManager.getCommonDirectory()

            const report = (current: number, phase: DownloadPhase, message: string) => {
                if (progressCallback) progressCallback({ current, total: 100, phase, message })
            }

            report(0, 'init', 'Preparando descarga...')

            const mojangProcessor = new MojangIndexProcessor(commonDir, minecraftVersion)
            await mojangProcessor.init()

            report(5, 'validation', 'Validando archivos...')

            const totalStages = mojangProcessor.totalStages()
            let completedStages = 0

            const dlObjects = await mojangProcessor.validate(async () => {
                completedStages++
                const stagePercent = 5 + Math.floor((completedStages / totalStages) * 5)
                report(stagePercent, 'validation', `Validando archivos... (${completedStages}/${totalStages})`)
            })

            // helios' own type leaves out `javaVersion`, which is what the launch reads from it.
            const versionJson = await mojangProcessor.getVersionJson() as unknown as VersionJson

            // Every group helios found invalid: assets, libraries, client and misc (the log
            // config), in that order. Its type is a plain record, so it is not read key by key.
            const allDownloads = Object.values(dlObjects).flat()

            const totalSize = getExpectedDownloadSize(allDownloads)

            logger.info('Total files to download:', allDownloads.length)

            if (allDownloads.length === 0) {
                report(100, 'complete', 'Archivos listos')
                return versionJson
            }

            report(10, 'download', 'Descargando archivos...')

            await downloadQueue(allDownloads, (received) => {
                const percent = 10 + Math.floor((received / totalSize) * 90)
                const mbDownloaded = (received / 1024 / 1024).toFixed(1)
                const mbTotal = (totalSize / 1024 / 1024).toFixed(1)

                report(percent, 'download', `Descargando... ${mbDownloaded} MB / ${mbTotal} MB`)
            })

            logger.info('All downloads completed successfully!')

            report(100, 'complete', 'Descarga completada')

            return versionJson
        } catch (err) {
            // MojangIndexProcessor reports in English and its messages reach the player
            // untouched. The original stays as the cause and in the log.
            logger.error('Minecraft download failed:', err)

            throw new LauncherError(
                ERROR_CODE.MC_DOWNLOAD_FAILED,
                `No se han podido descargar los archivos de Minecraft ${minecraftVersion}. ` +
                'Comprueba tu conexion e intentalo de nuevo.',
                err
            )
        }
    }

    /** Exactly the sub-phases `downloadMinecraft` reports, nothing it never emits. */
    static getPhaseDisplayName(phase: DownloadPhase): string {
        const phases: Record<DownloadPhase, string> = {
            init: 'Preparando Minecraft',
            validation: 'Validando Minecraft',
            download: 'Descargando Minecraft',
            complete: 'Minecraft listo'
        }
        return phases[phase] || 'Descargando Minecraft'
    }
}

export default MinecraftDownloadManager
