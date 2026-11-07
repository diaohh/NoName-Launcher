/**
 * Build-time constants of the main process.
 *
 * `__MICROSOFT_CLIENT_ID__` is inlined by `electron.vite.config.mjs` from `.env` (or the
 * environment) and the build fails without it, so there is no runtime lookup and no fallback
 * literal: dev and the packaged launcher sign in against the same Azure app by construction.
 */
export const MICROSOFT_CLIENT_ID = __MICROSOFT_CLIENT_ID__
