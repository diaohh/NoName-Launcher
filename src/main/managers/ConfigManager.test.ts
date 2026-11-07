import fs from 'fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ConfigManager from './ConfigManager'
import { createTempLauncher, type TempLauncher } from '../testing/tempLauncher'
import { safeStorageControl } from '../testing/electron'

const UUID = '069a79f444e94726a5befca90e38aaf5'

function addAccount() {
    ConfigManager.addMicrosoftAccount(
        UUID, 'mc-access-token', 'Notch', 'Notch', Date.now() + 3600_000,
        'ms-access-token', 'ms-refresh-token', Date.now() + 3600_000
    )
}

describe('ConfigManager', () => {
    let launcher: TempLauncher

    beforeEach(() => {
        launcher = createTempLauncher()
    })

    afterEach(() => {
        launcher.cleanup()
        safeStorageControl.reset()
    })

    describe('migration', () => {
        it('forgets the stored Java of a v1 config and stamps v2 on disk', async () => {
            launcher.writeConfig({
                version: 1,
                settings: { java: { executable: 'C:\\Java\\bin\\javaw.exe', maxRAM: '6G' } }
            })

            await ConfigManager.load()

            expect(ConfigManager.getJavaExecutable()).toBeNull()
            expect(ConfigManager.getMaxRAM()).toBe('6G')

            const disk = launcher.readConfig()
            expect(disk.version).toBe(2)
            expect(disk.settings.java.executable).toBeNull()
        })

        it('keeps the Java a v2 player picked by hand', async () => {
            launcher.writeConfig({
                version: 2,
                settings: { java: { executable: 'C:\\Java\\bin\\javaw.exe' } }
            })

            await ConfigManager.load()

            expect(ConfigManager.getJavaExecutable()).toBe('C:\\Java\\bin\\javaw.exe')
        })
    })

    it('repairs a wrong-typed key without resetting the rest of the file', async () => {
        launcher.writeConfig({
            version: 2,
            settings: {
                game: { resWidth: 'wide', resHeight: 900 },
                java: { runtimes: ['not', 'a', 'map'] }
            },
            selectedServer: 'my-pack'
        })

        await ConfigManager.load()

        expect(ConfigManager.getGameWidth()).toBe(1280)
        expect(ConfigManager.getGameHeight()).toBe(900)
        expect(ConfigManager.getJavaRuntimes()).toEqual({})
        expect(ConfigManager.getSelectedServer()).toBe('my-pack')
    })

    describe('credentials', () => {
        it('never writes a secret in the clear, and reads them back on load', async () => {
            addAccount()
            await ConfigManager.save()

            const raw = fs.readFileSync(launcher.configPath, 'utf-8')
            expect(raw).not.toContain('mc-access-token')
            expect(raw).not.toContain('ms-access-token')
            expect(raw).not.toContain('ms-refresh-token')
            expect(launcher.readConfig().authenticationDatabase[UUID].secrets).toEqual(expect.any(String))

            ConfigManager.config = ConfigManager.getDefaultConfig()
            await ConfigManager.load()

            const account = ConfigManager.getAccountByUUID(UUID)
            expect(account?.accessToken).toBe('mc-access-token')
            expect(account?.microsoft.access_token).toBe('ms-access-token')
            expect(account?.microsoft.refresh_token).toBe('ms-refresh-token')
            expect(ConfigManager.getSelectedAccount()).toBe(UUID)
        })

        it('does not persist the session at all when there is no keyring', async () => {
            safeStorageControl.available = false
            addAccount()

            await ConfigManager.save()

            const disk = launcher.readConfig()
            expect(disk.authenticationDatabase).toEqual({})
            expect(disk.selectedAccount).toBeNull()
            // Still signed in for this run.
            expect(ConfigManager.getAccountByUUID(UUID)).not.toBeNull()
        })

        it('costs only the session when the secrets cannot be decrypted', async () => {
            addAccount()
            ConfigManager.setMaxRAM('6G')
            await ConfigManager.save()

            safeStorageControl.undecryptable = true
            ConfigManager.config = ConfigManager.getDefaultConfig()
            await ConfigManager.load()

            expect(ConfigManager.getAuthenticationDatabase()).toEqual({})
            expect(ConfigManager.getSelectedAccount()).toBeNull()
            expect(ConfigManager.getMaxRAM()).toBe('6G')
            expect(launcher.readConfig().authenticationDatabase).toEqual({})
        })
    })

    it('never lets an earlier save land on top of a later one', async () => {
        addAccount()
        // The first save's encryption is the slow one, so unordered writes would finish
        // with the older config on disk.
        safeStorageControl.encryptDelaysMs = [50, 0]

        ConfigManager.setSelectedServer('first')
        const first = ConfigManager.save()
        ConfigManager.setSelectedServer('second')
        const second = ConfigManager.save()
        await Promise.all([first, second])

        expect(launcher.readConfig().selectedServer).toBe('second')
    })
})
