import { afterEach, describe, expect, it, vi } from 'vitest'
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

// The token request is the launcher's own (helios cannot send a PKCE verifier), so it must
// classify failures exactly like the helios path: a refresh that fails for the network must
// never cost the player their account.
describe('AuthManager.requestMicrosoftTokens', () => {
    const answer = (status: number, body: unknown) =>
        vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

    afterEach(() => vi.unstubAllGlobals())

    it('sends the PKCE verifier with the code and reads the token set', async () => {
        const fetch = answer(200, { access_token: 'ms-access', refresh_token: 'ms-refresh', expires_in: 3600 })
        vi.stubGlobal('fetch', fetch)

        const tokens = await AuthManager.exchangeAuthCode('the-code', 'the-verifier')

        const body = new URLSearchParams(String(fetch.mock.calls[0]?.[1]?.body))
        expect(body.get('grant_type')).toBe('authorization_code')
        expect(body.get('code')).toBe('the-code')
        expect(body.get('code_verifier')).toBe('the-verifier')
        expect(tokens).toMatchObject({ accessToken: 'ms-access', refreshToken: 'ms-refresh' })
    })

    it.each([
        ['no network', vi.fn<typeof fetch>(async () => { throw new TypeError('fetch failed') })],
        ['a 5xx', answer(503, null)],
        ['a 429', answer(429, { error: 'too_many_requests' })]
    ])('treats %s as transient', async (_label, fetch) => {
        vi.stubGlobal('fetch', fetch)

        const error = await AuthManager.exchangeRefreshToken('stored-refresh').catch((err: unknown) => err)

        expect(error).toMatchObject({ code: ERROR_CODE.AUTH_NETWORK })
    })

    it('treats a rejected refresh token as terminal', async () => {
        vi.stubGlobal('fetch', answer(400, { error: 'invalid_grant' }))

        await expect(AuthManager.exchangeRefreshToken('revoked')).rejects.toMatchObject({ code: ERROR_CODE.AUTH_INVALID_GRANT })
    })
})
