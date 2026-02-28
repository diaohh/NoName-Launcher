import { FullRepair } from 'helios-core/dl'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'

const logger = Logger.getLogger('DownloadManager')

class DownloadManager {

    static async downloadServerFiles(server, progressCallback) {
        try {
            logger.info('Starting download process for server:', server.rawServer.name)

            const commonDir = ConfigManager.getCommonDirectory()
            const instanceDir = ConfigManager.getInstanceDirectory()
            const launcherDir = ConfigManager.getLauncherDirectory()
            const serverId = server.rawServer.id
            const devMode = process.env.DISTRIBUTION_DEV_MODE === 'true'

            const fullRepair = new FullRepair(commonDir, instanceDir, launcherDir, serverId, devMode)

            fullRepair.spawnReceiver()

            fullRepair.childProcess.on('error', (err) => {
                logger.error('Receiver process error:', err)
            })

            fullRepair.childProcess.on('exit', (code, signal) => {
                logger.info(`Receiver process exited with code ${code}, signal ${signal}`)
            })

            if (progressCallback) {
                progressCallback(0, 'validation', 'Validando archivos...')
            }

            const invalidCount = await fullRepair.verifyFiles((percent) => {
                if (progressCallback) {
                    progressCallback(percent * 0.3, 'validation', `Validando archivos... ${percent}%`)
                }
            })

            logger.info(`Validation complete. ${invalidCount} files need download`)

            if (invalidCount > 0) {
                if (progressCallback) {
                    progressCallback(30, 'download', `Descargando ${invalidCount} archivos...`)
                }

                try {
                    await fullRepair.download((percent) => {
                        const adjustedPercent = 30 + (percent * 0.7)
                        if (progressCallback) {
                            progressCallback(adjustedPercent, 'download', `Descargando... ${percent}%`)
                        }
                    })
                } catch (downloadErr) {
                    try { fullRepair.destroyReceiver() } catch (_) {}
                    throw new Error(`Download failed: ${JSON.stringify(downloadErr)}`)
                }
            }

            fullRepair.destroyReceiver()

            if (progressCallback) {
                progressCallback(100, 'complete', 'Descarga completada')
            }

            return true
        } catch (err) {
            logger.error('Download failed:', err)
            throw err
        }
    }

    static getPhaseDisplayName(phase) {
        const phases = {
            'init': 'Inicializando',
            'version': 'Descargando version de Minecraft',
            'assets': 'Descargando recursos (assets)',
            'libraries': 'Descargando librerias',
            'client': 'Descargando cliente de Minecraft',
            'mods': 'Descargando mods',
            'complete': 'Completado'
        }
        return phases[phase] || 'Descargando...'
    }
}

export default DownloadManager
