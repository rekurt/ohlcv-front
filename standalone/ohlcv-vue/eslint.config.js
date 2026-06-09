// Flat ESLint config for @rekurt/ohlcv-vue.
//
// Scopes:
//   - src/ — strict TypeScript + no-console (lib code should dispatch
//     through ErrorReporter, not log)
//   - example/ — relaxed: allow console, allow any to keep demo code
//     focused on the feature under demonstration

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vuePlugin from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import globals from 'globals';

export default [
  // Ignore built output, deps, and vendored tarballs.
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'vendor/**', '**/*.d.ts', '**/*.d.cts'],
  },

  // Base JS + TS recommended rules.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Library source — strict.
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { vue: vuePlugin },
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

  // Vue SFCs (example app).
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: { ...globals.browser },
    },
    plugins: { vue: vuePlugin },
    rules: {
      ...vuePlugin.configs['flat/recommended'].rules,
      'vue/multi-word-component-names': 'off',
    },
  },

  // Example app — relaxed. Demo code logs stuff and uses `any` when it
  // keeps the example simple.
  {
    files: ['example/src/**/*.ts', 'example/src/**/*.vue'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Test files — relax unused-vars for typed test stubs.
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
