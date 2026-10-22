// Popup controller (design D7, D9, E1-T6b). The popup is a view of the background state:
// it asks `getStatus`, re-asks on every storage.session change and sends user actions.
// Browser APIs, clock and render come in via `api`, so the logic runs without a browser.
//
// Protocol popup -> background (runtime.sendMessage):
//   getStatus   { tabId, url, ownRequestId? }        -> Status (below); ownRequestId only while
//                                                       this popup waits on its consent prompt
//   armStart    { requestId, tabId, origin, pattern } (not awaited, same tick as the click)
//   start       { requestId, tabId }                 -> { ok: true, startedAt } | { ok: false, reason }
//   disarm      { requestId, tabId }
//   collect     { tabId }                            -> { ok: true, json, fileName } | { ok: false, reason }
//   saveStarted { tabId, downloadId, fileName }      (background ignores fileName, uses downloads.search)
//   saveFailed  { tabId, reason: 'downloadFailed' }
// Status: { state: 'idle'|'starting'|'recording'|'stopped'|'saving', startedAt, stopReason,
//           isRecordingTab, otherTabRecording, otherOrigin, lastSaved: { fileName, downloadId, at } | null,
//           lastError: outcome kind | null (one-shot) }
// 'starting' = armed request for this tab, not started yet; 'stopped' = time limit reached (D10).
import { classifyUrl, isFileAccessAllowed, isFirefoxRuntime } from './target.js';
import { originPatternFor } from '../lib/origin.js';
import { renderModel } from './view.js';

export const RESPONSE_TIMEOUT_MS = 15_000;
export const DOWNLOAD_TIMEOUT_MS = 60_000;

const START_FAILURES = new Set(['permissionDenied', 'recordFailed', 'restricted', 'fileAccess', 'failed']);
const COLLECT_FAILURES = new Set(['pageBusy', 'failed']);
const STATUS_ERRORS = new Set(['saveCancelled', 'downloadFailed', 'pageBusy', 'permissionDenied', 'recordFailed', 'restricted', 'failed']);
// Save verdicts stay until the next user action or a new lastError (AC-2.4): after its own
// collect timeout the background goes saving -> recording without lastError, which says nothing new.
const STICKY_OUTCOMES = new Set(['pageBusy', 'failed', 'downloadFailed', 'saveCancelled']);

class TimeoutError extends Error {}

/**
 * @param {{ runtime, permissions, downloads, storage, tabs, extension?, URL, Blob,
 *           setTimeout?, clearTimeout?, randomUUID?, render: (model) => void,
 *           logError?: (...details) => void }} api
 */
export function createController(api) {
  const setTimer = api.setTimeout ?? globalThis.setTimeout;
  const clearTimer = api.clearTimeout ?? globalThis.clearTimeout;
  const randomUUID = api.randomUUID ?? (() => globalThis.crypto.randomUUID());
  const logError = api.logError ?? (() => {});

  const ctx = { target: null, tab: null, origin: null, pattern: null, busy: null, outcome: null };
  let status = null;
  let requestId = null; // one per popup: a repeated click re-arms the same request (D9)
  let refreshSeq = 0;
  // lastError is one-shot and clearing it is a storage change, which starts a newer refresh:
  // an error from an overtaken answer is kept here for the next applied status.
  let missedError = null;
  let save = null; // { downloadId, url, timer } while waiting for the background's verdict
  let destroyed = false;

  const render = () => {
    if (!destroyed) api.render(renderModel(status, { target: ctx.target, busy: ctx.busy, outcome: ctx.outcome }));
  };

  // runtime.sendMessage raced against the 15 s limit (AC-2.4).
  function call(message, timeoutMs = RESPONSE_TIMEOUT_MS) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimer(() => reject(new TimeoutError(`no answer to ${message.type}`)), timeoutMs);
    });
    return Promise.race([api.runtime.sendMessage(message), timeout]).finally(() => clearTimer(timer));
  }

  // Fire-and-forget message; failures only reach the developer console.
  function notify(message) {
    try {
      Promise.resolve(api.runtime.sendMessage(message)).catch((error) => logError(message.type, error));
    } catch (error) {
      logError(message.type, error);
    }
  }

  async function classify() {
    let tab;
    try {
      [tab] = await api.tabs.query({ active: true, currentWindow: true });
    } catch (error) {
      logError('tabs.query', error);
    }
    if (typeof tab?.id !== 'number') return 'noTab';
    ctx.tab = tab;
    const kind = classifyUrl(tab.url);
    if (kind === 'restricted') return 'restricted';
    const isFirefox = isFirefoxRuntime(api);
    if (kind === 'web' || kind === 'file') {
      // Only an explicit "no" from Chrome's probe blocks a file page (E0 behaviour).
      if (kind === 'file' && !isFirefox && (await isFileAccessAllowed(api)) === false) return 'fileAccess';
      const op = originPatternFor(tab.url);
      if (!op) return 'restricted';
      ctx.origin = op.origin;
      ctx.pattern = op.pattern;
      return 'web';
    }
    // URL hidden: Chrome does this for file:// without file-URL access (QA E0 F2).
    if (!isFirefox && (await isFileAccessAllowed(api)) === false) return 'fileAccess';
    return 'restricted';
  }

  async function refresh() {
    if (destroyed || ctx.target !== 'web') return;
    const seq = ++refreshSeq;
    let next;
    try {
      const message = { type: 'getStatus', tabId: ctx.tab.id, url: ctx.tab.url };
      // The background must not judge our own pending request while the consent prompt is open.
      if (ctx.busy === 'starting' && requestId) message.ownRequestId = requestId;
      next = await call(message);
    } catch (error) {
      logError('getStatus', error);
      if (seq === refreshSeq && !status) ctx.outcome = { kind: 'failed' };
      render();
      return;
    }
    if (seq !== refreshSeq || destroyed) {
      if (STATUS_ERRORS.has(next?.lastError)) missedError = next.lastError;
      return;
    }
    if (!next || typeof next !== 'object') {
      logError('getStatus: unexpected answer', next);
      if (!status) ctx.outcome = { kind: 'failed' };
      render();
      return;
    }
    applyStatus(next);
  }

  function applyStatus(next) {
    // A new background state makes an older local message stale.
    if (status && status.state !== next.state && !ctx.busy && !STICKY_OUTCOMES.has(ctx.outcome?.kind)) ctx.outcome = null;
    status = next;
    const lastError = STATUS_ERRORS.has(next.lastError) ? next.lastError : missedError;
    missedError = null;
    if (save && next.lastSaved && next.lastSaved.downloadId === save.downloadId) {
      finishSave({ kind: 'saved', fileName: next.lastSaved.fileName });
    } else if (lastError) {
      if (save) finishSave({ kind: lastError });
      else ctx.outcome = { kind: lastError };
    }
    render();
  }

  function finishSave(outcome) {
    if (!save) return;
    clearTimer(save.timer);
    if (save.url) api.URL.revokeObjectURL(save.url);
    save = null;
    ctx.busy = null;
    ctx.outcome = outcome;
  }

  const onStorageChanged = () => {
    refresh();
  };

  async function init() {
    ctx.target = await classify();
    if (ctx.target !== 'web') {
      render();
      return;
    }
    render();
    api.storage?.session?.onChanged?.addListener(onStorageChanged);
    await refresh();
  }

  // Must stay synchronous up to permissions.request: the browser keeps the user gesture only
  // in the click's own tick (D9). Returns a promise for the rest of the flow.
  function onRecord() {
    if (ctx.target !== 'web' || !ctx.pattern || ctx.busy) return Promise.resolve();
    requestId ??= randomUUID();
    const tabId = ctx.tab.id;
    notify({ type: 'armStart', requestId, tabId, origin: ctx.origin, pattern: ctx.pattern });
    let request;
    try {
      request = api.permissions.request({ origins: [ctx.pattern] });
    } catch (error) {
      request = Promise.reject(error);
    }
    ctx.busy = 'starting';
    ctx.outcome = null;
    render();
    return finishRecord(request, tabId);
  }

  async function finishRecord(request, tabId) {
    let granted;
    try {
      granted = (await request) === true;
    } catch (error) {
      logError('permissions.request', error);
      notify({ type: 'disarm', requestId, tabId });
      return endStart({ kind: 'recordFailed' });
    }
    if (!granted) {
      notify({ type: 'disarm', requestId, tabId });
      return endStart({ kind: 'permissionDenied' });
    }
    let res;
    try {
      res = await call({ type: 'start', requestId, tabId });
    } catch (error) {
      logError('start', error);
      return endStart({ kind: 'failed' });
    }
    if (res?.ok !== true) {
      if (!START_FAILURES.has(res?.reason)) logError('start: unexpected answer', res);
      return endStart({ kind: START_FAILURES.has(res?.reason) ? res.reason : 'recordFailed' });
    }
    ctx.busy = null;
    await refresh();
  }

  async function endStart(outcome) {
    ctx.busy = null;
    ctx.outcome = outcome;
    render();
    await refresh();
  }

  async function onSave() {
    if (ctx.target !== 'web' || ctx.busy) return;
    const tabId = ctx.tab.id;
    ctx.busy = 'saving';
    ctx.outcome = null;
    render();

    // 15 s from the click to a download id (D7): collecting -> pageBusy, otherwise failed.
    let phase = 'collecting';
    let timedOut = false;
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimer(() => {
        timedOut = true;
        resolve({ timeout: true });
      }, RESPONSE_TIMEOUT_MS);
    });
    const work = (async () => {
      const res = await api.runtime.sendMessage({ type: 'collect', tabId });
      if (res?.ok !== true || typeof res.json !== 'string' || typeof res.fileName !== 'string' || !res.fileName) {
        if (!COLLECT_FAILURES.has(res?.reason)) logError('collect: unexpected answer', res);
        return { failure: COLLECT_FAILURES.has(res?.reason) ? res.reason : 'failed' };
      }
      if (timedOut) return { failure: 'pageBusy' };
      phase = 'downloading';
      const url = api.URL.createObjectURL(new api.Blob([res.json], { type: 'application/json' }));
      let downloadId;
      try {
        downloadId = await api.downloads.download({
          url,
          filename: res.fileName,
          saveAs: false,
          conflictAction: 'uniquify',
        });
      } catch (error) {
        api.URL.revokeObjectURL(url);
        throw error;
      }
      if (timedOut) {
        // Too late: the popup already said "failed", so the file must not appear either.
        api.URL.revokeObjectURL(url);
        api.downloads.cancel?.(downloadId)?.catch?.((error) => logError('downloads.cancel', error));
        return { failure: 'failed' };
      }
      return { downloadId, url, fileName: res.fileName };
    })().catch((error) => {
      logError(phase, error);
      return phase === 'downloading' ? { failure: 'downloadFailed', reportSaveFailed: true } : { failure: 'failed' };
    });

    const result = await Promise.race([work, deadline]);
    clearTimer(timer);
    if (destroyed) return;
    if (result.timeout) {
      return endSave({ kind: phase === 'collecting' ? 'pageBusy' : 'failed' });
    }
    if (result.failure) {
      if (result.reportSaveFailed) notify({ type: 'saveFailed', tabId, reason: 'downloadFailed' });
      return endSave({ kind: result.failure });
    }

    save = { downloadId: result.downloadId, url: result.url, timer: null };
    save.timer = setTimer(onDownloadTimeout, DOWNLOAD_TIMEOUT_MS);
    notify({ type: 'saveStarted', tabId, downloadId: result.downloadId, fileName: result.fileName });
    // Success only from the background (downloads.onChanged there), never from download().
    await refresh();
  }

  async function onDownloadTimeout() {
    if (!save) return;
    await refresh();
    if (save) {
      finishSave({ kind: 'failed' });
      render();
    }
  }

  async function endSave(outcome) {
    ctx.busy = null;
    ctx.outcome = outcome;
    render();
    await refresh();
  }

  function destroy() {
    destroyed = true;
    api.storage?.session?.onChanged?.removeListener(onStorageChanged);
    if (save) {
      clearTimer(save.timer);
      if (save.url) api.URL.revokeObjectURL(save.url);
      save = null;
    }
  }

  return { init, onRecord, onSave, refresh, destroy };
}
