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
//   collect     { tabId, includeScreenshot, screenshotOffReason?, crossOriginFrames? }
//                                                    -> { ok: true, zipBase64, fileName, packageBytes, screenshot? } | { ok: false, reason }
//                                                       (E3 D7: the zip travels as base64; includeScreenshot from the checkbox;
//                                                       screenshot 'included'|'off'|'failed' for the "Zapisano" text, QA F-5;
//                                                       E4 D8: with an unticked box, why — 'reporter'|'frames'|'frameCheckFailed',
//                                                       crossOriginFrames 1..999 only with 'frames')
//   frameCheck  { tabId }                            -> { ok: true, crossOriginFrames } | { ok: false }
//                                                       (store S1: asked when this tab records; > 0 turns the screenshot
//                                                       default off; no answer keeps it on)
//   saveStarted { tabId, downloadId, fileName }      (background ignores fileName, uses downloads.search)
//   saveFailed  { tabId, reason: 'downloadFailed' }
// Status: { state: 'idle'|'starting'|'recording'|'stopped'|'saving', startedAt, stopReason,
//           isRecordingTab, otherTabRecording, otherOrigin, lastSaved: { fileName, downloadId, at } | null,
//           lastError: outcome kind | null (one-shot) }
// 'starting' = armed request for this tab, not started yet; 'stopped' = time limit reached (D10).
// otherOrigin comes from the background's tabs.get; the popup re-asks on tabs.onUpdated of its tab (E2 D8).
// Saved screen (E4 D7): idle + lastSaved of this tab; the background drops lastSaved on the next successful start.
// "Pokaż plik" talks to downloads directly (search + show of lastSaved.downloadId), never to the background.
import { classifyUrl, isFileAccessAllowed, isFirefoxRuntime } from './target.js';
import { originPatternFor } from '../lib/origin.js';
import { loadDevOptions } from '../lib/dev-options.js';
import { renderModel } from './view.js';

export const RESPONSE_TIMEOUT_MS = 15_000;
export const DOWNLOAD_TIMEOUT_MS = 60_000;

// The background's ceiling is 10 MB of zip (13.3 MB as base64, E3 D7); anything far beyond is not our answer.
const MAX_ZIP_BASE64_CHARS = 20 * 1024 * 1024;

const START_FAILURES = new Set(['permissionDenied', 'recordFailed', 'restricted', 'fileAccess', 'failed']);
const COLLECT_FAILURES = new Set(['pageBusy', 'failed']);
const SCREENSHOT_RESULTS = new Set(['included', 'off', 'failed']);
// The page may still be reloading right after "Nagrywaj": a failed frameCheck is asked again on a later status.
const FRAME_CHECK_ATTEMPTS = 3;
const FRAME_CHECK_TIMEOUT_MS = 3000;
// The background accepts 1..999 frames (E4 D8).
const MAX_FRAMES_SENT = 999;
// "Pokaż plik" (D7, spike S1 not confirmed): Chrome may still report exists: true right after the file was removed,
// because its check starts only with downloads.search. One more search this long after the click catches that.
const FILE_RECHECK_MS = 500;
const STATUS_ERRORS = new Set(['saveCancelled', 'downloadFailed', 'pageBusy', 'permissionDenied', 'recordFailed', 'restricted', 'failed']);
// Error verdicts stay until the next user action or a new lastError (AC-1.4, AC-2.4): a state change
// without lastError says nothing new — after a refused consent the background goes starting -> idle
// (QA F-1), after its own collect timeout saving -> recording.
const STICKY_OUTCOMES = new Set([
  'pageBusy',
  'failed',
  'downloadFailed',
  'saveCancelled',
  'permissionDenied',
  'recordFailed',
  'restricted',
  'fileAccess',
]);

class TimeoutError extends Error {}

// base64 -> bytes by hand (atob), so the zip never goes through a network-like API.
function fromBase64(text) {
  if (text.length > MAX_ZIP_BASE64_CHARS) throw new RangeError('zip answer too large');
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

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

  const ctx = {
    target: null,
    tab: null,
    origin: null,
    pattern: null,
    busy: null,
    outcome: null,
    crossOriginFrames: null,
    frameCheck: null,
    showReady: false, // "Nowe nagranie": local only, a reopened popup shows the saved screen again (AC-1.6)
    fileMissing: false,
    devOptions: null,
  };
  const frameCheck = { attempts: 0, running: false, done: false };
  let status = null;
  let requestId = null; // one per popup: a repeated click re-arms the same request (D9)
  let refreshSeq = 0;
  // lastError is one-shot and clearing it is a storage change, which starts a newer refresh:
  // an error from an overtaken answer is kept here for the next applied status.
  let missedError = null;
  let save = null; // { downloadId, url, timer } while waiting for the background's verdict
  let destroyed = false;
  let searchedId = null; // downloadId already searched for when the saved screen was shown
  let showing = false;
  let recheckTimer = null;

  const render = () => {
    if (destroyed) return;
    api.render(
      renderModel(status, {
        target: ctx.target,
        busy: ctx.busy,
        outcome: ctx.outcome,
        crossOriginFrames: ctx.crossOriginFrames,
        frameCheck: ctx.frameCheck,
        showReady: ctx.showReady,
        fileMissing: ctx.fileMissing,
        devOptions: ctx.devOptions,
      }),
    );
    primeFileCheck();
  };

  // The saved file's download id while the saved screen is what this popup shows; null otherwise.
  function savedDownloadId() {
    const last = status?.lastSaved;
    if (ctx.target !== 'web' || ctx.showReady || ctx.busy || !last || typeof last.fileName !== 'string' || !last.fileName) return null;
    if (status.isRecordingTab === true && status.state !== 'idle') return null;
    return Number.isInteger(last.downloadId) ? last.downloadId : null;
  }

  // D7: a search when the saved screen appears makes Chrome start checking that the file is still there.
  function primeFileCheck() {
    const id = savedDownloadId();
    if (id === null || id === searchedId) return;
    searchedId = id;
    // Only a definite "gone" counts here; the click decides the rest.
    Promise.resolve()
      .then(() => api.downloads.search({ id }))
      .then(([item] = []) => {
        if (item?.exists === false) onDownloadChanged({ id, exists: { current: false } });
      })
      .catch(() => {});
  }

  // true = the file is known to be gone (no entry, not complete, exists false); false = maybe there. Never throws.
  async function fileState(id) {
    try {
      const [item] = (await api.downloads.search({ id })) ?? [];
      return !item || item.state !== 'complete' || item.exists === false;
    } catch {
      return true;
    }
  }

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
    // Firefox grants file:///* as "all sites" but never injects into files (QA F-4, decision 2):
    // say so before any consent prompt instead of a recording that cannot happen.
    if (kind === 'file' && isFirefox) return 'fileUnsupportedFirefox';
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
    // Another saved file: its own "Pokaż plik" check.
    if (next.lastSaved?.downloadId !== status?.lastSaved?.downloadId) forgetFileCheck();
    status = next;
    const lastError = STATUS_ERRORS.has(next.lastError) ? next.lastError : missedError;
    missedError = null;
    if (save && next.lastSaved && next.lastSaved.downloadId === save.downloadId) {
      finishSave({ kind: 'saved', fileName: next.lastSaved.fileName, screenshot: save.screenshot });
      // A new file in this popup is shown on the saved screen, also after "Nowe nagranie".
      ctx.showReady = false;
      forgetFileCheck();
    } else if (lastError) {
      if (save) finishSave({ kind: lastError });
      else ctx.outcome = { kind: lastError };
    }
    // Fail-closed (review N6): from the first status of this tab's recording until a usable answer, the box is off.
    if (isRecordingHere(next) && ctx.frameCheck === null) ctx.frameCheck = 'pending';
    render();
    checkFrames(next);
  }

  // Store review S1: frames of other sites are never masked on the screenshot, so with any of them on the recorded
  // page the checkbox starts unchecked. Asked once this tab records; fail-closed (review N6, user decision
  // 2026-10-26): until an answer of 0 frames the box is off, a failed attempt says so in the note.
  async function checkFrames(next) {
    if (!isRecordingHere(next) || frameCheck.done || frameCheck.running || frameCheck.attempts >= FRAME_CHECK_ATTEMPTS) return;
    frameCheck.running = true;
    frameCheck.attempts++;
    let res;
    try {
      res = await call({ type: 'frameCheck', tabId: ctx.tab.id }, FRAME_CHECK_TIMEOUT_MS);
    } catch (error) {
      logError('frameCheck', error);
    }
    frameCheck.running = false;
    if (destroyed) return;
    if (res?.ok !== true || !Number.isInteger(res.crossOriginFrames) || res.crossOriginFrames < 0) {
      ctx.frameCheck = 'failed';
    } else {
      frameCheck.done = true;
      ctx.frameCheck = 'done';
      ctx.crossOriginFrames = res.crossOriginFrames;
    }
    render();
  }

  function forgetFileCheck() {
    ctx.fileMissing = false;
    searchedId = null;
    clearTimer(recheckTimer);
    recheckTimer = null;
  }

  function isRecordingHere(next) {
    return next.isRecordingTab === true && (next.state === 'recording' || next.state === 'stopped');
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

  // D7: the browser noticed the saved file is gone (Chrome reports it after a search started the check).
  const onDownloadChanged = (delta) => {
    const id = savedDownloadId();
    if (id === null || delta?.id !== id || delta.exists?.current !== false || ctx.fileMissing) return;
    ctx.fileMissing = true;
    render();
  };

  // Chrome has no tabId filter for onUpdated: other tabs are filtered here.
  const onTabUpdated = (tabId) => {
    if (tabId === ctx.tab?.id) refresh();
  };

  async function init() {
    ctx.target = await classify();
    if (ctx.target !== 'web') {
      render();
      return;
    }
    render();
    api.storage?.session?.onChanged?.addListener(onStorageChanged);
    api.tabs?.onUpdated?.addListener(onTabUpdated);
    api.downloads?.onChanged?.addListener(onDownloadChanged);
    // Read-only (AC-6.2); never blocks the first render and never throws (D5, ≤ 1 s).
    loadDevOptions({ storage: api.storage }).then((options) => {
      ctx.devOptions = options;
      render();
    });
    await refresh();
  }

  // "Pokaż plik" (D7, AC-1.2): search again, then show the file of lastSaved. Anything that says the file is gone —
  // no entry, not complete, exists false, show rejecting or answering false (Firefox) — gives fileMissing; nothing
  // reaches the console (the reporter only needs the message). The method is read at the click (e2e spies on it).
  async function onShowFile() {
    const id = savedDownloadId();
    if (id === null || showing) return;
    showing = true;
    let missing = await fileState(id);
    if (!missing) {
      try {
        missing = (await Promise.resolve(api.downloads.show(id))) === false;
      } catch {
        missing = true;
      }
    }
    showing = false;
    if (destroyed || savedDownloadId() !== id) return;
    ctx.fileMissing = missing;
    render();
    if (!missing) {
      // Spike S1 not confirmed: a removed file may still look present right after the first search.
      clearTimer(recheckTimer);
      recheckTimer = setTimer(async () => {
        recheckTimer = null;
        if (destroyed || savedDownloadId() !== id || ctx.fileMissing) return;
        if (await fileState(id)) onDownloadChanged({ id, exists: { current: false } });
      }, FILE_RECHECK_MS);
    }
  }

  // "Nowe nagranie": back to the disclosure and "Nagrywaj" in this popup only; nothing is sent (D7, AC-1.6).
  function onNewRecording() {
    if (ctx.target !== 'web' || ctx.busy) return;
    ctx.showReady = true;
    ctx.outcome = null;
    forgetFileCheck();
    render();
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

  // Why the box was unticked (E4 D8): the reporter's own click, or the default from the frame check.
  function screenshotOff(screenshotTouched) {
    if (screenshotTouched === true) return { screenshotOffReason: 'reporter' };
    if (Number.isInteger(ctx.crossOriginFrames) && ctx.crossOriginFrames > 0) {
      return { screenshotOffReason: 'frames', crossOriginFrames: Math.min(ctx.crossOriginFrames, MAX_FRAMES_SENT) };
    }
    if (ctx.frameCheck !== 'done') return { screenshotOffReason: 'frameCheckFailed' };
    return { screenshotOffReason: 'reporter' };
  }

  // `includeScreenshot` is the checkbox above "Zapisz paczkę" (E3 D6); missing means its default, checked.
  // `screenshotTouched`: the reporter clicked that box in this popup (view.wasTouched).
  async function onSave({ includeScreenshot = true, screenshotTouched = false } = {}) {
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
      const include = includeScreenshot !== false;
      const message = { type: 'collect', tabId, includeScreenshot: include, ...(include ? {} : screenshotOff(screenshotTouched)) };
      const res = await api.runtime.sendMessage(message);
      if (res?.ok !== true || typeof res.zipBase64 !== 'string' || !res.zipBase64 || typeof res.fileName !== 'string' || !res.fileName) {
        if (!COLLECT_FAILURES.has(res?.reason)) logError('collect: unexpected answer', res);
        return { failure: COLLECT_FAILURES.has(res?.reason) ? res.reason : 'failed' };
      }
      if (timedOut) return { failure: 'pageBusy' };
      const bytes = fromBase64(res.zipBase64); // a broken answer throws here: still 'collecting' -> failed
      phase = 'downloading';
      const url = api.URL.createObjectURL(new api.Blob([bytes], { type: 'application/zip' }));
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
      return { downloadId, url, fileName: res.fileName, screenshot: SCREENSHOT_RESULTS.has(res.screenshot) ? res.screenshot : null };
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

    save = { downloadId: result.downloadId, url: result.url, timer: null, screenshot: result.screenshot };
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
    api.tabs?.onUpdated?.removeListener(onTabUpdated);
    api.downloads?.onChanged?.removeListener(onDownloadChanged);
    clearTimer(recheckTimer);
    if (save) {
      clearTimer(save.timer);
      if (save.url) api.URL.revokeObjectURL(save.url);
      save = null;
    }
  }

  return { init, onRecord, onSave, onShowFile, onNewRecording, refresh, destroy };
}
