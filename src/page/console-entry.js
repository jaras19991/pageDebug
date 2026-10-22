// Entry of the console fallback (E1-T7, US-7): bundled by scripts/gen-content.mjs into
// src/standalone/console-snapshot.js, which a developer pastes into DevTools when the extension is not installed.
// Same recorder and collector as the extension; there is no background, so it records from the paste on,
// without a time limit, and saves the v2 package itself through <a download>.
// window.PageDebugSnapshot is the only page global, a deliberate exception to AC-5.4 for this mode:
// the user needs a name to call download() on. No extension APIs here (runs as a page script).
// Top-level helpers carry the `console` prefix (D6: all modules end up in one IIFE).

import { createRecorder, isInstalled } from './recorder.js';
import { collectPageState } from './collector.js';
import { safeSlice } from './serialize.js';
import { RECORDER_VERSION } from './constants.js';
import { assemblePackage, packageFileName } from '../lib/package.js';

const CONSOLE_GLOBAL = 'PageDebugSnapshot';
const CONSOLE_REVOKE_MS = 60000;

const CONSOLE_TEXT = {
  started: 'Zbieram od teraz. Odtwórz problem i wywołaj PageDebugSnapshot.download().',
  running: 'PageDebugSnapshot już działa. Odtwórz problem i wywołaj PageDebugSnapshot.download().',
  extension: 'Rozszerzenie już nagrywa tę stronę — użyj przycisku „Zapisz paczkę”.',
  stopped: 'Zbieranie zatrzymane. Aby zbierać od nowa, odśwież stronę i wklej skrypt jeszcze raz.',
};

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

  const rec = createRecorder({ win });
  const startedAt = Date.now();
  if (!rec.install()) return;
  rec.setConfig({ record: true });

  function snapshot() {
    const current = { ...collectPageState({ win, doc: win.document, safeSlice }), ...rec.snapshot() };
    return assemblePackage({
      meta: { extensionVersion: RECORDER_VERSION, source: 'console', startedAt, collectedAt: Date.now(), stopReason: null },
      current,
    });
  }

  function download() {
    const fileName = packageFileName(Date.now());
    const blob = new win.Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
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
