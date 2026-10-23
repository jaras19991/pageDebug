// Shared constants of the page recorder (E1 D5/D6). RECORDER_VERSION must equal `version` in
// src/manifest.base.json (guarded by tests/unit/recorder.test.js), so a release has to run `npm run gen`.

export const RECORDER_VERSION = '0.4.0';

// Version of the MAIN <-> ISOLATED message protocol; 2 = `collect` result with steps, vitals, documentStatus
// (E2 D8). Mirrored by RESULT_PROTOCOL in src/lib/save.js.
export const PROTOCOL = 2;

// Per-document buffer limits (D5): entries per section, chars per serialized value, chars of all entries.
// `responseBodyChars`/`stackChars`/`longTasks` mirror the limits enforced in hooks-network, serialize and
// vitals-math, so the package can report them; `responseBodyTotalChars` is the per-document preview budget (D3).
export const LIMITS = Object.freeze({
  consoleLogs: 5000,
  runtimeErrors: 1000,
  network: 5000,
  steps: 2000,
  entryChars: 40000, // a 16 000-char stack plus a 5-level cause chain fit in one console entry (E2-T7a)
  stackChars: 16000,
  responseBodyChars: 4096,
  responseBodyTotalChars: 262144,
  longTasks: 20,
  documentChars: 4000000,
});

// Key for Symbol.for(): the install marker on the page window (AC-5.5).
export const MARKER_KEY = 'pds.installed';

// Without a `config` from the background within this time the recorder removes itself (D1 fail-safe).
export const CONFIG_TIMEOUT_MS = 10000;

export const CONSOLE_LEVELS = Object.freeze(['log', 'info', 'warn', 'error', 'debug']);
