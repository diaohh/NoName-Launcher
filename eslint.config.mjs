import js from '@eslint/js'
import globals from 'globals'
import stylistic from '@stylistic/eslint-plugin'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

/**
 * The launcher's indentation is deliberately not uniform: the managers were written at 4
 * spaces and everything else at 2. Reformatting the whole tree would bury the history of
 * files that are still being worked on, so the linter enforces what each area already
 * uses instead of picking a winner. `tools/` runs on plain node outside the bundle and is
 * left alone.
 */
export default [
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'tools/**', '*.out.mjs']
  },

  js.configs.recommended,

  // Main process, preload and the code shared with the renderer.
  {
    files: ['src/main/**/*.js', 'src/preload/**/*.js', 'src/shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },

  // 4 spaces: the managers, the utils and the auth window.
  {
    files: ['src/main/managers/**/*.js', 'src/main/utils/**/*.js', 'src/main/windows/**/*.js'],
    plugins: { '@stylistic': stylistic },
    rules: { '@stylistic/indent': ['error', 4, { SwitchCase: 1 }] }
  },

  // 2 spaces: the entry point, the IPC layer, the preload and the shared constants.
  {
    files: ['src/main/index.js', 'src/main/ipc/**/*.js', 'src/preload/**/*.js', 'src/shared/**/*.js'],
    plugins: { '@stylistic': stylistic },
    rules: { '@stylistic/indent': ['error', 2, { SwitchCase: 1 }] }
  },

  // Renderer.
  {
    files: ['src/renderer/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Inlined at build time by electron.vite.config.mjs.
        __APP_VERSION__: 'readonly'
      },
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    // Pinned, not 'detect': eslint-plugin-react's detection reaches for an ESLint 9
    // context API that ESLint 10 no longer has, and crashes the whole run.
    settings: { react: { version: '19.0' } },
    plugins: {
      '@stylistic': stylistic,
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs['recommended-latest'].rules,
      // Every context in this codebase exports its provider and its `use*` hook from
      // the same file, on purpose. The rule fires on all four and would never be acted
      // on, so it is noise rather than signal here.
      'react-refresh/only-export-components': 'off',
      // Template literals hold Tailwind class lists laid out for readability, not JS
      // indentation; letting the rule reflow them makes the classes harder to read.
      '@stylistic/indent': ['error', 2, { SwitchCase: 1, ignoredNodes: ['TemplateLiteral *'] }],
      '@stylistic/semi': ['error', 'never'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // The launcher's UI copy is Spanish prose full of apostrophes and quotes.
      'react/no-unescaped-entities': 'off',
      'react/prop-types': 'off'
    }
  },

  // Build configuration runs on node.
  {
    files: ['*.config.mjs', '*.config.js', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    }
  }
]
