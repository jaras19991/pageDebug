import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // tests/e2e/spike*/: throwaway spikes (E0-T17 PB-1, E3, E4), not part of the suite.
    ignores: ['dist/', 'coverage/', 'test-results/', 'playwright-report/', 'tests/e2e/spike/', 'tests/e2e/spike-e3/', 'tests/e2e/spike-e4/',
      // QA one-off scripts kept as evidence next to qa-report.md (E4-FIX2).
      'docs/epics/*/qa/**'],
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
    files: ['src/content/**/*.js', 'src/standalone/**/*.js'],
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
    // Masking path in MAIN (E4 D9, IN2) and every other MAIN module the recording passes through (IN2b: recorder, hooks,
    // serialize, collector, vitals, channel): a page may replace Array.prototype[Symbol.iterator] after document_start, so
    // no iteration protocol: index loops instead. Module-level code runs before the page and may opt out with a reason.
    // ISOLATED-only modules (own realm, the page cannot reach its built-ins) are left out.
    files: ['src/lib/redact-rules.js', 'src/lib/mask-secrets.js', 'src/page/**/*.js'],
    ignores: ['src/page/isolated-entry.js', 'src/page/field-rects.js'],
    rules: {
      'no-restricted-syntax': ['error',
        ...['ForOfStatement', 'ArrayPattern', 'ArrayExpression > SpreadElement', 'CallExpression > SpreadElement',
          'NewExpression > SpreadElement', "CallExpression[callee.object.name='Array'][callee.property.name='from']"]
          .map((selector) => ({ selector, message: 'MAIN world: use an index loop (the page may replace the array iterator, E4-IN2).' })),
        ...['Set', 'Map', 'WeakSet', 'WeakMap'].map((name) => ({
          selector: `:function NewExpression[callee.name='${name}'][arguments.length>0]`,
          message: `MAIN world: new ${name}(iterable) iterates; fill it in an index loop (E4-IN2).`,
        })),
      ],
    },
  },
  {
    // Developer viewer (E4 D3, AC-4.5): ES modules bundled into src/standalone/viewer.html. Package data is
    // untrusted; DOM only through src/viewer/dom.js (text nodes, attribute whitelist), no network, no extension API.
    files: ['src/viewer/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-restricted-properties': ['error',
        ...['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'srcdoc', 'setHTMLUnsafe', 'createContextualFragment',
          'setAttribute', 'setAttributeNS', 'setAttributeNode', 'setAttributeNodeNS']
          .map((property) => ({ property, message: 'Viewer DOM only through h()/textBlock()/setImageBytes() from src/viewer/dom.js.' })),
        ...['write', 'writeln'].map((property) => ({ object: 'document', property, message: 'Viewer DOM only through src/viewer/dom.js.' })),
        ...['window', 'globalThis', 'self'].map((object) => ({ object, property: 'fetch', message: 'The viewer works offline: no network.' })),
      ],
      'no-restricted-globals': ['error', 'importScripts', 'chrome', 'browser', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'DOMParser'],
    },
  },
  {
    // Local MCP server (E4 D6): Node ESM, read-only, no network (AC-5.8; the static import check is in mcp-tools tests).
    files: ['mcp/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-globals': ['error', 'importScripts', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
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
    files: ['tests/unit/serialize.test.js', 'tests/unit/viewer-*.test.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
