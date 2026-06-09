// Flat ESLint config for @rekurt/ohlcv-react.
//
// Scopes:
//   - src/ — strict TypeScript + no-console (lib code should dispatch
//     through ErrorReporter, not log)
//   - example/ — relaxed: allow console, allow any to keep demo code
//     focused on the feature under demonstration

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  // Ignore built output, deps, and vendored tarballs.
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'vendor/**', '**/*.d.ts', '**/*.d.cts'],
  },

  // Base JS + TS recommended rules.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React rules for library + example.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'example/src/**/*.ts', 'example/src/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
    settings: {
      react: { version: 'detect' },
    },
  },

  // Library source — strict.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Example app — relaxed. Demo code logs stuff and uses `any` when it
  // keeps the example simple.
  {
    files: ['example/src/**/*.ts', 'example/src/**/*.tsx'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Test files — relax unused-vars for typed test stubs.
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
