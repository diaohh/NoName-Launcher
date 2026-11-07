import os from 'os'
import path from 'path'

/**
 * Stand-in for the `electron` module under Vitest, wired in by the alias in
 * `vitest.config.mjs`. The real package only resolves to the path of a binary when it is
 * imported from plain node, so anything that reaches `ConfigManager` (`safeStorage`) or
 * `LaunchManager` (`app`) would not load at all.
 *
 * Only what the code under test touches is here. A test that needs more adds it, rather
 * than this file growing an imitation of Electron.
 */

const PREFIX = 'stub-encrypted:'

/**
 * Switches the tests flip to reach the paths that cannot happen on a developer's machine:
 * no keyring at all, a blob the keyring can no longer open, or an encryption that takes
 * longer than the next one (`encryptDelaysMs`, consumed one per call). `reset()` goes in an
 * `afterEach`, so one test cannot leave the next without encryption.
 */
export const safeStorageControl = {
    available: true,
    undecryptable: false,
    encryptDelaysMs: [],
    reset() {
        this.available = true
        this.undecryptable = false
        this.encryptDelaysMs = []
    }
}

function decrypt(encrypted) {
    const text = Buffer.from(encrypted).toString('utf-8')
    if (safeStorageControl.undecryptable || !text.startsWith(PREFIX)) {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
    }
    return text.slice(PREFIX.length)
}

/**
 * Reversible on purpose, and visibly so: a test can assert that a token never reaches the
 * disk in the clear without depending on what the OS keyring would produce.
 */
export const safeStorage = {
    async isAsyncEncryptionAvailable() {
        return safeStorageControl.available
    },
    async encryptStringAsync(plainText) {
        const delay = safeStorageControl.encryptDelaysMs.shift() ?? 0
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
        if (!safeStorageControl.available) throw new Error('Encryption is not available.')
        return Buffer.from(PREFIX + plainText, 'utf-8')
    },
    async decryptStringAsync(encrypted) {
        return { result: decrypt(encrypted), shouldReEncrypt: false }
    }
}

export const app = {
    isPackaged: false,
    getName: () => 'NoNameLauncher',
    getVersion: () => '0.0.0-test',
    getPath: (name) => path.join(os.tmpdir(), 'nnl-test', name)
}

// AuthManager subscribes to `resume` only when its scheduler starts, which no test does.
export const powerMonitor = {
    on() {},
    removeListener() {}
}

export default { app, powerMonitor, safeStorage }
