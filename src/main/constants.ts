/**
 * Build-time constants of the main process.
 *
 * `__MICROSOFT_CLIENT_ID__` is inlined by `electron.vite.config.mjs` from `.env` (or the
 * environment) and the build fails without it, so there is no runtime lookup and no fallback
 * literal: dev and the packaged launcher sign in against the same Azure app by construction.
 */
export const MICROSOFT_CLIENT_ID = __MICROSOFT_CLIENT_ID__

/**
 * Where Microsoft sends the authorization code back: the native-client page the sign-in window
 * watches for (`windows/msftAuth.ts`). The token request must repeat it exactly.
 */
export const MICROSOFT_REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient'

/** What the launcher asks for: Xbox Live sign-in, and a refresh token to stay signed in. */
export const MICROSOFT_SCOPE = 'XboxLive.signin offline_access'
