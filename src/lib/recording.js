// Background handlers for the recording lifecycle (design D1, D2, D4, D9): consent
// handshake, start, the per-document gate (`hello`), document flushes, status for the
// popup and cleanup. All state lives in storage.session through the store; a fresh
// instance after an SW / event page restart continues from the same data.

import { originPatternFor, isSameOrigin } from './origin.js';
import { createStore, TEST_LIMIT_RANGE } from './session-store.js';
import { registerFor, unregisterAll, setBadge } from './content-scripts.js';
import { mapInjectionError, isFirefoxRuntime } from '../popup/target.js';

// D10: recording stops by itself after this long.
export const RECORDING_LIMIT_MS = 600_000;
export const STOP_TIME_LIMIT = 'time-limit';
// An armed request older than this no longer starts on permissions.onAdded (D9).
export const PENDING_TTL_MS = 120_000;

// Bounds for what a recording keeps about its documents.
const MAX_DOCS = 100;
const MAX_URL_LENGTH = 2048;
const MAX_REASON_LENGTH = 64;
const REC_VERSION = 1;
const TOKEN_BYTES = 16;

const ok = (startedAt) => ({ ok: true, startedAt });
const fail = (reason) => ({ ok: false, reason });
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const capUrl = (url) => (typeof url === 'string' ? url.slice(0, MAX_URL_LENGTH) : null);

// Per-document secret handed to the bridge in the `hello` answer and required on `flush` (F-2).
function newDocToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Limit for a new recording (D10): the test-only override from `pds:test:recordingLimitMs`
 * (set by the e2e harness through the SW, never by pages or content scripts), clamped to
 * [1 s, 10 min]; anything that is not a finite number gives the 10 min default.
 */
export function resolveLimitMs(testLimit) {
  if (typeof testLimit !== 'number' || !Number.isFinite(testLimit)) return RECORDING_LIMIT_MS;
  return Math.min(TEST_LIMIT_RANGE.max, Math.max(TEST_LIMIT_RANGE.min, Math.floor(testLimit)));
}

/**
 * @param {{ chrome: typeof chrome, store?: ReturnType<typeof createStore>, now?: () => number,
 *           expireSave?: () => Promise<unknown> }} api
 *   Pass one shared `store` for all handler sets of a background instance so writes share a queue.
 *   `expireSave` (save.js) runs before every getStatus, so a save abandoned across an SW restart ends.
 */
export function createRecordingHandlers({
  chrome,
  store = createStore(chrome.storage.session),
  now = () => Date.now(),
  expireSave = null,
}) {
  // Bridge messages come only from the top frame of a tab, sent by our own content script (D2).
  const isBridge = (sender) =>
    typeof sender?.tab?.id === 'number' && sender.frameId === 0 && sender.id === chrome.runtime.id;
  // Firefox may omit sender.origin; sender.url is the URL of the sending document.
  const senderUrl = (sender) => sender.url ?? sender.origin ?? sender.tab?.url;

  // Same tab and exact origin (with port) as the recording.
  const matchesRecording = (rec, sender) =>
    !!rec && rec.tabId === sender.tab.id && isSameOrigin(senderUrl(sender), rec.origin);

  async function clearPendingIf(requestId) {
    const pending = await store.getPending();
    if (pending?.requestId === requestId) await store.clearPending();
  }

  // Ends a recording without saving: scripts, documents, badge, page buffers (best effort).
  async function endWithoutSaving(previous, { keepTab } = {}) {
    await unregisterAll(chrome.scripting);
    await store.clearDocs();
    if (previous.tabId === keepTab) return;
    await setBadge(chrome.action, previous.tabId, 'none');
    try {
      await chrome.tabs.sendMessage(previous.tabId, { type: 'destroy' }, { frameId: 0 });
    } catch {
      // No receiver: the page is gone or never had the bridge.
    }
  }

  async function dropRec(requestId) {
    await store.updateRec((cur) => (cur?.requestId === requestId ? null : undefined));
  }

  const isDue = (rec) => rec?.status === 'recording' && typeof rec.deadline === 'number' && now() >= rec.deadline;
  const asStopped = (rec) => ({ ...rec, status: 'stopped', stopReason: STOP_TIME_LIMIT });

  // D10: after the stop no new document is recorded (scripts gone); buffers and docs stay for the save.
  // E2 D8: the live document is told to stop its hooks too (bridge relays `stop` to MAIN). Not awaited:
  // a page without a receiver or one that never answers must not hold up the status.
  async function afterStop(rec) {
    await unregisterAll(chrome.scripting);
    await setBadge(chrome.action, rec.tabId, 'stopped');
    try {
      Promise.resolve(
        chrome.tabs.sendMessage(rec.tabId, { type: 'stop', reason: STOP_TIME_LIMIT }, { frameId: 0 }),
      ).catch(() => {});
    } catch {
      // No receiver: the page is gone or never had the bridge.
    }
  }

  // E2 D8 (IN1): the tab's current URL is the truth, the popup's copy is stale after a navigation.
  // No `url` means no host permission for the new site, so it is another origin.
  async function isOtherOrigin(rec, url) {
    let tab;
    try {
      tab = await chrome.tabs.get(rec.tabId);
    } catch {
      return typeof url === 'string' && url !== '' && !isSameOrigin(url, rec.origin);
    }
    return !isSameOrigin(tab?.url, rec.origin);
  }

  // Lazy end of a recording past its deadline (no timers in the background). Runs once per recording.
  async function expireIfDue() {
    let stopped = null;
    await store.updateRec((cur) => {
      if (!isDue(cur)) return undefined;
      stopped = asStopped(cur);
      return stopped;
    });
    if (stopped) await afterStop(stopped);
  }

  const handlers = {
    /** Popup, same tick as permissions.request: remembers the request (D9). */
    async armStart({ requestId, tabId, origin, pattern }) {
      if (typeof requestId !== 'string' || typeof tabId !== 'number') return fail('recordFailed');
      await store.setPending({ requestId, tabId, origin, pattern, at: now() });
      return { ok: true };
    },

    async disarm({ requestId }) {
      await clearPendingIf(requestId);
      return { ok: true };
    },

    /**
     * Idempotent per requestId (AC-1.3). Uses the armed request; the message may carry
     * `{ tabId, origin, pattern }` as a fallback when the pending entry is already gone.
     * @returns {Promise<{ ok: true, startedAt: number } | { ok: false, reason: string }>}
     */
    async start(msg) {
      const requestId = msg?.requestId;
      if (typeof requestId !== 'string') return fail('recordFailed');
      const existing = await store.getRec();
      if (existing?.requestId === requestId) return ok(existing.startedAt);

      const pending = await store.getPending();
      const req = pending?.requestId === requestId ? pending : msg;
      const { tabId, origin, pattern } = req;
      if (typeof tabId !== 'number' || typeof origin !== 'string' || typeof pattern !== 'string') {
        return fail('recordFailed');
      }

      // The tab must still show the origin the popup asked for.
      let url;
      try {
        url = (await chrome.tabs.get(tabId)).url;
      } catch {
        return fail('recordFailed');
      }
      const target = originPatternFor(url);
      if (!target || target.origin !== origin || target.pattern !== pattern) return fail('recordFailed');

      if (!(await chrome.permissions.contains({ origins: [pattern] }))) {
        await clearPendingIf(requestId);
        return fail('permissionDenied');
      }

      const limitMs = resolveLimitMs(await store.getTestLimit());
      const startedAt = now();
      const next = {
        v: REC_VERSION,
        requestId,
        tabId,
        origin,
        pattern,
        startedAt,
        limitMs,
        deadline: startedAt + limitMs,
        status: 'recording',
        stopReason: null,
        docSeq: 0,
        docs: [],
        save: null,
        lastError: null,
      };
      // Claim atomically: a concurrent start with the same requestId sees our state.
      let claimed = false;
      let previous = null;
      const current = await store.updateRec((cur) => {
        if (cur?.requestId === requestId) return undefined;
        previous = cur;
        claimed = true;
        return next;
      });
      if (!claimed) return ok(current.startedAt);

      if (previous) await endWithoutSaving(previous, { keepTab: tabId });
      else await store.clearDocs();

      try {
        await registerFor(chrome.scripting, pattern);
      } catch (err) {
        await dropRec(requestId);
        await clearPendingIf(requestId);
        const reason = mapInjectionError(err, url, { isFirefox: isFirefoxRuntime(chrome) });
        return fail(reason === 'failed' ? 'recordFailed' : reason);
      }

      await setBadge(chrome.action, tabId, 'recording');
      await clearPendingIf(requestId);
      try {
        await chrome.tabs.reload(tabId);
      } catch {
        await unregisterAll(chrome.scripting);
        await dropRec(requestId);
        await setBadge(chrome.action, tabId, 'none');
        return fail('recordFailed');
      }
      return ok(startedAt);
    },

    /** Firefox may close the popup at the consent prompt: start from the armed request. */
    async onPermissionAdded(permissions) {
      const pending = await store.getPending();
      if (!pending || now() - pending.at > PENDING_TTL_MS) return null;
      if (!(permissions?.origins ?? []).includes(pending.pattern)) return null;
      return handlers.start({ requestId: pending.requestId });
    },

    /**
     * Per-document gate (D1). Answer for the bridge, forwarded to MAIN as `config`:
     * `{ record: true, docId, token, deadline, limitMs }`, or `{ record: false, … }` when the recording
     * is over (the document keeps its channel for collect), or `{ record: false }` otherwise.
     * `token` stays in the bridge (not sent to MAIN) and authenticates the document's `flush`.
     */
    async hello(_msg, sender) {
      if (!isBridge(sender)) return { record: false };
      let reply = { record: false };
      let stopped = null;
      await store.updateRec((cur) => {
        if (!matchesRecording(cur, sender)) return undefined;
        const docId = cur.docSeq + 1;
        const due = isDue(cur);
        const record = cur.status === 'recording' && !due;
        const token = newDocToken();
        const doc = { id: docId, url: capUrl(senderUrl(sender)), flushed: false, token };
        if (!record) doc.recorded = false;
        reply = { record, docId, token, deadline: cur.deadline, limitMs: cur.limitMs };
        const next = { ...cur, docSeq: docId, docs: [...cur.docs, doc].slice(-MAX_DOCS) };
        if (due) stopped = asStopped(next);
        return stopped ?? next;
      });
      if (stopped) await afterStop(stopped);
      else if (reply.record) await setBadge(chrome.action, sender.tab.id, 'recording');
      return reply;
    },

    /**
     * MAIN stopped itself at the deadline (D10): `{ type: 'stopped', reason }` relayed by the
     * bridge. Same effect as the lazy expiry; a repeated message changes nothing.
     */
    async stopped(msg, sender) {
      if (!isBridge(sender) || msg?.reason !== STOP_TIME_LIMIT) return fail('rejected');
      let stopped = null;
      await store.updateRec((cur) => {
        if (!matchesRecording(cur, sender) || cur.status !== 'recording') return undefined;
        stopped = asStopped(cur);
        return stopped;
      });
      if (stopped) await afterStop(stopped);
      return { ok: true };
    },

    /**
     * Copy of a document's buffers (D4): periodically while it changes and at pagehide; a later copy
     * overwrites. Authenticated by the document's token, not by frame and origin: a document left for
     * another site sends its pagehide flush from a frame pending deletion (Chrome: frameId ≠ 0, tab URL
     * already the new site), F-2.
     */
    async flush(msg, sender) {
      if (typeof sender?.tab?.id !== 'number' || sender.id !== chrome.runtime.id) return fail('rejected');
      if (!isPlainObject(msg?.data) || typeof msg.token !== 'string' || msg.token === '') return fail('rejected');
      const docId = msg.docId;
      const rec = await store.getRec();
      const known = rec?.tabId === sender.tab.id ? rec.docs.find((d) => d.id === docId) : null;
      if (!known || known.token !== msg.token) return fail('rejected');
      const { stored } = await store.putDoc(docId, msg.data);
      await store.updateRec((cur) =>
        cur?.requestId === rec.requestId
          ? { ...cur, docs: cur.docs.map((d) => (d.id === docId ? { ...d, flushed: true } : d)) }
          : undefined,
      );
      return { ok: true, stored };
    },

    /** The bridge could not bind to MAIN (D3): the document is marked as not recorded. */
    async bridgeError(msg, sender) {
      if (!isBridge(sender)) return fail('rejected');
      const bridgeError = String(msg?.reason ?? 'unknown').slice(0, MAX_REASON_LENGTH);
      await store.updateRec((cur) => {
        if (!matchesRecording(cur, sender)) return undefined;
        if (cur.docs.some((d) => d.id === msg?.docId)) {
          return { ...cur, docs: cur.docs.map((d) => (d.id === msg.docId ? { ...d, bridgeError } : d)) };
        }
        const doc = { id: cur.docSeq + 1, url: capUrl(senderUrl(sender)), flushed: false, recorded: false, bridgeError };
        return { ...cur, docSeq: doc.id, docs: [...cur.docs, doc].slice(-MAX_DOCS) };
      });
      return { ok: true };
    },

    /**
     * Popup view model source (D9). `ownRequestId`: the request this popup is still waiting
     * on — its pending entry is not judged as a refused consent.
     */
    async getStatus({ tabId, url, ownRequestId } = {}) {
      if (expireSave) {
        try {
          await expireSave();
        } catch {
          // A failed expiry check must not hide the status.
        }
      }
      await expireIfDue();

      let lastError = null;
      let pending = await store.getPending();
      const rec = await store.getRec();
      if (pending && pending.requestId !== ownRequestId && rec?.requestId !== pending.requestId) {
        if (!(await chrome.permissions.contains({ origins: [pending.pattern] }))) {
          await clearPendingIf(pending.requestId);
          if (pending.tabId === tabId) lastError = 'permissionDenied';
          pending = null;
        } else if (now() - pending.at > PENDING_TTL_MS) {
          await clearPendingIf(pending.requestId);
          pending = null;
        }
      }

      const isRecordingTab = !!rec && rec.tabId === tabId;
      if (isRecordingTab && rec.lastError) {
        // One-shot: shown once, then cleared.
        if (!lastError) lastError = rec.lastError;
        await store.updateRec((cur) => (cur?.requestId === rec.requestId ? { ...cur, lastError: null } : undefined));
      }
      // Between armStart and start (consent prompt open, or Firefox starting from onAdded).
      const starting = !isRecordingTab && pending?.tabId === tabId && rec?.requestId !== pending.requestId;
      return {
        state: isRecordingTab ? (rec.save ? 'saving' : rec.status) : starting ? 'starting' : 'idle',
        startedAt: isRecordingTab ? rec.startedAt : null,
        stopReason: isRecordingTab ? rec.stopReason : null,
        isRecordingTab,
        otherTabRecording: !!rec && rec.tabId !== tabId,
        otherOrigin: isRecordingTab && (await isOtherOrigin(rec, url)),
        lastSaved: typeof tabId === 'number' ? await store.getLast(tabId) : null,
        lastError,
      };
    },

    /** AC-2.6: closing the recorded tab ends the recording without a trace. */
    async onTabRemoved(tabId) {
      const rec = await store.getRec();
      const pending = await store.getPending();
      if (pending?.tabId === tabId) await clearPendingIf(pending.requestId);
      await store.clearLast(tabId);
      if (rec?.tabId !== tabId) return;
      await unregisterAll(chrome.scripting);
      await dropRec(rec.requestId);
      await store.clearDocs();
    },

    onStartup: () => resetAll(),
    onInstalled: () => resetAll(),
  };
  return handlers;

  async function resetAll() {
    await unregisterAll(chrome.scripting);
    await store.clearRec();
    await store.clearDocs();
    await store.clearPending();
  }
}
