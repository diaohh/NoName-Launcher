import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The renderer is sandboxed and cannot read package.json at runtime, so the launcher
// version is inlined at build time. The main process reads the same value through
// `app.getVersion()`; package.json stays the single source.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

const AZURE_CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The Azure app the launcher signs in with, inlined into the main bundle.
 *
 * `.env` is not shipped with the installer, so reading it at runtime used to mean a literal
 * fallback in two files — and that literal was what every packaged build actually ran
 * with, whatever `.env` said. Resolving it here gives dev and production one source, and a
 * build without it fails instead of quietly signing in against some other app.
 * A variable set in the environment (CI) wins over `.env`.
 */
function resolveMicrosoftClientId(mode) {
  const fromEnvFile = loadEnv(mode, process.cwd(), '').MICROSOFT_CLIENT_ID
  const clientId = (process.env.MICROSOFT_CLIENT_ID || fromEnvFile || '').trim()

  if (!AZURE_CLIENT_ID.test(clientId)) {
    throw new Error(
      'MICROSOFT_CLIENT_ID is missing or is not an Azure application id. ' +
      'Set it in .env (see .env.example) or in the environment before building.'
    )
  }

  return clientId
}

export default defineConfig(({ mode }) => ({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __MICROSOFT_CLIENT_ID__: JSON.stringify(resolveMicrosoftClientId(mode))
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    root: './src/renderer',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    build: {
      rollupOptions: {
        input: './src/renderer/index.html'
      }
    }
  }
}))
