// Background side of "Zapisz paczkę" (design D7, E1-T8b). The background collects the
// current document through the ISOLATED bridge, assembles the package and hands the JSON
// string to the popup, which owns the Blob and calls downloads.download (the service worker
// has no URL.createObjectURL). The background then tracks the download and is the only
// source of truth about success. All state lives in `pds:rec.save` (storage.session), so
// a fresh instance after an SW / event page restart continues where the old one stopped.

import { assemblePackage, packageFileName } from './package.js';
import { isSameOrigin } from './origin.js';

// D7 / AC-2.4: click → download id, and download start → complete.
export const COLLECT_TIMEOUT_MS = 15_000;
export const DOWNLOAD_TIMEOUT_MS = 60_000;

// Protocol of the MAIN `collect` result (design T15: `{ protocol, recorderVersion, docId, … }`).
// Mirrors PROTOCOL from src/page/constants.js (T3c); src/lib does not import page modules.
export const RESULT_PROTOCOL = 1;
// Same bound as CHANNEL_MAX_MESSAGE: one serialized result never exceeds this many characters.
const MAX_RESULT_CHARS = 32 * 1024 * 1024;
const MAX_FILE_NAME = 255;

const BADGE_NONE = '';

const TIMEOUT = Symbol('timeout');

function basename(path) {
  if (typeof path !== 'string' || path === '') return null;
  const name = path.split(/[\\/]/).pop();
  return name ? name.slice(0, MAX_FILE_NAME) : null;
}

/** Parses and validates the string the recorder returns; null when it is not a valid result. */
function parseResult(raw, expectedVersion) {
  if (typeof raw !== 'string' || raw.length > MAX_RESULT_CHARS) return null;
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  if (result.protocol !== RESULT_PROTOCOL || result.recorderVersion !== expectedVersion) return null;
  const { docId } = result;
  if (!((typeof docId === 'number' && Number.isFinite(docId)) || (typeof docId === 'string' && docId !== ''))) return null;
  return result;
}

const isRecordingTab = (rec, tabId) => Boolean(rec) && rec.tabId === tabId && (rec.status === 'recording' || rec.status === 'stopped');

const isOurDownload = (rec, downloadId) =>
  Boolean(rec?.save) && rec.save.phase === 'downloading' && rec.save.downloadId === downloadId;

/**
 * @param {object} api  `store` (session-store.js) and the chrome.* namespaces `tabs`, `downloads`,
 *   `runtime`, `scripting`, `action`; optional `now`, `setTimeout`, `clearTimeout`, and
 *   `unregisterAll(scripting)` / `setBadge(action, tabId, kind)` from content-scripts.js (T1b).
 */
export function createSaveHandlers(api) {
  const { store, tabs, downloads, runtime, scripting, action } = api;
  const now = () => (api.now ?? Date.now)();
  const schedule = (fn, ms) => (api.setTimeout ?? globalThis.setTimeout)(fn, ms);
  const unschedule = (id) => (api.clearTimeout ?? globalThis.clearTimeout)(id);

  const unregisterAll =
    api.unregisterAll ??
    (async (s) => {
      try {
        await s.unregisterContentScripts();
      } catch {
        // Nothing registered: already clean.
      }
    });
  const clearBadge = (tabId) =>
    api.setBadge ? api.setBadge(action, tabId, 'none') : action.setBadgeText({ tabId, text: BADGE_NONE });

  // Ends the save attempt without success; the recording itself goes on (AC-2.2).
  // `lastError` undefined = answered to the popup directly, nothing to report later.
  async function failSave(match, lastError) {
    let changed = false;
    await store.updateRec((rec) => {
      if (!rec?.save || !match(rec)) return undefined;
      changed = true;
      return lastError === undefined ? { ...rec, save: null } : { ...rec, save: null, lastError };
    });
    return changed;
  }

  async function sendCollect(tabId) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = schedule(() => resolve(TIMEOUT), COLLECT_TIMEOUT_MS);
    });
    try {
      return await Promise.race([tabs.sendMessage(tabId, { type: 'collect' }, { frameId: 0 }), timeout]);
    } finally {
      unschedule(timer);
    }
  }

  // Cleanup after a confirmed download (D7, AC-2.5). Idempotent: every step tolerates "already done".
  async function finalize(rec, fileName) {
    const { tabId, requestId } = rec;
    await unregisterAll(scripting);
    // Best-effort: the tab may be gone or on another page.
    tabs.sendMessage(tabId, { type: 'destroy' }, { frameId: 0 }).catch(() => {});
    await store.clearDocs();
    // downloadId lets the popup match the verdict to its own save (T12).
    await store.setLast(tabId, { fileName, downloadId: rec.save?.downloadId ?? null, at: now() });
    await store.updateRec((current) => (current?.requestId === requestId ? null : undefined));
    try {
      await clearBadge(tabId);
    } catch {
      // Tab closed meanwhile.
    }
    return { saved: true, fileName };
  }

  async function complete(downloadId) {
    let claimed = null;
    await store.updateRec((rec) => {
      if (!isOurDownload(rec, downloadId)) return undefined;
      claimed = rec;
      return { ...rec, save: { ...rec.save, phase: 'finishing' } };
    });
    if (!claimed) return null;
    let item = null;
    try {
      [item] = await downloads.search({ id: downloadId });
    } catch {
      // Name falls back to the one we proposed.
    }
    return finalize(claimed, basename(item?.filename) ?? claimed.save.fileName);
  }

  // The reporter cancelled → saveCancelled; the browser failed (disk, network, blocked) → downloadFailed.
  async function interrupted(downloadId, error) {
    const lastError = error === 'USER_CANCELED' ? 'saveCancelled' : 'downloadFailed';
    const changed = await failSave((rec) => isOurDownload(rec, downloadId), lastError);
    return changed ? { downloadFailed: true } : null;
  }

  async function expireSave(at = now()) {
    const rec = await store.getRec();
    const save = rec?.save;
    if (!save) return null;
    if (save.phase === 'collecting' && at - save.startedAt > COLLECT_TIMEOUT_MS) {
      const changed = await failSave((r) => r.save.phase === 'collecting' && r.save.startedAt === save.startedAt, 'pageBusy');
      return changed ? { downloadFailed: true } : null;
    }
    if (save.phase === 'downloading' && at - save.startedAt > DOWNLOAD_TIMEOUT_MS) {
      let item = null;
      try {
        [item] = await downloads.search({ id: save.downloadId });
      } catch {
        // Unknown download: treat as not complete.
      }
      if (item?.state === 'complete') return complete(save.downloadId);
      // State first, so the `interrupted` event caused by cancel is no longer ours.
      const changed = await failSave((r) => isOurDownload(r, save.downloadId), 'failed');
      downloads.cancel(save.downloadId).catch(() => {});
      return changed ? { downloadFailed: true } : null;
    }
    if (save.phase === 'finishing' && at - save.startedAt > DOWNLOAD_TIMEOUT_MS) {
      // Restart in the middle of cleanup: the download was complete, finish the cleanup.
      return finalize(rec, save.fileName);
    }
    return null;
  }

  return {
    /** Popup command: collect the current document and assemble the package. */
    async collect({ tabId } = {}) {
      const startedAt = now();
      let rec = null;
      await store.updateRec((current) => {
        if (!isRecordingTab(current, tabId)) return undefined;
        rec = { ...current, save: { phase: 'collecting', startedAt, downloadId: null, fileName: null } };
        return rec;
      });
      if (!rec) return { ok: false, reason: 'failed' };
      const sameAttempt = (r) => r.save?.startedAt === startedAt;

      let tab = null;
      try {
        tab = await tabs.get(tabId);
      } catch {
        // Tab closed after the recording: package from the flushed documents only.
      }

      const version = runtime.getManifest().version;
      let current = null;
      let currentMissingReason;
      if (tab && isSameOrigin(tab.url, rec.origin)) {
        let raw;
        let noReceiver = false;
        try {
          raw = await sendCollect(tabId);
        } catch {
          noReceiver = true;
        }
        if (noReceiver) {
          // After the time limit the scripts are unregistered, so a page loaded later has no
          // bridge (D10): save the stored documents. While recording it is an error.
          if (rec.status !== 'stopped') {
            await failSave(sameAttempt);
            return { ok: false, reason: 'failed' };
          }
          currentMissingReason = 'loadedAfterStop';
        } else if (raw === TIMEOUT) {
          await failSave(sameAttempt);
          return { ok: false, reason: 'pageBusy' };
        } else {
          current = parseResult(raw, version);
          if (!current) {
            await failSave(sameAttempt);
            return { ok: false, reason: 'failed' };
          }
        }
      }

      const priorDocs = (await store.listDocs()).map(({ id, data }) => ({ ...data, docId: data?.docId ?? id }));
      const collectedAt = now();
      const deadline = typeof rec.deadline === 'number' ? rec.deadline : undefined;
      const stopReason = rec.stopReason ?? (deadline !== undefined && collectedAt >= deadline ? 'time-limit' : null);
      const pkg = assemblePackage({
        meta: { extensionVersion: version, source: 'extension', startedAt: rec.startedAt, collectedAt, stopReason, deadline, currentMissingReason },
        current,
        priorDocs,
        docs: Array.isArray(rec.docs) ? rec.docs : [],
      });
      const json = JSON.stringify(pkg, null, 2);
      const fileName = packageFileName(collectedAt);

      let stillOurs = false;
      await store.updateRec((r) => {
        if (!r || !sameAttempt(r)) return undefined;
        stillOurs = true;
        return { ...r, save: { ...r.save, fileName } };
      });
      if (!stillOurs) return { ok: false, reason: 'failed' };
      // Popup closed before starting the download → the attempt expires (live instance only;
      // after a restart expireSave runs from getStatus).
      schedule(() => expireSave().catch(() => {}), COLLECT_TIMEOUT_MS + 1);
      return { ok: true, json, fileName };
    },

    /** Popup command: downloads.download resolved with `downloadId`. The popup's file name is ignored. */
    async saveStarted({ downloadId } = {}) {
      if (!Number.isInteger(downloadId)) return { ok: false };
      let started = null;
      await store.updateRec((rec) => {
        if (rec?.save?.phase !== 'collecting' || !rec.save.fileName) return undefined;
        started = { ...rec, save: { ...rec.save, phase: 'downloading', downloadId, startedAt: now() } };
        return started;
      });
      if (!started) return { ok: false };
      schedule(() => expireSave().catch(() => {}), DOWNLOAD_TIMEOUT_MS + 1);
      // onChanged may have fired before the state was stored.
      let item = null;
      try {
        [item] = await downloads.search({ id: downloadId });
      } catch {
        // onChanged will tell.
      }
      if (item?.state === 'complete') await complete(downloadId);
      else if (item?.state === 'interrupted') await interrupted(downloadId, item.error);
      return { ok: true };
    },

    /** Popup command: downloads.download rejected (e.g. blocked). `{ tabId, reason }`; reason is informational. */
    async saveFailed() {
      await failSave(() => true, 'downloadFailed');
      return { ok: true };
    },

    /** downloads.onChanged listener (registered top-level in background.js). */
    async onDownloadChanged(delta) {
      const state = delta?.state?.current;
      if (state === 'complete') return complete(delta.id);
      if (state === 'interrupted') return interrupted(delta.id, delta.error?.current);
      return null;
    },

    expireSave,
  };
}
