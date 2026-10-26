// Entry of the console fallback (E1-T7, US-7; E3-T9): bundled by scripts/gen-content.mjs into
// src/standalone/console-snapshot.js, which a developer pastes into DevTools when the extension is not installed.
// Same recorder and collector as the extension; there is no background, so it records from the paste on,
// without a time limit, and saves the package itself through <a download>: the same v4 zip and the same redaction
// as the extension (export.js, AC-3.7, question 5). What needs the extension (screenshots) is empty with a note;
// INP counts only interactions after the paste (AC-7.5, AC-5.8). The redaction runs in the page realm, after the
// page's scripts, so a hostile page can defeat it (not covered by AC-3.6; docs/snapshot-schema.md).
// window.PageDebugSnapshot is the only page global, a deliberate exception to AC-5.4 for this mode:
// the user needs a name to call download() on. No extension APIs here (runs as a page script).
// Top-level helpers carry the `console` prefix (D6: all modules end up in one IIFE).

import { createRecorder, isInstalled } from './recorder.js';
import { collectPageState } from './collector.js';
import { safeSlice } from './serialize.js';
import { RECORDER_VERSION } from './constants.js';
import { assembleParts } from '../lib/package.js';
import { exportAssembled } from '../lib/export.js';

const CONSOLE_GLOBAL = 'PageDebugSnapshot';
const CONSOLE_REVOKE_MS = 60000;
const CONSOLE_INP_NOTE = 'INP covers only interactions after the script was pasted.';

const CONSOLE_TEXT = {
  started: 'Zbieram od teraz. Odtwórz problem i wywołaj PageDebugSnapshot.download().',
  running: 'PageDebugSnapshot już działa. Odtwórz problem i wywołaj PageDebugSnapshot.download().',
  extension: 'Rozszerzenie już nagrywa tę stronę — użyj przycisku „Zapisz paczkę”.',
  stopped: 'Zbieranie zatrzymane. Aby zbierać od nowa, odśwież stronę i wklej skrypt jeszcze raz.',
};

function consoleTry(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function consoleBoot(win) {
  // Captured before the console hook is installed, so our own messages are not recorded.
  const info = win.console.info;
  const say = (text) => {
    try {
      Reflect.apply(info, win.console, [text]);
    } catch {
      // console replaced by the page: nothing to report to
    }
  };

  if (isInstalled(win)) {
    const existing = win[CONSOLE_GLOBAL];
    say(existing && existing.version === RECORDER_VERSION ? CONSOLE_TEXT.running : CONSOLE_TEXT.extension);
    return;
  }

  // Buffered entries give TTFB/FCP/LCP/CLS from before the paste; interactions from then are not seen whole.
  const pastedAt = consoleTry(() => win.performance.now(), null);
  const rec = createRecorder({ win, options: typeof pastedAt === 'number' ? { interactionsSince: pastedAt } : {} });
  const startedAt = Date.now();
  if (!rec.install()) return;
  rec.setConfig({ record: true });

  // The export pipeline of the extension (assemble → redact → budget → summary → zip) without a screenshot or
  // developer options. assembleParts + exportAssembled = exportPackage, with the INP note added before redaction.
  async function exportZip() {
    const current = { ...collectPageState({ win, doc: win.document, safeSlice }), ...rec.snapshot() };
    const { pkg } = assembleParts({
      meta: {
        extensionVersion: RECORDER_VERSION,
        source: 'console',
        startedAt,
        collectedAt: Date.now(),
        stopReason: null,
        screenshots: [],
        screenshotNote: 'Screenshots are not available without the extension.',
      },
      current,
    });
    if (pkg.vitals.some((v) => v.INP)) pkg.notes.push(CONSOLE_INP_NOTE);
    const origin = consoleTry(() => win.location.origin, undefined);
    return exportAssembled(pkg, { devOptions: {}, date: new Date(), origin });
  }

  /** The redacted package object, the same one download() writes as snapshot.json. @returns {Promise<object>} */
  async function snapshot() {
    return (await exportZip()).snapshot;
  }

  /** Saves snapshot-<host>-<YYYYMMDD-HHMMSS>.zip. @returns {Promise<string>} the file name */
  async function download() {
    const { bytes, fileName } = await exportZip();
    const blob = new win.Blob([bytes], { type: 'application/zip' });
    const url = win.URL.createObjectURL(blob);
    const link = win.document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    (win.document.body || win.document.documentElement).appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
      win.setTimeout(() => win.URL.revokeObjectURL(url), CONSOLE_REVOKE_MS);
    }
    return fileName;
  }

  // Recording starts on paste; after stop() the marker stays on the window, so it cannot be restarted here.
  function start() {
    if (rec.isActive) return true;
    say(CONSOLE_TEXT.stopped);
    return false;
  }

  function stop() {
    rec.stop('user');
  }

  win[CONSOLE_GLOBAL] = Object.freeze({ version: RECORDER_VERSION, start, stop, download, snapshot });
  say(CONSOLE_TEXT.started);
}

consoleBoot(window);
