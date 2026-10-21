import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // tests/e2e/spike/: throwaway PB-1 spike (E0-T17), superseded by the E0-T16b harness.
    ignores: ['dist/', 'coverage/', 'test-results/', 'playwright-report/', 'tests/e2e/spike/'],
  },
  js.configs.recommended,
  {
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-globals': ['error', 'importScripts'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Popup: ES modules with access to the extension API.
    files: ['src/popup/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
  {
    // Injected into the page's MAIN world: classic scripts, no chrome.*.
    files: ['src/page/**/*.js', 'src/standalone/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}', 'tests/**/*.js', '*.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // Fixture pages served to the browser in e2e tests: classic scripts.
    files: ['tests/fixtures/pages/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    // Fixtures may also declare `/* global window, document */` for standalone readability.
    rules: { 'no-redeclare': ['error', { builtinGlobals: false }] },
  },
  {
    // Unit tests running under `// @vitest-environment jsdom`: Node plus DOM globals.
    files: ['tests/unit/helpers/load-page-script.js', 'tests/unit/page-debug-snapshot.test.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
