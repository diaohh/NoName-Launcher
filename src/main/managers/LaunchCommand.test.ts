import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import LaunchManager from './LaunchManager'
import ConfigManager from './ConfigManager'
import { createTempLauncher, type TempLauncher } from '../testing/tempLauncher'
import type { ModpackRam } from '../../shared/modpack'
import DistributionManager, { type SelectedServer } from './DistributionManager'

/** Mojang's name for the platform the tests run on, and one that is never it. */
const CURRENT_OS = ({ win32: 'windows', darwin: 'osx', linux: 'linux' } as Partial<Record<string, string>>)[process.platform]
const OTHER_OS = CURRENT_OS === 'windows' ? 'osx' : 'windows'

describe('LaunchManager.rulesAllow', () => {
    it('allows an entry with no rules', () => {
        expect(LaunchManager.rulesAllow(undefined)).toBe(true)
        expect(LaunchManager.rulesAllow([])).toBe(true)
    })

    it('starts disallowed once there are rules', () => {
        expect(LaunchManager.rulesAllow([{ action: 'allow', os: { name: OTHER_OS } }])).toBe(false)
    })

    it('lets the last matching rule win', () => {
        // lwjgl in 1.17-1.18: allow everywhere, then disallow one OS.
        expect(LaunchManager.rulesAllow([
            { action: 'allow' },
            { action: 'disallow', os: { name: CURRENT_OS } }
        ])).toBe(false)

        expect(LaunchManager.rulesAllow([
            { action: 'disallow', os: { name: CURRENT_OS } },
            { action: 'allow' }
        ])).toBe(true)
    })

    it('checks os.arch, not only os.name', () => {
        expect(LaunchManager.rulesAllow([{ action: 'allow', os: { name: CURRENT_OS, arch: 'sparc' } }])).toBe(false)
    })

    it('honours only the features the launcher has', () => {
        expect(LaunchManager.rulesAllow([{ action: 'allow', features: { has_custom_resolution: true } }])).toBe(true)
        expect(LaunchManager.rulesAllow([{ action: 'allow', features: { is_demo_user: true } }])).toBe(false)
    })
})

describe('LaunchManager.buildLaunchCommand', () => {
    const VANILLA = '1.20.1'
    const FABRIC = 'fabric-loader-0.16.0-1.20.1'
    const account = { displayName: 'Notch', uuid: '069a79f444e94726a5befca90e38aaf5', accessToken: 'mc-access-token' }

    let launcher: TempLauncher

    beforeEach(() => {
        launcher = createTempLauncher()

        launcher.writeVersion(VANILLA, {
            id: VANILLA,
            type: 'release',
            mainClass: 'net.minecraft.client.main.Main',
            assetIndex: { id: '5' },
            libraries: [
                { name: 'org.ow2.asm:asm:9.3', downloads: { artifact: { path: 'org/ow2/asm/asm/9.3/asm-9.3.jar' } } },
                { name: 'com.mojang:brigadier:1.1.8', downloads: { artifact: { path: 'com/mojang/brigadier/1.1.8/brigadier-1.1.8.jar' } } }
            ],
            arguments: {
                jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
                game: [
                    '--username', '${auth_player_name}',
                    '--version', '${version_name}',
                    '--clientId', '${clientid}',
                    '--xuid', '${auth_xuid}',
                    { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' },
                    {
                        rules: [{ action: 'allow', features: { has_custom_resolution: true } }],
                        value: ['--width', '${resolution_width}', '--height', '${resolution_height}']
                    }
                ]
            }
        })

        launcher.writeVersion(FABRIC, {
            id: FABRIC,
            inheritsFrom: VANILLA,
            mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
            libraries: [{ name: 'org.ow2.asm:asm:9.6', url: 'https://maven.fabricmc.net/' }],
            arguments: { game: [], jvm: [] }
        })
    })

    afterEach(() => {
        launcher.cleanup()
    })

    const librariesDir = () => path.join(ConfigManager.getCommonDirectory(), 'libraries')
    const classpathOf = (args: string[]) => (args[args.indexOf('-cp') + 1] ?? '').split(path.delimiter)

    it('drops a placeholder with no value together with its --flag', async () => {
        const args = await LaunchManager.buildLaunchCommand(account, FABRIC, null)

        expect(args).toContain('--username')
        expect(args[args.indexOf('--username') + 1]).toBe('Notch')
        expect(args).not.toContain('--clientId')
        expect(args).not.toContain('--xuid')
        expect(args.some(arg => arg.includes('${'))).toBe(false)
        expect(args).not.toContain('--demo')
    })

    it('keeps one copy of each library on the classpath, the loader\'s', async () => {
        const classpath = classpathOf(await LaunchManager.buildLaunchCommand(account, FABRIC, null))

        expect(classpath).toContain(path.join(librariesDir(), 'org', 'ow2', 'asm', 'asm', '9.6', 'asm-9.6.jar'))
        expect(classpath.some(entry => entry.endsWith('asm-9.3.jar'))).toBe(false)
        expect(classpath.some(entry => entry.endsWith('brigadier-1.1.8.jar'))).toBe(true)
        // The client jar belongs to the vanilla version, not to the loader profile.
        expect(classpath.at(-1)).toBe(path.join(ConfigManager.getVersionDirectory(VANILLA), `${VANILLA}.jar`))
    })

    describe('resolution', () => {
        const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

        it('opens a window at the size in Ajustes', async () => {
            // Fullscreen is the default, so windowed has to be asked for.
            ConfigManager.setFullscreen(false)

            const args = await LaunchManager.buildLaunchCommand(account, FABRIC, null)

            expect(valueAfter(args, '--width')).toBe(String(ConfigManager.getGameWidth()))
            expect(valueAfter(args, '--height')).toBe(String(ConfigManager.getGameHeight()))
            expect(args).not.toContain('--fullscreen')
        })

        it('asks for the monitor\'s own mode in fullscreen, so it never switches video mode', async () => {
            ConfigManager.setFullscreen(true)

            const args = await LaunchManager.buildLaunchCommand(account, FABRIC, null)

            // Physical pixels, except on macOS, where GLFW counts in points.
            const [width, height] = process.platform === 'darwin' ? ['1536', '864'] : ['1920', '1080']
            expect(valueAfter(args, '--width')).toBe(width)
            expect(valueAfter(args, '--height')).toBe(height)
            expect(args).toContain('--fullscreen')
        })
    })

    describe('RAM', () => {
        const server = (java: ModpackRam): SelectedServer => ({
            rawServer: { id: DistributionManager.parseModpackId('my-pack'), name: 'My pack', maintenance: false, maintenanceMessage: null, manifest: null, java }
        })

        it('uses the modpack\'s allocation by default', async () => {
            const args = await LaunchManager.buildLaunchCommand(account, FABRIC, server({ maxRam: '6G', minRam: '3G' }))

            expect(args.slice(0, 2)).toEqual(['-Xmx6G', '-Xms3G'])
        })

        it('uses the launcher\'s setting when the player turns the modpack\'s off', async () => {
            ConfigManager.setUseModpackRam(false)

            const args = await LaunchManager.buildLaunchCommand(account, FABRIC, server({ maxRam: '6G', minRam: '3G' }))

            expect(args.slice(0, 2)).toEqual(['-Xmx4G', '-Xms2G'])
        })

        it('never lets a modpack\'s floor rise above its ceiling', async () => {
            const args = await LaunchManager.buildLaunchCommand(account, FABRIC, server({ maxRam: '2G', minRam: '3G' }))

            expect(args.slice(0, 2)).toEqual(['-Xmx2G', '-Xms2G'])
        })
    })
})
