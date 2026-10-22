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
    // Page code as ES modules (E1 D6), bundled into classic IIFEs by scripts/gen-content.mjs.
    files: ['src/page/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },
  {
    // ISOLATED world entry: the only page module allowed to use the extension API.
    files: ['src/page/isolated-entry.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
  {
    // Generated content scripts and the console fallback: classic scripts, no chrome.*.
    // page-debug-snapshot.js is the E0 classic script (removed in E1-T17).
    files: ['src/content/**/*.js', 'src/standalone/**/*.js', 'src/page/page-debug-snapshot.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },
  {
    // Background (service worker in Chrome, event page in Firefox) and its library: no DOM.
    files: ['src/lib/**/*.js', 'src/background.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.webextensions, ...globals.serviceworker },
    },
    rules: {
      'no-restricted-globals': ['error', 'importScripts', 'window', 'document'],
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
    files: [
      'tests/unit/helpers/load-page-script.js',
      'tests/unit/page-debug-snapshot.test.js',
      'tests/unit/serialize.test.js',
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
