import js from '@eslint/js'
import globals from 'globals'
import stylistic from '@stylistic/eslint-plugin'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/**
 * The launcher's indentation is deliberately not uniform: the managers were written at 4
 * spaces and everything else at 2. Reformatting the whole tree would bury the history of
 * files that are still being worked on, so the linter enforces what each area already
 * uses instead of picking a winner (ADR-0011). The globs cover `.ts`/`.tsx` as well, so a
 * file converted to TypeScript keeps the width of its area. `tools/` runs on plain node
 * outside the bundle and is left alone.
 */
export default [
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'tools/**', '*.out.mjs']
  },

  js.configs.recommended,

  // Main process, preload and the code shared with the renderer.
  {
    files: ['src/main/**/*.{js,ts}', 'src/preload/**/*.{js,ts}', 'src/shared/**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        // Inlined at build time by electron.vite.config.mjs.
        __MICROSOFT_CLIENT_ID__: 'readonly'
      }
    },
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },

  // 4 spaces: the managers, the utils, the auth window, the test support and the data types
  // the managers read.
  {
    files: [
      'src/main/managers/**/*.{js,ts}',
      'src/main/utils/**/*.{js,ts}',
      'src/main/windows/**/*.{js,ts}',
      'src/main/testing/**/*.{js,ts}',
      'src/main/types/**/*.ts'
    ],
    plugins: { '@stylistic': stylistic },
    rules: { '@stylistic/indent': ['error', 4, { SwitchCase: 1 }] }
  },

  // 2 spaces: the files at the root of src/main (entry point, constants, declarations), the
  // IPC layer, the preload and the shared constants.
  {
    files: [
      'src/main/*.{js,ts}',
      'src/main/ipc/**/*.{js,ts}',
      'src/preload/**/*.{js,ts}',
      'src/shared/**/*.{js,ts}'
    ],
    plugins: { '@stylistic': stylistic },
    rules: { '@stylistic/indent': ['error', 2, { SwitchCase: 1 }] }
  },

  // Renderer.
  {
    files: ['src/renderer/**/*.{js,jsx,ts,tsx}'],
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

  // TypeScript, wherever it lives: the parser and the recommended rules. Style (semicolons,
  // quotes, indentation) comes from the blocks above, whose globs match .ts/.tsx too.
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['**/*.{ts,tsx}'] })),
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // The core rule does not understand types and reports names used only as one.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
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
