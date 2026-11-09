import fs from 'fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ManifestManager from './ManifestManager'
import DistributionManager from './DistributionManager'
import { createTempLauncher, type TempLauncher } from '../testing/tempLauncher'
import { ERROR_CODE } from '../../shared/errorCodes'
import type { Sha256Hex } from '../../shared/guards'

const MANIFEST_URL = 'https://cdn.example/pack/manifest.json'
const SHA256 = 'a'.repeat(64)

/** A manifest that passes `assertShape`, with one file whose hash the test chooses. */
function manifestWithFileHash(hash: unknown) {
    return { formatVersion: 1, minecraft: { version: '1.20.1' }, files: [{ path: 'mods/a.jar', hash, size: 1 }] }
}

// The pointer's hash names the manifest cache file, which `fetch` deletes when its content
// does not match: an unchecked `"../config"` used to cost the player their config.json.
describe('manifest hashes', () => {
    let launcher: TempLauncher

    beforeEach(() => {
        launcher = createTempLauncher()
        launcher.writeConfig({})
    })

    afterEach(() => launcher.cleanup())

    it('never turns a pointer hash that is not a sha256 into a path', async () => {
        // The type already refuses it; the cast stands for whatever gets past the type.
        await expect(ManifestManager.fetch({ url: MANIFEST_URL, hash: '../config' as Sha256Hex }))
            .rejects.toMatchObject({ code: ERROR_CODE.MANIFEST_INVALID })
        expect(fs.existsSync(launcher.configPath)).toBe(true)
    })

    it('drops a pointer whose hash is not a sha256 from the modpack', () => {
        const parse = (hash: string) => DistributionManager.parseServerData({ id: 'pack', manifest: { url: MANIFEST_URL, hash } })

        expect(parse('../config').manifest).toBeNull()
        expect(parse(SHA256.toUpperCase()).manifest).toBeNull()
        expect(parse(SHA256).manifest).toEqual({ url: MANIFEST_URL, hash: SHA256, version: undefined })
    })

    it('rejects a manifest file whose hash is not a sha256', () => {
        expect(() => ManifestManager.assertShape(manifestWithFileHash(SHA256))).not.toThrow()
        for (const hash of ['', 'abc', '../x', SHA256.toUpperCase(), 42]) {
            expect(() => ManifestManager.assertShape(manifestWithFileHash(hash)), String(hash))
                .toThrow(expect.objectContaining({ code: ERROR_CODE.MANIFEST_INVALID }))
        }
    })
})
