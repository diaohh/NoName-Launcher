import path from 'path'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'

/**
 * Joins `relativePath` onto `base` and refuses any result that is not strictly inside it.
 *
 * Every path the launcher writes to is built from data it did not author: manifest entries,
 * the modpack id sent by the renderer, library coordinates from Fabric Meta. A `..` segment
 * or an absolute path in any of them would otherwise land a download anywhere on disk. The
 * hash on the manifest proves the file is the published one, not that its paths are sane.
 *
 * @throws {LauncherError} PATH_OUTSIDE_BASE
 */
export function resolveInside(base: string, relativePath: string): string {
    const root = path.resolve(base)
    const target = path.resolve(root, String(relativePath))

    if (!target.startsWith(root + path.sep)) {
        throw new LauncherError(ERROR_CODE.PATH_OUTSIDE_BASE, `Ruta no permitida fuera de ${root}: ${relativePath}`)
    }

    return target
}

/**
 * The shape a manifest path must have: relative, POSIX separators, no empty, `.` or `..`
 * segment, and nothing Windows would read as a drive or a stream (`C:`, `file:stream`).
 * Checked on the manifest itself so a bad entry fails the launch before any file is touched.
 */
export function isSafeRelativePath(relativePath: unknown): relativePath is string {
    if (typeof relativePath !== 'string' || relativePath.length === 0) return false
    if (/[\\:\0]/.test(relativePath) || relativePath.startsWith('/')) return false

    return relativePath.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}
