import path from 'path'
import { ERROR_CODE } from '../../shared/errorCodes'

/**
 * Joins `relativePath` onto `base` and refuses any result that is not strictly inside it.
 *
 * Every path the launcher writes to is built from data it did not author: manifest entries,
 * the modpack id sent by the renderer, library coordinates from Fabric Meta. A `..` segment
 * or an absolute path in any of them would otherwise land a download anywhere on disk. The
 * hash on the manifest proves the file is the published one, not that its paths are sane.
 *
 * @throws {Error} with `code = PATH_OUTSIDE_BASE`
 */
export function resolveInside(base, relativePath) {
    const root = path.resolve(base)
    const target = path.resolve(root, String(relativePath))

    if (!target.startsWith(root + path.sep)) {
        const error = new Error(`Ruta no permitida fuera de ${root}: ${relativePath}`)
        error.code = ERROR_CODE.PATH_OUTSIDE_BASE
        throw error
    }

    return target
}

/**
 * The shape a manifest path must have: relative, POSIX separators, no empty, `.` or `..`
 * segment, and nothing Windows would read as a drive or a stream (`C:`, `file:stream`).
 * Checked on the manifest itself so a bad entry fails the launch before any file is touched.
 */
export function isSafeRelativePath(relativePath) {
    if (typeof relativePath !== 'string' || relativePath.length === 0) return false
    if (/[\\:\0]/.test(relativePath) || relativePath.startsWith('/')) return false

    return relativePath.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}
