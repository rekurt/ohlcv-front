// Flat ESLint config for the @rekurt/openkline monorepo.
//
// Scopes:
//   - packages/core — strict TypeScript + no-console (lib code should
//     dispatch through ErrorReporter, not log)
//   - examples/** — relaxed: allow console, allow any to keep demo code
//     focused on the feature under demonstration
//
// The React and Vue wrappers live in their own repositories
// (rekurt/openkline-react, rekurt/openkline-vue) with their own ESLint configs.
//
// Keep rule additions minimal in M1 — the goal is to establish a clean
// baseline for CI, not to prescribe taste. Subsequent milestones can
// tighten.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  // Ignore built output, deps, and generated docs.
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'docs/api/**',
      '.claude/**',
      'standalone/**',
      '**/*.d.ts',
      '**/*.d.cts',
    ],
  },

  // Base JS + TS recommended rules.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Library packages — strict.
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
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

  // Playground — a React app demonstrating the vanilla core.
  {
    files: ['examples/playground/**/*.ts', 'examples/playground/**/*.tsx'],
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

  // Examples — relaxed. Demo apps log stuff, use `any` when it keeps the
  // example simple, and import from built dist paths.
  {
    files: ['examples/**/*.ts', 'examples/**/*.tsx'],
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
