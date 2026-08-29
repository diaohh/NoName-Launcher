import { MojangIndexProcessor, downloadQueue, getExpectedDownloadSize } from 'helios-core/dl'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'
import { ERROR_CODE } from '../../shared/errorCodes'

const logger = Logger.getLogger('MinecraftDownloadManager')

class MinecraftDownloadManager {

    /**
     * Downloads the vanilla client, libraries and assets for a version.
     *
     * @param progressCallback Receives `{ current, total, phase, message }`, the one
     * progress shape used across the launch flow. `phase` is this manager's own
     * sub-phase; the launch `type` is added by LaunchManager, which owns it.
     * @returns {Promise<object>} The Mojang version manifest, which carries the
     * required Java major version among other launch metadata.
     */
    static async downloadMinecraft(minecraftVersion, progressCallback) {
        try {
            logger.info('Starting Minecraft download for version:', minecraftVersion)

            const commonDir = ConfigManager.getCommonDirectory()

            const report = (current, phase, message) => {
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

            const versionJson = await mojangProcessor.getVersionJson()

            const allDownloads = [
                ...dlObjects.assets,
                ...dlObjects.libraries,
                ...dlObjects.client,
                ...dlObjects.misc
            ]

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

            const error = new Error(
                `No se han podido descargar los archivos de Minecraft ${minecraftVersion}. ` +
                'Comprueba tu conexion e intentalo de nuevo.'
            )
            error.code = ERROR_CODE.MC_DOWNLOAD_FAILED
            error.cause = err
            throw error
        }
    }

    static getPhaseDisplayName(phase) {
        const phases = {
            'init': 'Inicializando',
            'validation': 'Validando archivos',
            'assets': 'Descargando recursos',
            'libraries': 'Descargando librerias',
            'client': 'Descargando cliente',
            'complete': 'Completado'
        }
        return phases[phase] || 'Descargando...'
    }
}

export default MinecraftDownloadManager
