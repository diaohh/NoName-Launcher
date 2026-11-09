/// <reference types="electron-vite/node" />

/**
 * The Azure application id, inlined into the main bundle by electron.vite.config.mjs (and by
 * vitest.config.mjs under test). Read it through `constants`, never directly.
 */
declare const __MICROSOFT_CLIENT_ID__: string
