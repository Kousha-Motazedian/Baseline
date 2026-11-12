import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', '*.config.ts', 'tools/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The headless core must stay deterministic and UI-free (see CLAUDE.md).
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded RNG in src/core/shared/rng.ts.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'react',
            'react-dom',
            'electron',
            '**/renderer/**',
            '**/main/**',
            'node:fs',
            'fs',
          ],
        },
      ],
    },
  },
)
