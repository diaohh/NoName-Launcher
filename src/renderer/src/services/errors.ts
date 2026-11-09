import { LauncherError } from '../../../shared/LauncherError'
import { isTerminalAuthCode } from '../../../shared/errorCodes'

/**
 * What a `catch` in the renderer needs from whatever it caught, which TypeScript hands over as
 * `unknown`: a rejection from main is a `LauncherError` (`ipcClient` rebuilds it), but Firebase,
 * the DOM or a plain bug can throw anything else.
 */

/** The failure's own message when it has one, written for the player by main; `fallback` otherwise. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * Whether the session is gone for good. Only a terminal auth code from main means it: a network
 * failure carries a code too, and must leave the player logged in.
 */
export function isTerminalAuthError(err: unknown): boolean {
  return err instanceof LauncherError && isTerminalAuthCode(err.code)
}
