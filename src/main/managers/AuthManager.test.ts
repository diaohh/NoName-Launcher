import { describe, expect, it } from 'vitest'
import { MicrosoftErrorCode } from 'helios-core/microsoft'
import { RestResponseStatus } from 'helios-core/common'
import AuthManager from './AuthManager'
import { ERROR_CODE, isTerminalAuthCode } from '../../shared/errorCodes'

/** What helios-core hands back for a failed request: it never throws, it returns this. */
const failedResponse = (error: Error, extra: { microsoftErrorCode?: MicrosoftErrorCode } = {}) =>
    ({ responseStatus: RestResponseStatus.ERROR, error, ...extra })

/** got's `RequestError` with an HTTP answer attached. */
function httpError(statusCode: number, body: string) {
    return Object.assign(new Error(`Response code ${statusCode}`), { response: { statusCode, body } })
}

/** A request that never reached Microsoft: no `response` at all. */
function transportError(code: string) {
    return Object.assign(new Error(code), { code })
}

describe('AuthManager.classifyRestError', () => {
    // A transient failure must never log the player out (ADR-0007).
    it.each([
        ['no network', transportError('ENOTFOUND')],
        ['a 5xx', httpError(503, '')],
        ['a 429', httpError(429, '')]
    ])('treats %s as transient', (_label, cause) => {
        const error = AuthManager.classifyRestError('getAccessToken', failedResponse(cause))

        expect(error.code).toBe(ERROR_CODE.AUTH_NETWORK)
        expect(isTerminalAuthCode(error.code)).toBe(false)
    })

    it('ignores helios\' default UNKNOWN code and still sees a network failure', () => {
        const response = failedResponse(transportError('ETIMEDOUT'), { microsoftErrorCode: MicrosoftErrorCode.UNKNOWN })

        expect(AuthManager.classifyRestError('getXBLToken', response).code).toBe(ERROR_CODE.AUTH_NETWORK)
    })

    it('treats a rejected refresh token as terminal', () => {
        const cause = httpError(400, JSON.stringify({ error: 'invalid_grant' }))
        const error = AuthManager.classifyRestError('getAccessToken', failedResponse(cause))

        expect(error.code).toBe(ERROR_CODE.AUTH_INVALID_GRANT)
        expect(isTerminalAuthCode(error.code)).toBe(true)
    })

    it('does not treat an unrecognised 4xx as terminal', () => {
        const cause = httpError(400, JSON.stringify({ error: 'something_new' }))
        const error = AuthManager.classifyRestError('getAccessToken', failedResponse(cause))

        expect(error.code).toBe(ERROR_CODE.AUTH_UNKNOWN)
        expect(isTerminalAuthCode(error.code)).toBe(false)
    })
})
