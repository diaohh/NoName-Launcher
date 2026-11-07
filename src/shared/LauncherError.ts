import { ERROR_CODE, isErrorCode, type ErrorCode } from './errorCodes'

/**
 * The one error the launcher throws on purpose: a message in Spanish, written for the player,
 * and a code from `errorCodes` the renderer can branch on (ADR-0002).
 *
 * Assigning `error.code` by hand on a plain Error is what this replaces. A typo there was a
 * code nobody listed, and the renderer silently stopped matching it; here the compiler only
 * accepts an `ErrorCode`.
 *
 * Thrown in main and rebuilt in the renderer by `services/ipcClient`, from the envelope
 * `main/ipc/result` answers with — an Error itself does not survive the IPC boundary.
 */
export class LauncherError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'LauncherError'
    this.code = code
  }
}

/**
 * The launcher code an error carries, or `fallback` when it carries none of ours — node's
 * `ENOENT` or a library's own code included.
 */
export function errorCodeOf(err: unknown, fallback: ErrorCode = ERROR_CODE.UNKNOWN): ErrorCode {
  const code = err instanceof Error ? (err as { code?: unknown }).code : undefined
  return isErrorCode(code) ? code : fallback
}
