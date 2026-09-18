import { ERROR_CODE } from '../../shared/errorCodes'

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
 * @throws {Error} with `code` NETWORK_TIMEOUT or NETWORK_ERROR
 */
export async function fetchWithTimeout(url, what, { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = {}) {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
        const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
        const error = new Error(timedOut
            ? `No se ha recibido respuesta al descargar ${what} en ${Math.round(timeoutMs / 1000)} s. Comprueba tu conexion e intentalo de nuevo.`
            : `No se ha podido descargar ${what}. Comprueba tu conexion e intentalo de nuevo.`)
        error.code = timedOut ? ERROR_CODE.NETWORK_TIMEOUT : ERROR_CODE.NETWORK_ERROR
        error.cause = err
        throw error
    }
}
