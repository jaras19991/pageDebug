// ISOLATED-world entry point (E1 D1, D3, D4), bundled into src/content/isolated-world.js by `npm run gen`.
// The bridge: asks the background whether this document is recorded (`hello`) and forwards the answer
// to MAIN as `config`; relays `collect`/`destroy` from the background to MAIN and `flush`/`stopped`
// from MAIN to the background. Sees no page JavaScript; the only module that uses the extension API.
// When the extension context is gone (update, reload) every call fails and the bridge stays silent.

import { connectIsolated } from './channel.js';

const BRIDGE_BIND_TIMEOUT_MS = 2000;
// Same order as the background's collect timeout; a busy page answers null instead of hanging.
const BRIDGE_COLLECT_TIMEOUT_MS = 10000;
// One retry when nobody answers `hello` (background still starting).
const BRIDGE_RETRY_MS = 500;
const BRIDGE_MAX_PENDING = 4;
const BRIDGE_URL_MAX = 4000;
const BRIDGE_REASON_MAX = 64;

function bridgeTry(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// crypto.randomUUID needs a secure context; getRandomValues works on http pages too.
function bridgeNonce(win) {
  const bytes = new Uint8Array(16);
  win.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {{ win: Window, doc: Document, api: object }} input `api` is the extension namespace (`chrome`).
 */
export function bootIsolated({ win, doc, api }) {
  const runtime = bridgeTry(() => api.runtime, null);
  if (!runtime || !bridgeTry(() => runtime.id, null)) return;

  const later = (fn, ms) => win.setTimeout(fn, ms);
  const cancel = (id) => win.clearTimeout(id);
  const pending = new Map(); // collect id → { respond, timer }
  let seq = 0;
  let docId = null;
  let finished = false;

  async function toBackground(message) {
    try {
      return await runtime.sendMessage(message);
    } catch {
      return undefined;
    }
  }

  async function hello() {
    const message = { type: 'hello', url: bridgeTry(() => String(win.location.href).slice(0, BRIDGE_URL_MAX), null) };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const reply = await runtime.sendMessage(message);
        return reply && typeof reply === 'object' ? reply : null;
      } catch {
        if (attempt === 0) await new Promise((resolve) => later(resolve, BRIDGE_RETRY_MS));
      }
    }
    return null;
  }

  function settle(id, value) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    cancel(entry.timer);
    bridgeTry(() => entry.respond(value));
  }

  function onMainMessage({ type, payload, id }) {
    if (type === 'result') {
      settle(id, typeof payload === 'string' ? payload : null);
    } else if (type === 'flush') {
      if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') return;
      toBackground({ type: 'flush', docId: docId ?? payload.docId, data: payload.data });
    } else if (type === 'stopped') {
      const reason = String(payload && payload.reason ? payload.reason : 'unknown').slice(0, BRIDGE_REASON_MAX);
      toBackground({ type: 'stopped', reason });
    }
  }

  const replied = hello();

  const channel = connectIsolated({
    doc,
    onMessage: onMainMessage,
    bindTimeoutMs: BRIDGE_BIND_TIMEOUT_MS,
    randomUUID: () => bridgeNonce(win),
    onUnbound: () => {
      // After `hello`, so the background marks the document it just opened instead of a new one.
      replied.then(() => toBackground({ type: 'bridgeError', reason: 'unbound', ...(docId !== null ? { docId } : {}) }));
    },
  });

  replied.then(async (reply) => {
    if (reply && reply.docId !== undefined) docId = reply.docId;
    const config = reply
      ? { record: reply.record === true, docId: reply.docId, deadline: reply.deadline, limitMs: reply.limitMs }
      : { record: false };
    if (await channel.whenBound) channel.send('config', config);
  });

  function collect(respond) {
    if (finished || !channel.isBound() || pending.size >= BRIDGE_MAX_PENDING) {
      respond(null);
      return;
    }
    seq += 1;
    const id = `c${seq}`;
    pending.set(id, { respond, timer: later(() => settle(id, null), BRIDGE_COLLECT_TIMEOUT_MS) });
    if (!channel.send('collect', null, id)) settle(id, null);
  }

  function finish() {
    finished = true;
    channel.send('destroy', null);
    channel.close();
    for (const id of [...pending.keys()]) settle(id, null);
    bridgeTry(() => runtime.onMessage.removeListener(onRuntimeMessage));
  }

  function onRuntimeMessage(message, sender, sendResponse) {
    if (!message || typeof message !== 'object') return false;
    if (!sender || sender.id !== runtime.id || sender.tab) return false; // only the background
    if (message.type === 'collect') {
      collect(sendResponse);
      return true;
    }
    if (message.type === 'destroy' && !finished) finish();
    return false;
  }

  bridgeTry(() => runtime.onMessage.addListener(onRuntimeMessage));
}

bootIsolated({ win: window, doc: document, api: globalThis.chrome });
