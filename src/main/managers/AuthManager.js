import { powerMonitor } from 'electron'
import { MicrosoftAuth, MicrosoftErrorCode } from 'helios-core/microsoft'
import { RestResponseStatus } from 'helios-core/common'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'
import { ERROR_CODE, isTerminalAuthCode } from '../../shared/errorCodes'

const logger = Logger.getLogger('AuthManager')

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || 'b7607eac-c8e1-404f-9042-b7f75757daa3'

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

    static refreshTimer = null
    static onSessionExpired = null
    static resumeListener = null
    static retryAttempt = 0

    static authError(code, message, cause) {
        const error = new Error(message)
        error.code = code
        if (cause) error.cause = cause
        return error
    }

    /** True when the failure means the session is gone for good. */
    static isTerminalError(code) {
        return isTerminalAuthCode(code)
    }

    /** Microsoft answers OAuth failures with a JSON body carrying an `error` field. */
    static readOAuthError(cause) {
        const body = cause?.response?.body
        if (!body) return null
        try {
            const parsed = typeof body === 'string' ? JSON.parse(body) : body
            return parsed?.error ?? null
        } catch {
            return null
        }
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
    static classifyRestError(operation, response, terminalFallback = null) {
        const cause = response?.error
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
        if (statusCode === 401 || ['invalid_grant', 'invalid_client', 'unauthorized_client', 'interaction_required', 'consent_required'].includes(oauthError)) {
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
    static classifyThrown(err) {
        if (typeof err?.code === 'string' && err.code.startsWith('AUTH_')) return err
        if (TRANSPORT_ERROR_CODES.has(err?.code)) {
            logger.warn(`Microsoft auth failed at the transport layer (${err.code})`)
            return this.authError(ERROR_CODE.AUTH_NETWORK, MESSAGES.NETWORK, err)
        }
        logger.error('Unexpected Microsoft auth error:', err)
        return this.authError(ERROR_CODE.AUTH_UNKNOWN, MESSAGES.UNKNOWN, err)
    }

    /**
     * Trades a fresh authorization code for a Microsoft token set.
     *
     * @returns {Promise<{accessToken: string, refreshToken: string, expiresAt: number}>}
     */
    static async exchangeAuthCode(authCode) {
        return await this.requestMicrosoftTokens(authCode, false)
    }

    /**
     * Trades a stored refresh token for a new Microsoft token set. Microsoft rotates the
     * refresh token, so the caller must persist the one that comes back.
     */
    static async exchangeRefreshToken(refreshToken) {
        return await this.requestMicrosoftTokens(refreshToken, true)
    }

    static async requestMicrosoftTokens(credential, isRefresh) {
        try {
            const response = await MicrosoftAuth.getAccessToken(credential, isRefresh, MICROSOFT_CLIENT_ID)

            if (response.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getAccessToken', response)
            }

            logger.info(`Microsoft access token obtained (${isRefresh ? 'refresh' : 'auth code'})`)

            return {
                accessToken: response.data.access_token,
                refreshToken: response.data.refresh_token,
                expiresAt: this.calculateExpiryDate(new Date().getTime(), response.data.expires_in)
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
     * @returns {Promise<{accessToken, username, uuid, displayName, mcExpires}>}
     */
    static async resolveMinecraftSession(msAccessToken) {
        try {
            const xblResponse = await MicrosoftAuth.getXBLToken(msAccessToken)
            if (xblResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getXBLToken', xblResponse)
            }

            logger.info('XBL token obtained')

            const xstsResponse = await MicrosoftAuth.getXSTSToken(xblResponse.data)
            if (xstsResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getXSTSToken', xstsResponse)
            }

            logger.info('XSTS token obtained')

            const mcTokenResponse = await MicrosoftAuth.getMCAccessToken(xstsResponse.data)
            if (mcTokenResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getMCAccessToken', mcTokenResponse)
            }

            const mcAccessToken = mcTokenResponse.data.access_token
            const mcExpires = this.calculateExpiryDate(
                new Date().getTime(),
                mcTokenResponse.data.expires_in
            )

            logger.info('Minecraft access token obtained')

            // A 4xx here is almost always an account with no Minecraft profile — Game
            // Pass users who never opened the official launcher land exactly here.
            const mcProfileResponse = await MicrosoftAuth.getMCProfile(mcAccessToken)
            if (mcProfileResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw this.classifyRestError('getMCProfile', mcProfileResponse, MicrosoftErrorCode.NO_PROFILE)
            }

            const mcProfile = mcProfileResponse.data
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

    static async addMicrosoftAccount(authCode) {
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

        ConfigManager.save()
        logger.info('Microsoft account added successfully')

        return session
    }

    /**
     * Validates the selected account, refreshing its tokens when needed.
     *
     * Returns `{ ok: true }` or `{ ok: false, code, message }`. A transient failure must
     * never cost the player their account, so the account is removed only for a terminal
     * code.
     */
    static async validateSelectedMicrosoftAccount() {
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
            const code = err?.code ?? ERROR_CODE.AUTH_UNKNOWN

            if (this.isTerminalError(code)) {
                logger.warn(`Refresh failed with a terminal error (${code}), logging out user`)
                this.removeAccount(uuid)
            } else {
                logger.warn(`Refresh failed with a recoverable error (${code}), keeping the account`)
            }

            return { ok: false, code, message: err?.message ?? MESSAGES.UNKNOWN }
        }
    }

    /** The Microsoft token is still good, so only the Minecraft half is renewed. */
    static async refreshMCToken(account) {
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

        ConfigManager.save()
        logger.info('MC token refreshed successfully')
    }

    /** Both tokens have expired: renew the Microsoft one, then the Minecraft session. */
    static async refreshMSToken(account) {
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

        ConfigManager.save()
        logger.info('MS and MC tokens refreshed successfully')
    }

    static getSelectedAccount() {
        const uuid = ConfigManager.getSelectedAccount()
        if (!uuid) return null
        return ConfigManager.getAccountByUUID(uuid)
    }

    static removeAccount(uuid) {
        ConfigManager.removeAccount(uuid)
        ConfigManager.save()
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
    static startTokenRefreshScheduler(onExpired) {
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

    static stopTokenRefreshScheduler() {
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
    static scheduleTokenRefresh(delayOverride = null) {
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
    static async runScheduledRefresh() {
        this.refreshTimer = null

        const uuid = ConfigManager.getSelectedAccount()
        const account = uuid ? ConfigManager.getAccountByUUID(uuid) : null
        if (!account || account.type !== 'microsoft') return

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

    static calculateExpiryDate(nowMs, expiresInS) {
        return nowMs + ((expiresInS - 10) * 1000)
    }

    /**
     * Builds a real Error for a Microsoft error code. It used to return a plain
     * `{ title, desc }` object, which does not survive `ipcMain.handle` — that is why
     * a failed login showed the user the word "undefined".
     */
    static microsoftError(errorCode, cause) {
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
