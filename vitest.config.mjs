import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

/**
 * Its own config rather than electron.vite.config.mjs: that one builds three targets (main,
 * preload, renderer) and resolves the Azure client id from `.env`, and the tests need none
 * of it — they import the sources directly, on node.
 *
 * Tests sit next to the file they cover (`X.test.ts` beside `X.ts`) and the coverage is
 * minimal on purpose: what fails silently, and what the TypeScript migration rewrites.
 */
export default defineConfig({
  resolve: {
    alias: [
      // The real package only resolves to the path of the Electron binary under node.
      { find: /^electron$/, replacement: fileURLToPath(new URL('./src/main/testing/electron.ts', import.meta.url)) }
    ]
  },
  define: {
    // Inlined by electron.vite.config.mjs in a real build. No test talks to Microsoft.
    __MICROSOFT_CLIENT_ID__: JSON.stringify('00000000-0000-0000-0000-000000000000'),
    __APP_VERSION__: JSON.stringify('0.0.0-test')
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // The managers log every step through winston; only a failing test's output is worth reading.
    silent: 'passed-only'
  }
})
