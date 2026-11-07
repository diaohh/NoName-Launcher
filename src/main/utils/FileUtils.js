import fs from 'fs'
import crypto from 'crypto'

/**
 * Streaming hash of a file. Avoids loading large jars fully into memory.
 *
 * @param {string} filePath
 * @param {string} algo Any algorithm supported by node crypto ('sha1', 'md5', 'sha256')
 * @returns {Promise<string>} Lowercase hex digest
 */
export function hashFile(filePath, algo) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash(algo)
        const stream = fs.createReadStream(filePath)
        stream.on('data', chunk => hash.update(chunk))
        stream.on('end', () => resolve(hash.digest('hex')))
        stream.on('error', reject)
    })
}

/**
 * Writes a file so that a crash or a power cut leaves either the old contents or the new
 * ones, never a truncated file: the data goes to a temporary file that is flushed to disk
 * and then renamed over the target. Throws the underlying error; callers word their own.
 *
 * @param {string} filePath
 * @param {string|Buffer} data
 */
export function writeFileAtomicSync(filePath, data) {
    const tmpPath = `${filePath}.tmp`

    try {
        const fd = fs.openSync(tmpPath, 'w')
        try {
            fs.writeFileSync(fd, data)
            fs.fsyncSync(fd)
        } finally {
            fs.closeSync(fd)
        }
        fs.renameSync(tmpPath, filePath)
    } catch (err) {
        try {
            fs.rmSync(tmpPath, { force: true })
        } catch {
            // Nothing more to do; the next write overwrites it.
        }
        throw err
    }
}

/**
 * Checks that a local file exists and matches the expected hash.
 * A missing expected hash means "existence is enough" — some artifacts are
 * published without a checksum.
 *
 * @returns {Promise<boolean>} True when the file can be considered valid.
 */
export async function validateLocalFile(filePath, algo, expectedHash) {
    if (!fs.existsSync(filePath)) return false
    if (!expectedHash) return true

    try {
        const actual = await hashFile(filePath, algo)
        return actual.toLowerCase() === expectedHash.toLowerCase()
    } catch {
        return false
    }
}
