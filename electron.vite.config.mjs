import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The renderer is sandboxed and cannot read package.json at runtime, so the launcher
// version is inlined at build time. The main process reads the same value through
// `app.getVersion()`; package.json stays the single source.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
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
})
