import fs from 'fs'
import os from 'os'
import path from 'path'
import ConfigManager from '../managers/ConfigManager'
import type { DiskConfig } from '../types/config'
import type { VersionJson } from '../types/minecraft'

export type TempLauncher = ReturnType<typeof createTempLauncher>

/**
 * Points `ConfigManager` at a fresh temporary launcher directory, on the default config.
 *
 * Every path the main process builds hangs off `ConfigManager` (ADR-0004), so this is all a
 * test needs to run the real managers against a disk of its own. Call it in `beforeEach` and
 * `cleanup()` in `afterEach`: `ConfigManager` is a static class, so state left behind by one
 * test is state the next one starts from.
 */
export function createTempLauncher() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nnl-test-'))
    const configPath = path.join(dir, 'config.json')

    ConfigManager.launcherDir = dir
    ConfigManager.dataDir = null
    ConfigManager.configPath = configPath
    ConfigManager.config = ConfigManager.getDefaultConfig()

    return {
        dir,
        configPath,

        /** Writes `config.json` as a previous launcher (or a player) would have left it. */
        writeConfig(config: unknown) {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4))
        },

        readConfig(): DiskConfig {
            return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        },

        /** Writes `common/versions/<id>/<id>.json`, the way the download step leaves it. */
        writeVersion(versionId: string, manifest: VersionJson) {
            const jsonPath = ConfigManager.getVersionJsonPath(versionId)
            fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
            fs.writeFileSync(jsonPath, JSON.stringify(manifest))
        },

        cleanup() {
            ConfigManager.launcherDir = null
            ConfigManager.dataDir = null
            ConfigManager.configPath = null
            ConfigManager.config = ConfigManager.getDefaultConfig()
            fs.rmSync(dir, { recursive: true, force: true })
        }
    }
}
