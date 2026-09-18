import { app } from 'electron'
import dotenv from 'dotenv'

/**
 * Loads `.env` for development only, and must be the first import of the entry point:
 * AuthManager reads `MICROSOFT_CLIENT_ID` when its module is evaluated.
 *
 * A packaged build never reads it. `.env` is not shipped, and reading one from the working
 * directory would let any folder the launcher happens to be started from change how it
 * behaves — `ELECTRON_RENDERER_URL` alone is enough to point the window, preload bridge
 * included, at a remote page.
 */
if (!app.isPackaged) {
  dotenv.config()
}
