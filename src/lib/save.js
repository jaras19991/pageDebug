// Background side of "Zapisz paczkę" (design D7, E1-T8b; E3 D6–D8). The background takes the masked
// screenshot, collects the current document through the ISOLATED bridge, builds the redacted zip
// (export.js) and hands it to the popup as base64; the popup owns the Blob and calls
// downloads.download (the service worker has no URL.createObjectURL). The background then tracks
// the download and is the only source of truth about success. All state lives in `pds:rec.save`
// (storage.session; only the file name, never the package), so a fresh instance after an SW /
// event page restart continues where the old one stopped.

import { assembleParts } from './package.js';
import { exportAssembled as exportZip } from './export.js';
import { resolveDisabledRules } from './redact.js';
import { fromBase64, toBase64 } from './zip.js';
import { isSameOrigin } from './origin.js';
import { captureScreenshot, maskScreenshot, MASK_LIMITS, SCREENSHOT_LIMITS } from './screenshot.js';
import { FRAMES_MAX, frameCount } from './screenshot-notes.js';

// D7 / AC-2.4: click → download id, and download start → complete.
export const COLLECT_TIMEOUT_MS = 15_000;
export const DOWNLOAD_TIMEOUT_MS = 60_000;
// E3 D6: one `fieldRects` answer from ISOLATED; counted in the 15 s of the collect.
export const FIELD_RECTS_TIMEOUT_MS = 1000;
// `frameCheck` and the frames note only need "how many, roughly"; a bigger count is reported as this.
const MAX_FRAMES_REPORTED = FRAMES_MAX;
// Why the popup left the screenshot off (E4 D8); anything else counts as the reporter's switch.
const SCREENSHOT_OFF_REASONS = new Set(['reporter', 'frames', 'frameCheckFailed']);

// Protocol of the MAIN `collect` result (design T15: `{ protocol, recorderVersion, docId, … }`).
// Mirrors PROTOCOL from src/page/constants.js (T3c, E2-T9a); src/lib does not import page modules.
export const RESULT_PROTOCOL = 3;
// Same bound as CHANNEL_MAX_MESSAGE: one serialized result never exceeds this many characters.
const MAX_RESULT_CHARS = 32 * 1024 * 1024;
const MAX_FILE_NAME = 255;

const BADGE_NONE = '';

const TIMEOUT = Symbol('timeout');

// Why a package has no screenshot (E2 D5, AC-6.3/6.4); goes to `notes` through meta.screenshotNote.
const SHOT_NOTE_OTHER_SITE = 'No screenshot: the tab showed a page outside the recorded site.';
const SHOT_NOTE_HIDDEN = 'No screenshot: the tab was not visible.';
const SHOT_NOTE_TOO_LARGE = 'No screenshot: the image could not be made smaller than 300 KB.';
const SHOT_NOTE_MOVED = 'No screenshot: the page moved while the screenshot was taken.';
const shotFailedNote = (reason) =>
  reason === 'too-large' ? SHOT_NOTE_TOO_LARGE : `No screenshot: capture failed (${String(reason).slice(0, 40)}).`;
// The image is kept, but over FIELD_RECTS_MAX fields ISOLATED gives one rectangle of the whole view (E3-IN1a).
const NOTE_FIELDS_OVERFLOW = 'More than 2000 form fields: the whole screenshot is covered.';

// Why form fields could not be hidden: `SCREENSHOT_NOTES.notHidden(reason)` in screenshot-notes.js (E3 D6, AC-2.4).
const MASK_REASONS = Object.freeze({
  noAnswer: 'the page did not answer', // no bridge (e.g. loadedAfterStop), timeout, sendMessage threw
  invalid: 'invalid answer',
  zoomed: 'page is zoomed in', // pinch-zoom: rectangles do not match the image (spike S0)
  notMasked: 'the image could not be masked', // no codec with `mask`, decode/mask error, scale off
});
const MASK_REASON_MAX = 120;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// `viewport.vvScale` of collectFieldRects; missing means 1 (no visualViewport). Same tolerance as planMask.
function isPinchZoomed(viewport) {
  const scale = viewport.vvScale;
  if (scale === undefined) return false;
  return !Number.isFinite(scale) || Math.abs(scale - 1) > MASK_LIMITS.vvScaleTolerance;
}

/** Checks a `fieldRects` answer: `{ rects, viewport, overflow }` or `{ reason }` (no screenshot then). */
function checkFieldRects(answer) {
  if (isObject(answer) && answer.ok === false && typeof answer.reason === 'string' && answer.reason !== '') {
    return { reason: answer.reason.slice(0, MASK_REASON_MAX) };
  }
  if (!isObject(answer) || answer.ok !== true || !isObject(answer.viewport) || !Array.isArray(answer.rects)) {
    return { reason: MASK_REASONS.invalid };
  }
  const { viewport } = answer;
  if (![viewport.innerWidth, viewport.innerHeight, viewport.scrollX, viewport.scrollY].every(Number.isFinite)) {
    return { reason: MASK_REASONS.invalid };
  }
  if (isPinchZoomed(viewport)) return { reason: MASK_REASONS.zoomed };
  return { rects: answer.rects, viewport, overflow: answer.overflow === true, framesVisible: visibleFrames(answer.frames) };
}

// Cross-origin frames the reporter could see (`frames.crossOriginVisible`, IN11); they are never masked (PB-1 = B).
// Malformed → 0: the note is information only, the image does not depend on it.
function visibleFrames(frames) {
  const count = isObject(frames) ? frames.crossOriginVisible : undefined;
  return Number.isInteger(count) && count > 0 ? Math.min(count, MAX_FRAMES_REPORTED) : 0;
}

// `collect` message → the popup's reason for an unticked box (E4 D8); `crossOriginFrames` only with 'frames', 1..999.
function screenshotOffOf({ screenshotOffReason, crossOriginFrames }) {
  const reason = typeof screenshotOffReason === 'string' && SCREENSHOT_OFF_REASONS.has(screenshotOffReason) ? screenshotOffReason : 'reporter';
  const count = reason === 'frames' ? frameCount(crossOriginFrames) : null;
  if (reason === 'frames' && count === null) return { screenshotOffReason: 'reporter' };
  return count === null ? { screenshotOffReason: reason } : { screenshotOffReason: reason, crossOriginFrames: count };
}

// R1 ∪ R2 without repeats: a field that did not move is one rectangle (and one in `maskedFields`). Malformed entries
// stay as they are, so planMask rejects them.
function unionRects(first, second) {
  const seen = new Set();
  const out = [];
  for (const rect of [...first, ...second]) {
    const key = isObject(rect) ? `${rect.x},${rect.y},${rect.w},${rect.h}` : null;
    if (key !== null && seen.has(key)) continue;
    if (key !== null) seen.add(key);
    out.push(rect);
  }
  return out;
}

// R1 and R2 describe the same view: nothing scrolled or resized while the image was taken.
const samePlace = (a, b) =>
  a.innerWidth === b.innerWidth && a.innerHeight === b.innerHeight && a.scrollX === b.scrollX && a.scrollY === b.scrollY;

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
 *   `unregisterAll(scripting)` / `setBadge(action, tabId, kind)` from content-scripts.js (T1b);
 *   optional `codec` (screenshot.js `createCanvasCodec`) to mask form fields and shrink the screenshot;
 *   optional `getDevOptions` (E4 D5; `() => Promise<{ disabledRules }>`, read once per collect; failure → defaults); optional `exportAssembled`
 *   (export.js, injected by tests).
 */
export function createSaveHandlers(api) {
  const { store, tabs, downloads, runtime, scripting, action } = api;
  const codec = api.codec ?? null;
  const getDevOptions = typeof api.getDevOptions === 'function' ? api.getDevOptions : async () => ({});
  const exportAssembled = api.exportAssembled ?? exportZip;
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

  // `promise` or TIMEOUT after `timeoutMs`, whichever comes first.
  async function withTimeout(promise, timeoutMs) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = schedule(() => resolve(TIMEOUT), Math.max(0, timeoutMs));
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      unschedule(timer);
    }
  }

  function sendCollect(tabId, timeoutMs, fullHtml) {
    const message = fullHtml ? { type: 'collect', options: { fullHtml: true } } : { type: 'collect' };
    return withTimeout(tabs.sendMessage(tabId, message, { frameId: 0 }), timeoutMs);
  }

  // Field rectangles from ISOLATED (E3-IN1a); never throws.
  async function requestFieldRects(tabId, timeoutMs) {
    let answer;
    try {
      answer = await withTimeout(tabs.sendMessage(tabId, { type: 'fieldRects' }, { frameId: 0 }), Math.min(FIELD_RECTS_TIMEOUT_MS, timeoutMs));
    } catch {
      return { reason: MASK_REASONS.noAnswer };
    }
    return answer === TIMEOUT ? { reason: MASK_REASONS.noAnswer } : checkFieldRects(answer);
  }

  /**
   * D6: R1 = fieldRects → captureVisibleTab → origin re-check → R2 = fieldRects; a view that moved gets one retry
   * (R2 becomes R1). The mask is R1 ∪ R2. The unmasked capture never leaves this function: every failure gives a
   * note instead of an image (AC-2.4).
   * `framesVisible` = max(R1, R2) visible cross-origin frames of the kept image (IN11, a note only).
   * @returns {Promise<{ tab: object|null, shot?: object, overflow?: boolean, framesVisible?: number, maskFailure?: string, note?: string }>}
   */
  async function takeScreenshot({ tabId, tab, origin, getTab, timeLeft }) {
    let before = await requestFieldRects(tabId, timeLeft());
    if (before.reason) return { tab, maskFailure: before.reason };
    for (let attempt = 0; attempt < 2; attempt++) {
      // No size limit here: maskScreenshot fits the masked image.
      const captured = await captureScreenshot({ tabs, tab, codec, now, maxBytes: Infinity });
      // The tab may have navigated while the image was taken: re-check, and drop the image of another site.
      tab = await getTab();
      if (!(tab && isSameOrigin(tab.url, origin))) return { tab, note: SHOT_NOTE_OTHER_SITE };
      if (captured.error) return { tab, note: shotFailedNote(captured.error) };
      const after = await requestFieldRects(tabId, timeLeft());
      if (after.reason) return { tab, maskFailure: after.reason };
      if (!samePlace(before.viewport, after.viewport)) {
        before = after;
        continue;
      }
      const masked = await withTimeout(
        maskScreenshot({ dataUrl: captured.shot.dataUrl, rects: unionRects(before.rects, after.rects), viewport: after.viewport, codec }),
        SCREENSHOT_LIMITS.timeoutMs,
      );
      if (masked === TIMEOUT) return { tab, note: shotFailedNote('timeout') };
      if (masked.error === 'fields-not-hidden') return { tab, maskFailure: MASK_REASONS.notMasked };
      if (masked.error) return { tab, note: shotFailedNote(masked.error) };
      return {
        tab,
        shot: { ...masked.shot, epochMs: captured.shot.epochMs },
        overflow: before.overflow || after.overflow,
        framesVisible: Math.max(before.framesVisible, after.framesVisible),
      };
    }
    return { tab, note: SHOT_NOTE_MOVED };
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
    /**
     * Popup command: masked screenshot (unless switched off), current document, redacted zip (E3 D6–D8).
     * `includeScreenshot` missing = true (the checkbox default). With `includeScreenshot: false` the popup may say why:
     * `screenshotOffReason` 'reporter'|'frames'|'frameCheckFailed' and `crossOriginFrames` 1..999 (E4 D8). Answer: `{ ok: true, zipBase64, fileName, packageBytes, screenshot: 'included'|'off'|'failed' }`.
     */
    async collect({ tabId, includeScreenshot, ...offReason } = {}) {
      const startedAt = now();
      let rec = null;
      await store.updateRec((current) => {
        if (!isRecordingTab(current, tabId)) return undefined;
        rec = { ...current, save: { phase: 'collecting', startedAt, downloadId: null, fileName: null } };
        return rec;
      });
      if (!rec) return { ok: false, reason: 'failed' };
      const sameAttempt = (r) => r.save?.startedAt === startedAt;
      // Screenshot, fieldRects and the page share the same 15 s (expireSave measures from startedAt too).
      const timeLeft = () => COLLECT_TIMEOUT_MS - (now() - startedAt);

      const getTab = async () => {
        try {
          return await tabs.get(tabId);
        } catch {
          // Tab closed after the recording: package from the flushed documents only.
          return null;
        }
      };
      let tab = await getTab();

      // Screenshot first, so it shows the page at the click (D5). Only of the recorded site and only when the tab
      // is the visible one: the check comes before the API call, nothing of another site is ever captured (AC-6.3).
      // Switched off by the reporter: no API call at all (AC-2.1). Failures only add a note; the save goes on (AC-6.4).
      let screenshots;
      let screenshotNote;
      let maskFailure;
      let fieldsOverflow = false;
      let framesVisible = 0;
      const screenshotOff = includeScreenshot === false;
      if (screenshotOff) {
        // package.js writes the note: the reporter's switch, or why the popup left it off.
      } else if (tab && isSameOrigin(tab.url, rec.origin)) {
        if (tab.active) {
          const result = await takeScreenshot({ tabId, tab, origin: rec.origin, getTab, timeLeft });
          tab = result.tab;
          if (result.shot) screenshots = [{ ...result.shot, reason: 'save' }];
          else if (result.maskFailure) maskFailure = result.maskFailure;
          else screenshotNote = result.note;
          fieldsOverflow = result.overflow === true;
          framesVisible = result.framesVisible ?? 0;
        } else {
          screenshotNote = SHOT_NOTE_HIDDEN;
        }
      } else if (tab) {
        screenshotNote = SHOT_NOTE_OTHER_SITE;
      }

      const version = runtime.getManifest().version;
      // One read per save, after the screenshot (it never delays the capture); a bad or failed read = default rules (AC-6.3).
      let devOptions = {};
      try {
        const options = await getDevOptions();
        if (isObject(options)) devOptions = options;
      } catch {
        // Defaults: saving is never blocked by the developer configuration.
      }
      // `html-structure` among the developer's disabled rules = full HTML (E3 D12, AC-6.3).
      const fullHtml = resolveDisabledRules(devOptions.disabledRules).includes('html-structure');
      let current = null;
      let currentMissingReason;
      if (tab && isSameOrigin(tab.url, rec.origin)) {
        let raw;
        let noReceiver = false;
        try {
          raw = await sendCollect(tabId, timeLeft(), fullHtml);
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

      // The package stays in memory only: redacted and zipped here, handed to the popup, never stored (NFR privacy).
      let exported;
      let screenshotBytes = null;
      try {
        const { pkg, screenshotDataUrl } = assembleParts({
          meta: {
            extensionVersion: version,
            source: 'extension',
            startedAt: rec.startedAt,
            collectedAt,
            stopReason,
            deadline,
            currentMissingReason,
            screenshots,
            screenshotOff,
            ...(screenshotOff ? screenshotOffOf(offReason) : {}),
            maskFailure,
            screenshotNote,
            framesVisible,
            fullHtml,
          },
          current,
          priorDocs,
          docs: Array.isArray(rec.docs) ? rec.docs : [],
        });
        if (fieldsOverflow && pkg.screenshots.length > 0) pkg.notes.push(NOTE_FIELDS_OVERFLOW);
        if (screenshotDataUrl !== null) {
          try {
            screenshotBytes = fromBase64(screenshotDataUrl.slice(screenshotDataUrl.indexOf(',') + 1));
          } catch {
            screenshotBytes = null; // exportAssembled drops the metadata with a note
          }
        }
        exported = await exportAssembled(pkg, { screenshot: screenshotBytes, devOptions, date: new Date(collectedAt), origin: rec.origin });
      } catch {
        await failSave(sameAttempt);
        return { ok: false, reason: 'failed' };
      }
      const { bytes, fileName, packageBytes } = exported;

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
      // QA F-5: the popup tells the reporter when the file has no screenshot.
      const screenshot = screenshotOff ? 'off' : screenshotBytes !== null ? 'included' : 'failed';
      return { ok: true, zipBase64: toBase64(bytes), fileName, packageBytes, screenshot };
    },

    /**
     * Popup question at open (store review S1): cross-origin frames of the recorded page are never masked (PB-1 = B),
     * so with any of them in view the popup turns the screenshot off by default. Reuses ISOLATED's `fieldRects` (top frame,
     * ≤ 1 s); nothing is stored or captured. Answer: `{ ok: true, crossOriginFrames }` or `{ ok: false }`.
     */
    async frameCheck({ tabId } = {}) {
      const current = await store.getRec();
      if (!isRecordingTab(current, tabId)) return { ok: false };
      let tab;
      try {
        tab = await tabs.get(tabId);
      } catch {
        return { ok: false };
      }
      if (!tab || !isSameOrigin(tab.url, current.origin)) return { ok: false };
      let answer;
      try {
        answer = await withTimeout(tabs.sendMessage(tabId, { type: 'fieldRects' }, { frameId: 0 }), FIELD_RECTS_TIMEOUT_MS);
      } catch {
        return { ok: false };
      }
      // Only frames the reporter can see count (`crossOriginVisible`); an answer without it falls back to all of them.
      const frames = isObject(answer) && answer.ok === true && isObject(answer.frames) ? answer.frames : {};
      const count = 'crossOriginVisible' in frames ? frames.crossOriginVisible : frames.crossOrigin;
      if (!Number.isInteger(count) || count < 0) return { ok: false };
      return { ok: true, crossOriginFrames: Math.min(count, MAX_FRAMES_REPORTED) };
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
