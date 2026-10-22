// MAIN-world entry point (E1 D1, D3, D4), bundled into src/content/main-world.js by `npm run gen`.
// Installs the recorder at document_start, binds the private channel to the ISOLATED bridge and
// answers its messages: `config` (per-document gate), `collect` (current document as a JSON string),
// `destroy`. At `pagehide` it hands the buffers over once more (`flush`) so a reload keeps them.
// No extension API in this world: the bridge is the only way to the background.

import { isInstalled, createRecorder } from './recorder.js';
import { connectMain } from './channel.js';
import { collectPageState } from './collector.js';
import { safeSlice } from './serialize.js';
import { RECORDER_VERSION } from './constants.js';

function mainTry(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function mainIsDocId(value) {
  return (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value !== '' && value.length <= 200);
}

/**
 * Starts the recorder in `win` unless one is already there (AC-5.5).
 * @param {{ win: Window, doc: Document }} input
 */
export function bootMain({ win, doc }) {
  if (isInstalled(win)) return;

  // Intrinsics captured before page scripts run.
  const apply = Reflect.apply;
  const stringify = mainTry(() => win.JSON.stringify, JSON.stringify);
  const proto = mainTry(() => win.EventTarget.prototype, null);
  const addListener = mainTry(() => proto.addEventListener, null);
  const removeListener = mainTry(() => proto.removeEventListener, null);

  let channel = null;
  let docId = null;
  let configured = false;
  let recorded = false; // got `record:true`, so this document has data worth flushing
  let closed = false;

  const rec = createRecorder({
    win,
    options: {
      onStopped: (reason) => {
        if (channel) channel.send('stopped', { reason });
      },
    },
  });
  if (!rec.install()) return;

  function onPageHide() {
    if (!recorded || closed || !channel) return;
    mainTry(() => channel.send('flush', { docId, data: { ...rec.snapshot(), docId } }));
  }

  function teardown() {
    rec.destroy();
    recorded = false;
    if (closed) return;
    closed = true;
    mainTry(() => apply(removeListener, win, ['pagehide', onPageHide, true]));
    if (channel) channel.close();
  }

  function onConfig(payload) {
    if (configured) return;
    configured = true;
    const cfg = payload && typeof payload === 'object' ? payload : {};
    if (mainIsDocId(cfg.docId)) docId = cfg.docId;
    if (cfg.record === true) {
      rec.setConfig({ record: true, docId, deadline: cfg.deadline });
      // Active, or stopped at once because the deadline already passed; false if the fail-safe already fired.
      recorded = rec.isActive || rec.stopReason !== null;
    } else {
      // Not recorded: hooks and data go now; the channel stays for a `collect` after the time limit.
      rec.setConfig({ record: false });
      recorded = false;
    }
  }

  function onCollect(id) {
    let raw;
    try {
      const result = { ...collectPageState({ win, doc, safeSlice }), ...rec.snapshot() };
      if (result.docId === null || result.docId === undefined) result.docId = docId;
      raw = apply(stringify, win.JSON, [result]);
    } catch {
      raw = null;
    }
    channel.send('result', typeof raw === 'string' ? raw : null, id);
  }

  channel = connectMain({
    doc,
    version: RECORDER_VERSION,
    onUnbound: () => teardown(),
    onMessage: ({ type, payload, id }) => {
      if (closed) return;
      if (type === 'config') onConfig(payload);
      else if (type === 'collect') onCollect(id);
      else if (type === 'destroy') teardown();
    },
  });

  if (addListener) mainTry(() => apply(addListener, win, ['pagehide', onPageHide, true]));
}

bootMain({ win: window, doc: document });
