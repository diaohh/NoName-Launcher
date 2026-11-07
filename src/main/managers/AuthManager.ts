import { powerMonitor } from 'electron'
import { MicrosoftAuth, MicrosoftErrorCode, type MicrosoftResponse } from 'helios-core/microsoft'
import { RestResponseStatus } from 'helios-core/common'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'
import { MICROSOFT_CLIENT_ID } from '../constants'
import { ERROR_CODE, isTerminalAuthCode, type ErrorCode } from '../../shared/errorCodes'
import { LauncherError, errorCodeOf } from '../../shared/LauncherError'
import type { AccountValidation, SessionExpired } from '../../shared/ipcContract'
import type { Account } from '../types/config'

const logger = Logger.getLogger('AuthManager')

/**
 * What `classifyRestError` reads from a failed helios response: got's `RequestError`, with or
 * without an HTTP answer, and the Microsoft code helios worked out from the body. got is not a
 * dependency of the launcher, so its error is described here by the fields that are read.
 */
interface FailedResponse {
    error?: unknown
    microsoftErrorCode?: MicrosoftErrorCode
}

interface HttpFailure {
    code?: unknown
    response?: { statusCode?: number, body?: unknown }
}

/** A Microsoft token set, as `exchangeAuthCode` / `exchangeRefreshToken` return it. */
export interface MicrosoftTokenSet {
    accessToken: string
    refreshToken: string
    expiresAt: number
}

/** A playable Minecraft session, as `resolveMinecraftSession` returns it. */
export interface MinecraftSession {
    accessToken: string
    username: string
    uuid: string
    displayName: string
    mcExpires: number
}

/** got reports a request that never reached the server with one of these and no response. */
const TRANSPORT_ERROR_CODES = new Set([
    'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED',
    'EAI_AGAIN', 'ENETUNREACH', 'ENETDOWN', 'EHOSTUNREACH', 'EPIPE', 'EPROTO'
])

/** How long before the Minecraft token expires the refresh is attempted. */
const REFRESH_SKEW_MS = 5 * 60 * 1000

/**
 * Ceiling on a single sleep. Nothing should normally wake this early, but a corrupt or
 * absurd expiresAt must not be able to park the scheduler for weeks.
 */
const MAX_DELAY_MS = 30 * 60 * 1000

/** Floor, so a token already past its skew cannot spin the timer. */
const MIN_DELAY_MS = 15 * 1000

/** Backoff for a failure that left the account alive: no network, a 5xx, a 429. */
const RETRY_DELAYS_MS = [60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000]

const MESSAGES = {
    NO_ACCOUNT: 'No hay ninguna cuenta iniciada. Inicia sesion con Microsoft.',
    NETWORK: 'No se ha podido contactar con Microsoft. Comprueba tu conexion e intentalo de nuevo.',
    SERVER: 'Los servidores de Microsoft no responden ahora mismo. Intentalo de nuevo en unos minutos.',
    INVALID_GRANT: 'Tu sesion de Microsoft ya no es valida. Vuelve a iniciar sesion.',
    UNKNOWN: 'Ha ocurrido un error inesperado durante la autenticacion. Intentalo de nuevo.'
}

class AuthManager {

    static refreshTimer: NodeJS.Timeout | null = null
    static onSessionExpired: ((payload: SessionExpired) => void) | null = null
    static resumeListener: (() => void) | null = null
    static retryAttempt = 0
    static validationInFlight: Promise<AccountValidation> | null = null

    static authError(code: ErrorCode, message: string, cause?: unknown): LauncherError {
        return new LauncherError(code, message, cause ?? undefined)
    }

    /** True when the failure means the session is gone for good. */
    static isTerminalError(code: unknown): boolean {
        return isTerminalAuthCode(code)
    }

    /** Microsoft answers OAuth failures with a JSON body carrying an `error` field. */
    static readOAuthError(cause: HttpFailure | undefined): string | null {
        const body = cause?.response?.body
        if (!body) return null
        try {
            const parsed: unknown = typeof body === 'string' ? JSON.parse(body) : body
            const error = (parsed as { error?: unknown } | null)?.error
            return typeof error === 'string' ? error : null
        } catch {
            return null
        }
    }

    /** The body of a successful helios response, which helios only leaves empty on an error. */
    static dataOf<T>(response: MicrosoftResponse<T | null>): T {
        if (response.data == null) throw this.authError(ERROR_CODE.AUTH_UNKNOWN, MESSAGES.UNKNOWN)
        return response.data
    }

    /**
     * helios-core never throws for a failed request: it returns the response with
     * `responseStatus: ERROR` and the underlying got error attached. Everything needed
     * to tell "no internet" from "revoked consent" is in there, so this is the single
     * place that decides whether a failure is worth logging the player out.
     *
     * @param terminalFallback MicrosoftErrorCode to assume for an unexplained 4xx on
     *                         endpoints where one failure mode dominates.
     */
    static classifyRestError(
        operation: string,
        response: FailedResponse | undefined,
        terminalFallback: MicrosoftErrorCode | null = null
    ): LauncherError {
        const cause = response?.error as HttpFailure | undefined
        const statusCode = cause?.response?.statusCode

        // UNKNOWN is helios' default, so it carries no information — only a specific
        // code means Microsoft actually named the problem with the account.
        if (response?.microsoftErrorCode != null && response.microsoftErrorCode !== MicrosoftErrorCode.UNKNOWN) {
            logger.warn(`${operation} failed with Microsoft error code ${response.microsoftErrorCode}`)
            return this.microsoftError(response.microsoftErrorCode, cause)
        }

        // No HTTP response at all: the request never reached Microsoft.
        if (statusCode == null) {
            logger.warn(`${operation} failed before reaching Microsoft (${cause?.code ?? 'no code'})`)
            return this.authError(ERROR_CODE.AUTH_NETWORK, MESSAGES.NETWORK, cause)
        }

        if (statusCode >= 500 || statusCode === 429) {
            logger.warn(`${operation} failed with HTTP ${statusCode}, treating as transient`)
            return this.authError(ERROR_CODE.AUTH_NETWORK, MESSAGES.SERVER, cause)
        }

        const oauthError = this.readOAuthError(cause)
        const rejectsCredentials = ['invalid_grant', 'invalid_client', 'unauthorized_client', 'interaction_required', 'consent_required']
        if (statusCode === 401 || (oauthError != null && rejectsCredentials.includes(oauthError))) {
            logger.warn(`${operation} rejected the stored credentials (${oauthError ?? `HTTP ${statusCode}`})`)
            return this.authError(ERROR_CODE.AUTH_INVALID_GRANT, MESSAGES.INVALID_GRANT, cause)
        }

        if (terminalFallback != null) {
            logger.warn(`${operation} failed with HTTP ${statusCode}, assuming ${terminalFallback}`)
            return this.microsoftError(terminalFallback, cause)
        }

        logger.error(`${operation} failed with HTTP ${statusCode} (${oauthError ?? 'no oauth error'})`)
        return this.authError(ERROR_CODE.AUTH_UNKNOWN, MESSAGES.UNKNOWN, cause)
    }

    /** Classifies an exception that escaped a helios call instead of being returned. */
    static classifyThrown(err: unknown): LauncherError {
        if (err instanceof LauncherError && err.code.startsWith('AUTH_')) return err
        const code = (err as { code?: unknown } | null)?.code
        if (typeof code === 'string' && TRANSPORT_ERROR_CODES.has(code)) {
            logger.warn(`Microsoft auth failed at the transport layer (${code})`)
            return this.authError(ERROR_CODE.AUTH_NETWORK, MESSAGES.NETWORK, err)
        }
        logger.error('Unexpected Microsoft auth error:', err)
        return this.authError(ERROR_CODE.AUTH_UNKNOWN, MESSAGES.UNKNOWN, err)
    }

    /**
     * Trades a fresh authorization code for a Microsoft token set.
     *
     */
    static async exchangeAuthCode(authCode: string): Promise<MicrosoftTokenSet> {
        return await this.requestMicrosoftTokens(authCode, false)
    }

    /**
     * Trades a stored refresh token for a new Microsoft token set. Microsoft rotates the
     * refresh token, so the caller must persist the one that comes back.
     */
    static async exchangeRefreshToken(refreshToken: string): Promise<MicrosoftTokenSet> {
        return await this.requestMicrosoftTokens(refreshToken, true)
    }

    static async requestMicrosoftTokens(credential: string, isRefresh: boolean): Promise<MicrosoftTokenSet> {
        try {
            const response = await MicrosoftAuth.getAccessToken(credential, isRefresh, MICROSOFT_CLIENT_ID)

            if (response.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getAccessToken', response)
            }

            logger.info(`Microsoft access token obtained (${isRefresh ? 'refresh' : 'auth code'})`)

            const data = this.dataOf(response)
            return {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                expiresAt: this.calculateExpiryDate(new Date().getTime(), data.expires_in)
            }
        } catch (err) {
            // Never flatten a classified failure back into UNKNOWN: losing the code here
            // is what used to turn "no internet" into a logout.
            throw this.classifyThrown(err)
        }
    }

    /**
     * Walks the Microsoft access token down to a playable Minecraft session:
     * XBL -> XSTS -> Minecraft token -> profile.
     *
     * This is the half that never depends on how the Microsoft token was obtained, which
     * is why refreshing only the Minecraft token is just calling this on the stored one.
     *
     */
    static async resolveMinecraftSession(msAccessToken: string): Promise<MinecraftSession> {
        try {
            const xblResponse = await MicrosoftAuth.getXBLToken(msAccessToken)
            if (xblResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getXBLToken', xblResponse)
            }

            logger.info('XBL token obtained')

            const xstsResponse = await MicrosoftAuth.getXSTSToken(this.dataOf(xblResponse))
            if (xstsResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getXSTSToken', xstsResponse)
            }

            logger.info('XSTS token obtained')

            const mcTokenResponse = await MicrosoftAuth.getMCAccessToken(this.dataOf(xstsResponse))
            if (mcTokenResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getMCAccessToken', mcTokenResponse)
            }

            const mcToken = this.dataOf(mcTokenResponse)
            const mcAccessToken = mcToken.access_token
            const mcExpires = this.calculateExpiryDate(
                new Date().getTime(),
                mcToken.expires_in
            )

            logger.info('Minecraft access token obtained')

            // A 4xx here is almost always an account with no Minecraft profile — Game
            // Pass users who never opened the official launcher land exactly here.
            const mcProfileResponse = await MicrosoftAuth.getMCProfile(mcAccessToken)
            if (mcProfileResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getMCProfile', mcProfileResponse, MicrosoftErrorCode.NO_PROFILE)
            }

            const mcProfile = this.dataOf(mcProfileResponse)
            logger.info('Minecraft profile obtained:', mcProfile.name)

            return {
                accessToken: mcAccessToken,
                username: mcProfile.name,
                uuid: mcProfile.id,
                displayName: mcProfile.name,
                mcExpires
            }
        } catch (err) {
            throw this.classifyThrown(err)
        }
    }

    static async addMicrosoftAccount(authCode: string): Promise<MinecraftSession> {
        const microsoft = await this.exchangeAuthCode(authCode)
        const session = await this.resolveMinecraftSession(microsoft.accessToken)

        ConfigManager.addMicrosoftAccount(
            session.uuid,
            session.accessToken,
            session.username,
            session.displayName,
            session.mcExpires,
            microsoft.accessToken,
            microsoft.refreshToken,
            microsoft.expiresAt
        )

        await ConfigManager.save()
        logger.info('Microsoft account added successfully')

        return session
    }

    /**
     * Validates the selected account, refreshing its tokens when needed.
     *
     * Returns `{ ok: true }` or `{ ok: false, code, message }`. A transient failure must
     * never cost the player their account, so the account is removed only for a terminal
     * code.
     *
     * Single-flight: the scheduler, a resume from sleep and a launch can all ask at once, and
     * each would otherwise spend the same refresh token. Microsoft rotates it, so the second
     * refresh races the first, the last write wins, and an `invalid_grant` from the loser is
     * terminal. Concurrent callers share the validation already in progress instead.
     */
    static validateSelectedMicrosoftAccount(): Promise<AccountValidation> {
        if (!this.validationInFlight) {
            this.validationInFlight = this.runAccountValidation().finally(() => {
                this.validationInFlight = null
            })
        }
        return this.validationInFlight
    }

    static async runAccountValidation(): Promise<AccountValidation> {
        const uuid = ConfigManager.getSelectedAccount()
        if (!uuid) {
            logger.warn('No account selected')
            return { ok: false, code: ERROR_CODE.AUTH_NO_ACCOUNT, message: MESSAGES.NO_ACCOUNT }
        }

        const account = ConfigManager.getAccountByUUID(uuid)
        if (!account || account.type !== 'microsoft') {
            logger.warn('Invalid account or not Microsoft')
            return { ok: false, code: ERROR_CODE.AUTH_NO_ACCOUNT, message: MESSAGES.NO_ACCOUNT }
        }

        const now = new Date().getTime()

        if (account.expiresAt > now) {
            logger.info('MC token still valid')
            return { ok: true }
        }

        try {
            if (account.microsoft.expires_at > now) {
                logger.info('MC token expired, MS token still valid: refreshing the MC token only')
                await this.refreshMCToken(account)
            } else {
                logger.info('MC and MS tokens expired: full refresh')
                await this.refreshMSToken(account)
            }
            return { ok: true }
        } catch (err) {
            const code = errorCodeOf(err, ERROR_CODE.AUTH_UNKNOWN)

            if (this.isTerminalError(code)) {
                logger.warn(`Refresh failed with a terminal error (${code}), logging out user`)
                try {
                    await this.removeAccount(uuid)
                } catch (saveErr) {
                    // The account is already gone from memory, which is what logs the player
                    // out; a disk that refuses the write must not turn this into a crash.
                    logger.error('The account was dropped but config.json could not be rewritten', saveErr)
                }
            } else {
                logger.warn(`Refresh failed with a recoverable error (${code}), keeping the account`)
            }

            return { ok: false, code, message: (err instanceof Error && err.message) || MESSAGES.UNKNOWN }
        }
    }

    /** The Microsoft token is still good, so only the Minecraft half is renewed. */
    static async refreshMCToken(account: Account): Promise<void> {
        logger.info('Attempting to refresh MC token for account:', account.uuid)
        const session = await this.resolveMinecraftSession(account.microsoft.access_token)

        ConfigManager.updateMicrosoftAccount(
            account.uuid,
            session.accessToken,
            session.mcExpires,
            account.microsoft.access_token,
            account.microsoft.refresh_token,
            account.microsoft.expires_at
        )

        await ConfigManager.save()
        logger.info('MC token refreshed successfully')
    }

    /** Both tokens have expired: renew the Microsoft one, then the Minecraft session. */
    static async refreshMSToken(account: Account): Promise<void> {
        logger.info('Attempting to refresh MS token for account:', account.uuid)
        const microsoft = await this.exchangeRefreshToken(account.microsoft.refresh_token)
        const session = await this.resolveMinecraftSession(microsoft.accessToken)

        ConfigManager.updateMicrosoftAccount(
            account.uuid,
            session.accessToken,
            session.mcExpires,
            microsoft.accessToken,
            microsoft.refreshToken,
            microsoft.expiresAt
        )

        await ConfigManager.save()
        logger.info('MS and MC tokens refreshed successfully')
    }

    static getSelectedAccount(): Account | null {
        const uuid = ConfigManager.getSelectedAccount()
        if (!uuid) return null
        return ConfigManager.getAccountByUUID(uuid)
    }

    static async removeAccount(uuid: string): Promise<void> {
        ConfigManager.removeAccount(uuid)
        await ConfigManager.save()
        logger.info('Account removed:', uuid)
    }

    /**
     * Starts refreshing the session ahead of its expiry instead of polling for it.
     *
     * The previous version woke every five minutes and returned immediately unless the token
     * had *already* expired, so it never renewed anything in advance. It also lived inside
     * `registerAuthIPC`, which macOS runs again on `activate`: a second interval that nothing
     * ever cleared. Starting is idempotent for exactly that reason.
     *
     * @param onExpired Called only when the session is gone for a terminal reason. A network
     *                  failure never reaches it — see ADR-0007.
     */
    static startTokenRefreshScheduler(onExpired: (payload: SessionExpired) => void): void {
        this.stopTokenRefreshScheduler()
        this.onSessionExpired = onExpired

        // A timer does not run while the machine is asleep and fires late on wake, so a
        // laptop closed overnight comes back with a stale token and a pending timeout. That
        // is the case this whole scheduler exists for.
        this.resumeListener = () => {
            logger.info('System resumed, re-checking the session')
            this.scheduleTokenRefresh(0)
        }
        powerMonitor.on('resume', this.resumeListener)

        this.scheduleTokenRefresh()
    }

    static stopTokenRefreshScheduler(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer)
            this.refreshTimer = null
        }

        if (this.resumeListener) {
            powerMonitor.removeListener('resume', this.resumeListener)
            this.resumeListener = null
        }

        this.onSessionExpired = null
        this.retryAttempt = 0
    }

    /**
     * Arms the timer against the selected account's own expiry.
     *
     * With no account there is nothing to refresh and no timer is left running; the next
     * login re-arms it. The expiry read here is `expiresAt`, the Minecraft token's — never
     * `microsoft.expires_at`, which belongs to the Microsoft *access* token and says nothing
     * about whether the session can still be renewed.
     */
    static scheduleTokenRefresh(delayOverride: number | null = null): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer)
            this.refreshTimer = null
        }

        const uuid = ConfigManager.getSelectedAccount()
        const account = uuid ? ConfigManager.getAccountByUUID(uuid) : null
        if (!account || account.type !== 'microsoft') return

        const untilRefresh = account.expiresAt - new Date().getTime() - REFRESH_SKEW_MS
        const delay = delayOverride ?? Math.min(Math.max(untilRefresh, MIN_DELAY_MS), MAX_DELAY_MS)

        logger.info(`Next token check in ${Math.round(delay / 1000)}s`)
        this.refreshTimer = setTimeout(() => this.runScheduledRefresh(), delay)
    }

    /**
     * The scheduled check, run through the same path a launch uses so there is a single
     * definition of "is this session still good".
     */
    static async runScheduledRefresh(): Promise<void> {
        this.refreshTimer = null

        const uuid = ConfigManager.getSelectedAccount()
        const account = uuid ? ConfigManager.getAccountByUUID(uuid) : null
        if (!uuid || !account || account.type !== 'microsoft') return

        // Woken by the ceiling rather than by the expiry: nothing to do yet.
        if (account.expiresAt - new Date().getTime() > REFRESH_SKEW_MS) {
            this.scheduleTokenRefresh()
            return
        }

        const result = await this.validateSelectedMicrosoftAccount()

        if (result.ok) {
            this.retryAttempt = 0
            this.scheduleTokenRefresh()
            return
        }

        // The account is still on disk, so the failure was judged recoverable: a network
        // blip must not bounce the player back to the login screen.
        if (ConfigManager.getAccountByUUID(uuid)) {
            const delay = RETRY_DELAYS_MS[Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1)]
            this.retryAttempt++
            logger.warn(`Token refresh deferred (${result.code}), retrying in ${delay / 1000}s`)
            this.scheduleTokenRefresh(delay)
            return
        }

        logger.warn(`Session lost for a terminal reason (${result.code})`)
        const notify = this.onSessionExpired
        this.stopTokenRefreshScheduler()
        if (notify) notify({ expired: true, message: result.message })
    }

    static calculateExpiryDate(nowMs: number, expiresInS: number): number {
        return nowMs + ((expiresInS - 10) * 1000)
    }

    /**
     * Builds a real Error for a Microsoft error code. It used to return a plain
     * `{ title, desc }` object, which does not survive `ipcMain.handle` — that is why
     * a failed login showed the user the word "undefined".
     */
    static microsoftError(errorCode: MicrosoftErrorCode, cause?: unknown): LauncherError {
        switch (errorCode) {
            case MicrosoftErrorCode.NO_PROFILE:
                return this.authError(
                    ERROR_CODE.AUTH_NO_PROFILE,
                    'Esta cuenta de Microsoft no tiene un perfil de Minecraft. Compra el juego, o entra una vez en el launcher oficial para elegir tu nombre.',
                    cause
                )
            case MicrosoftErrorCode.NO_XBOX_ACCOUNT:
                return this.authError(
                    ERROR_CODE.AUTH_NO_XBOX_ACCOUNT,
                    'Esta cuenta de Microsoft no tiene una cuenta de Xbox. Crea una e intentalo de nuevo.',
                    cause
                )
            case MicrosoftErrorCode.XBL_BANNED:
                return this.authError(
                    ERROR_CODE.AUTH_XBL_BANNED,
                    'Esta cuenta esta bloqueada en Xbox Live y no puede iniciar sesion.',
                    cause
                )
            case MicrosoftErrorCode.UNDER_18:
                return this.authError(
                    ERROR_CODE.AUTH_UNDER_18,
                    'Esta cuenta pertenece a un menor de edad. Un adulto debe añadirla a una familia de Microsoft.',
                    cause
                )
            default:
                return this.authError(ERROR_CODE.AUTH_UNKNOWN, MESSAGES.UNKNOWN, cause)
        }
    }
}

export default AuthManager
