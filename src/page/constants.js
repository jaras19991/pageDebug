// Shared constants of the page recorder (E1 D5/D6). RECORDER_VERSION must equal `version` in
// src/manifest.base.json (guarded by tests/unit/recorder.test.js), so a release has to run `npm run gen`.

export const RECORDER_VERSION = '0.2.0';

// Version of the MAIN <-> ISOLATED message protocol.
export const PROTOCOL = 1;

// Per-document buffer limits (D5): entries per section, chars per serialized value, chars of all entries.
export const LIMITS = Object.freeze({
  consoleLogs: 5000,
  runtimeErrors: 1000,
  network: 5000,
  entryChars: 10000,
  documentChars: 4000000,
});

// Key for Symbol.for(): the install marker on the page window (AC-5.5).
export const MARKER_KEY = 'pds.installed';

// Without a `config` from the background within this time the recorder removes itself (D1 fail-safe).
export const CONFIG_TIMEOUT_MS = 10000;

export const CONSOLE_LEVELS = Object.freeze(['log', 'info', 'warn', 'error', 'debug']);
