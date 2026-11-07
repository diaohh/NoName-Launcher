import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'

/** Long enough for a slow connection to answer, short enough that nobody thinks it hung. */
export const DEFAULT_TIMEOUT_MS = 30 * 1000

/**
 * `fetch` that gives up after `timeoutMs` and reports failures in Spanish, with a code.
 *
 * Plain `fetch` has no timeout: a connection that stalls leaves the launch sitting on
 * "Descargando manifest..." forever, and there is no cancel button yet. Its own failures
 * reach the player as an English "fetch failed". This is for small JSON and text requests;
 * file downloads go through `helios-core/dl`, which has its own retries.
 *
 * Only the transport is handled here. A non-2xx response is returned as-is so each caller
 * can word its own error.
 *
 * @param {string} what Short description for the message, e.g. "el manifest del modpack".
 * @throws {LauncherError} NETWORK_TIMEOUT or NETWORK_ERROR, with the original as the cause
 */
export async function fetchWithTimeout(
    url: string,
    what: string,
    { timeoutMs = DEFAULT_TIMEOUT_MS, ...init }: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
        // AbortSignal.timeout rejects with a DOMException; only its name is relied on.
        const name = (err as { name?: unknown } | null)?.name
        const timedOut = name === 'TimeoutError' || name === 'AbortError'
        throw timedOut
            ? new LauncherError(
                ERROR_CODE.NETWORK_TIMEOUT,
                `No se ha recibido respuesta al descargar ${what} en ${Math.round(timeoutMs / 1000)} s. Comprueba tu conexion e intentalo de nuevo.`,
                err
            )
            : new LauncherError(
                ERROR_CODE.NETWORK_ERROR,
                `No se ha podido descargar ${what}. Comprueba tu conexion e intentalo de nuevo.`,
                err
            )
    }
}
