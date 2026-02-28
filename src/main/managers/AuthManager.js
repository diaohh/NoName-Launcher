import { MicrosoftAuth, MicrosoftErrorCode } from 'helios-core/microsoft'
import { RestResponseStatus } from 'helios-core/common'
import ConfigManager from './ConfigManager'
import Logger from '../utils/Logger'

const logger = Logger.getLogger('AuthManager')

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || 'b7607eac-c8e1-404f-9042-b7f75757daa3'

const AUTH_MODE = {
    FULL: 0,
    MS_REFRESH: 1,
    MC_REFRESH: 2
}

class AuthManager {

    static async fullMicrosoftAuthFlow(authCode, authMode = AUTH_MODE.FULL) {
        try {
            logger.info('Starting Microsoft auth flow, mode:', authMode)

            let msAccessToken, msRefreshToken, msExpires

            if (authMode === AUTH_MODE.MC_REFRESH) {
                msAccessToken = authCode
                msRefreshToken = null
                msExpires = null
                logger.info('Reusing existing MS access token for MC refresh')
            } else {
                const accessTokenResponse = await MicrosoftAuth.getAccessToken(
                    authCode,
                    authMode === AUTH_MODE.MS_REFRESH,
                    MICROSOFT_CLIENT_ID
                )

                if (accessTokenResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                    throw new Error('Failed to get MS access token')
                }

                msAccessToken = accessTokenResponse.data.access_token
                msRefreshToken = accessTokenResponse.data.refresh_token
                msExpires = this.calculateExpiryDate(
                    new Date().getTime(),
                    accessTokenResponse.data.expires_in
                )

                logger.info('Microsoft access token obtained')
            }

            const xblResponse = await MicrosoftAuth.getXBLToken(msAccessToken)
            if (xblResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw new Error('Failed to get XBL token')
            }

            logger.info('XBL token obtained')

            const xstsResponse = await MicrosoftAuth.getXSTSToken(xblResponse.data)
            if (xstsResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                const errorCode = xstsResponse.microsoftErrorCode ?? MicrosoftErrorCode.UNKNOWN
                return Promise.reject(this.microsoftErrorDisplayable(errorCode))
            }

            logger.info('XSTS token obtained')

            const mcTokenResponse = await MicrosoftAuth.getMCAccessToken(xstsResponse.data)
            if (mcTokenResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                throw new Error('Failed to get MC access token')
            }

            const mcAccessToken = mcTokenResponse.data.access_token
            const mcExpires = this.calculateExpiryDate(
                new Date().getTime(),
                mcTokenResponse.data.expires_in
            )

            logger.info('Minecraft access token obtained')

            const mcProfileResponse = await MicrosoftAuth.getMCProfile(mcAccessToken)
            if (mcProfileResponse.responseStatus !== RestResponseStatus.SUCCESS) {
                const errorCode = mcProfileResponse.microsoftErrorCode ?? MicrosoftErrorCode.UNKNOWN
                logger.error('MC Profile request failed, errorCode:', errorCode)
                return Promise.reject(this.microsoftErrorDisplayable(errorCode))
            }

            const mcProfile = mcProfileResponse.data
            logger.info('Minecraft profile obtained:', mcProfile.name)

            return {
                accessToken: mcAccessToken,
                username: mcProfile.name,
                uuid: mcProfile.id,
                displayName: mcProfile.name,
                mcExpires,
                msAccessToken,
                msRefreshToken,
                msExpires
            }

        } catch (err) {
            logger.error('Microsoft auth error:', err)
            return Promise.reject(this.microsoftErrorDisplayable(MicrosoftErrorCode.UNKNOWN))
        }
    }

    static async addMicrosoftAccount(authCode) {
        try {
            const authData = await this.fullMicrosoftAuthFlow(authCode, AUTH_MODE.FULL)

            ConfigManager.addMicrosoftAccount(
                authData.uuid,
                authData.accessToken,
                authData.username,
                authData.displayName,
                authData.mcExpires,
                authData.msAccessToken,
                authData.msRefreshToken,
                authData.msExpires
            )

            ConfigManager.save()
            logger.info('Microsoft account added successfully')

            return authData
        } catch (err) {
            logger.error('Failed to add Microsoft account:', err)
            throw err
        }
    }

    static async validateSelectedMicrosoftAccount() {
        const uuid = ConfigManager.getSelectedAccount()
        if (!uuid) {
            logger.warn('No account selected')
            return false
        }

        const account = ConfigManager.getAccountByUUID(uuid)
        if (!account || account.type !== 'microsoft') {
            logger.warn('Invalid account or not Microsoft')
            return false
        }

        const now = new Date().getTime()

        if (account.expiresAt > now) {
            logger.info('MC token still valid')
            return true
        }

        logger.info('MC token expired, attempting refresh...')

        if (account.microsoft.expires_at > now) {
            logger.info('MS token valid, refreshing MC token only')
            const refreshed = await this.refreshMCToken(account)
            if (!refreshed) {
                logger.warn('Failed to refresh MC token, logging out user')
                this.removeAccount(uuid)
                return false
            }
            return true
        } else {
            logger.info('MS token expired, full refresh needed')
            const refreshed = await this.refreshMSToken(account)
            if (!refreshed) {
                logger.warn('Failed to refresh MS token, logging out user')
                this.removeAccount(uuid)
                return false
            }
            return true
        }
    }

    static async refreshMCToken(account) {
        try {
            logger.info('Attempting to refresh MC token for account:', account.uuid)
            const authData = await this.fullMicrosoftAuthFlow(
                account.microsoft.access_token,
                AUTH_MODE.MC_REFRESH
            )

            ConfigManager.updateMicrosoftAccount(
                account.uuid,
                authData.accessToken,
                authData.mcExpires,
                account.microsoft.access_token,
                account.microsoft.refresh_token,
                account.microsoft.expires_at
            )

            ConfigManager.save()
            logger.info('MC token refreshed successfully')
            return true
        } catch (err) {
            logger.error('Failed to refresh MC token:', err)
            return false
        }
    }

    static async refreshMSToken(account) {
        try {
            logger.info('Attempting to refresh MS token for account:', account.uuid)
            const authData = await this.fullMicrosoftAuthFlow(
                account.microsoft.refresh_token,
                AUTH_MODE.MS_REFRESH
            )

            ConfigManager.updateMicrosoftAccount(
                account.uuid,
                authData.accessToken,
                authData.mcExpires,
                authData.msAccessToken,
                authData.msRefreshToken,
                authData.msExpires
            )

            ConfigManager.save()
            logger.info('MS and MC tokens refreshed successfully')
            return true
        } catch (err) {
            logger.error('Failed to refresh MS token:', err)
            return false
        }
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

    static monitorTokenExpiration() {
        const uuid = ConfigManager.getSelectedAccount()
        if (!uuid) return null

        const account = ConfigManager.getAccountByUUID(uuid)
        if (!account || account.type !== 'microsoft') return null

        const now = new Date().getTime()

        if (account.expiresAt <= now && account.microsoft.expires_at <= now) {
            logger.warn('Both MC and MS tokens expired, logging out user')
            this.removeAccount(uuid)
            return { expired: true, message: 'Session expired. Please login again.' }
        }

        return { expired: false }
    }

    static calculateExpiryDate(nowMs, expiresInS) {
        return nowMs + ((expiresInS - 10) * 1000)
    }

    static microsoftErrorDisplayable(errorCode) {
        switch (errorCode) {
            case MicrosoftErrorCode.NO_PROFILE:
                return {
                    title: 'Error: No Minecraft Profile',
                    desc: 'This Microsoft account does not own Minecraft. Please purchase Minecraft or use a different account.'
                }
            case MicrosoftErrorCode.NO_XBOX_ACCOUNT:
                return {
                    title: 'Error: No Xbox Account',
                    desc: 'This Microsoft account does not have an Xbox account. Please create one and try again.'
                }
            case MicrosoftErrorCode.XBL_BANNED:
                return {
                    title: 'Error: Xbox Live Banned',
                    desc: 'This Xbox account is banned from Xbox Live.'
                }
            case MicrosoftErrorCode.UNDER_18:
                return {
                    title: 'Error: Underage Account',
                    desc: 'This account belongs to someone under 18. You must be added to a family by an adult.'
                }
            default:
                return {
                    title: 'Unknown Error',
                    desc: 'An unknown error occurred during authentication. Please try again.'
                }
        }
    }
}

export default AuthManager
