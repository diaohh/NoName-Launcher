import { MojangIndexProcessor, downloadQueue, getExpectedDownloadSize } from 'helios-core/dl'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'

const logger = Logger.getLogger('MinecraftDownloadManager')

class MinecraftDownloadManager {

    static async downloadMinecraft(minecraftVersion, progressCallback) {
        try {
            logger.info('Starting Minecraft download for version:', minecraftVersion)

            const commonDir = ConfigManager.getCommonDirectory()

            if (progressCallback) {
                progressCallback(0, 'init', 'Preparando descarga...')
            }

            const mojangProcessor = new MojangIndexProcessor(commonDir, minecraftVersion)
            await mojangProcessor.init()

            if (progressCallback) {
                progressCallback(5, 'validation', 'Validando archivos...')
            }

            const dlObjects = await mojangProcessor.validate(async () => {})

            const allDownloads = [
                ...dlObjects.assets,
                ...dlObjects.libraries,
                ...dlObjects.client,
                ...dlObjects.misc
            ]

            const totalSize = getExpectedDownloadSize(allDownloads)

            logger.info('Total files to download:', allDownloads.length)

            if (allDownloads.length === 0) {
                if (progressCallback) {
                    progressCallback(100, 'complete', 'Archivos listos')
                }
                return true
            }

            if (progressCallback) {
                progressCallback(10, 'download', 'Descargando archivos...')
            }

            await downloadQueue(allDownloads, (received) => {
                const percent = 10 + Math.floor((received / totalSize) * 90)
                const mbDownloaded = (received / 1024 / 1024).toFixed(1)
                const mbTotal = (totalSize / 1024 / 1024).toFixed(1)

                if (progressCallback) {
                    progressCallback(percent, 'download', `Descargando... ${mbDownloaded} MB / ${mbTotal} MB`)
                }
            })

            logger.info('All downloads completed successfully!')

            if (progressCallback) {
                progressCallback(100, 'complete', 'Descarga completada')
            }

            return true
        } catch (err) {
            logger.error('Minecraft download failed:', err)
            throw err
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
