// Popup view (design D9, E1-T6b): `renderModel` turns the background status plus the popup's
// own context into a plain model; `applyModel` writes that model into popup.html. No browser API.
import { MESSAGES, messageFor } from './messages.js';

// Targets known at popup open that never reach the background (AC-1.7).
const BLOCKED_TARGETS = new Set(['restricted', 'fileAccess', 'fileUnsupportedFirefox', 'noTab']);

function model(section, opts = {}) {
  const { since = '', hint = false, note = '', statusText = '', isError = false, savedFile = '', savedShot = '', savedMissing = '' } = opts;
  return {
    section,
    since,
    hint,
    note,
    statusText,
    isError,
    buttons: { record: !!opts.record, save: !!opts.save },
    savedFile,
    savedShot,
    savedMissing,
  };
}

// The collect answer's `screenshot` → the sentence under the file name on the saved screen (QA F-5); 'included' → none.
const SAVED_SHOT = { off: 'screenshotOffSaved', failed: 'screenshotFailedSaved' };
// Bounds what the view reads from the developer options (AC-6.5): the closed set of disclosureDevExtra keys.
const MAX_DEV_RULES = 20;

// The saved verdict has its own screen (E4 D7): it is never a status line.
const outcomeText = (outcome) => (outcome && outcome.kind !== 'saved' ? messageFor(outcome) : '');
const isErrorOutcome = (outcome) => !!outcome && outcome.kind !== 'saved';

/**
 * @param {object | null} status  getStatus answer from the background (null until known)
 * @param {{ target: 'web' | 'restricted' | 'fileAccess' | 'fileUnsupportedFirefox' | 'noTab',
 *           busy?: 'starting' | 'saving' | null,
 *           outcome?: { kind: string, fileName?: string, screenshot?: string } | null,
 *           crossOriginFrames?: number | null,
 *           frameCheck?: 'pending' | 'failed' | 'done' | null,
 *           showReady?: boolean, fileMissing?: boolean,
 *           devOptions?: { disabledRules: string[] } | null }} ctx  crossOriginFrames: `frameCheck` answer, null = unknown;
 *           frameCheck: null when not asked (no recording of this tab); showReady: "Nowe nagranie" clicked in this popup;
 *           fileMissing: "Pokaż plik" found no file; devOptions: loadDevOptions() result, null until known
 * @returns {{ section: 'ready' | 'recording' | 'saved' | null, since: string, hint: boolean, note: string,
 *             statusText: string, isError: boolean, buttons: { record: boolean, save: boolean },
 *             savedFile: string, savedShot: string, savedMissing: string, disclosureDev: string,
 *             screenshotDefault: boolean, screenshotNote: string }}
 */
export function renderModel(status, ctx) {
  // `screenshotDefault`: the checkbox state the popup starts from; off when the page embeds frames of other sites,
  // which are never masked (store review S1). `screenshotNote` says why. Same in every section of one popup.
  return { ...sectionModel(status, ctx), disclosureDev: disclosureDevText(ctx.devOptions), ...screenshotDefaults(ctx) };
}

// What the developer's configuration adds to "Do pliku trafią:" (AC-6.5): texts of the turned-off default rules,
// in the order of the options (DEFAULT_RULES); anything else is ignored. '' = the item stays hidden.
function disclosureDevText(devOptions) {
  const rules = devOptions?.disabledRules;
  if (!Array.isArray(rules)) return '';
  const texts = [];
  for (let i = 0; i < Math.min(rules.length, MAX_DEV_RULES); i++) {
    const rule = rules[i];
    if (typeof rule === 'string' && Object.hasOwn(MESSAGES.disclosureDevExtra, rule)) {
      const text = MESSAGES.disclosureDevExtra[rule];
      if (!texts.includes(text)) texts.push(text);
    }
  }
  return texts.join('; ');
}

// Fail-closed (review N6): while this tab's frame check is pending or after it failed, the default is off;
// only an answer of 0 frames turns it on. No check (not recording here) keeps the default on.
function screenshotDefaults({ crossOriginFrames = null, frameCheck = null }) {
  if (Number.isInteger(crossOriginFrames) && crossOriginFrames >= 0) {
    return crossOriginFrames > 0
      ? { screenshotDefault: false, screenshotNote: MESSAGES.screenshotFramesNote }
      : { screenshotDefault: true, screenshotNote: '' };
  }
  if (frameCheck === 'failed') return { screenshotDefault: false, screenshotNote: MESSAGES.screenshotCheckFailedNote };
  if (frameCheck === 'pending') return { screenshotDefault: false, screenshotNote: '' };
  return { screenshotDefault: true, screenshotNote: '' };
}

function sectionModel(status, ctx) {
  const { target, busy = null, outcome = null, showReady = false, fileMissing = false } = ctx;
  if (BLOCKED_TARGETS.has(target)) {
    return model(null, { statusText: MESSAGES[target], isError: true });
  }
  if (!status) {
    if (outcome) return model(null, { statusText: outcomeText(outcome), isError: isErrorOutcome(outcome) });
    return model(null);
  }

  const own = status.isRecordingTab === true;
  // 'starting' belongs to this tab's armed request, which is not a recording yet.
  const state = own || status.state === 'starting' ? status.state : 'idle';

  // A local verdict (e.g. the 60 s limit) outranks the background still saying "saving".
  if (busy === 'saving' || (state === 'saving' && !outcome)) {
    return model('recording', {
      since: sinceText(status),
      statusText: MESSAGES.saving,
    });
  }
  if (state === 'recording' || state === 'stopped' || state === 'saving') {
    const stopped = state === 'stopped';
    return model('recording', {
      since: sinceText(status),
      hint: !stopped,
      note: status.otherOrigin ? MESSAGES.otherOrigin : '',
      statusText: outcomeText(outcome),
      isError: isErrorOutcome(outcome),
      save: true,
    });
  }
  if (busy === 'starting' || state === 'starting') {
    return model('ready', { statusText: MESSAGES.starting });
  }

  // Idle: a local outcome wins, then another tab's recording.
  let statusText = outcomeText(outcome);
  const isError = isErrorOutcome(outcome);
  if (!statusText && status.otherTabRecording) statusText = MESSAGES.otherTabRecording;

  // Saved screen (E4 D7): this tab's last file, until "Nagrywaj" (the background then drops lastSaved) or, only in
  // this popup, "Nowe nagranie". Only the file name comes from the data (AC-2.2).
  const fileName = status.lastSaved?.fileName;
  if (!showReady && typeof fileName === 'string' && fileName) {
    const shot = outcome?.kind === 'saved' && Object.hasOwn(SAVED_SHOT, outcome.screenshot) ? MESSAGES[SAVED_SHOT[outcome.screenshot]] : '';
    return model('saved', {
      statusText: statusText === MESSAGES.otherTabRecording ? MESSAGES.otherTabRecordingSaved : statusText,
      isError,
      savedFile: MESSAGES.savedFile(fileName),
      savedShot: shot,
      savedMissing: fileMissing ? MESSAGES.fileMissing : '',
    });
  }
  return model('ready', { statusText, isError, record: true });
}

function sinceText(status) {
  return status.state === 'stopped' ? MESSAGES.stoppedByLimit : MESSAGES.recordingSince(status.startedAt);
}

// The screenshot default last written per checkbox: a default is applied once when it changes, so a re-render never
// overrides the reporter's own click (E3 D6, store S1). A box the reporter has clicked gets no default at all (N6).
const appliedDefaults = new WeakMap();
const touchedBoxes = new WeakSet();

/** True once the reporter has clicked the checkbox in this popup (E4 D8: the reason sent with an unticked box). */
export function wasTouched(box) {
  return !!box && touchedBoxes.has(box);
}

/** Writes a model into the popup document (ids from popup.html). Text only, never HTML. */
export function applyModel(doc, m) {
  const byId = (id) => doc.getElementById(id);
  byId('ready').hidden = m.section !== 'ready';
  byId('recording').hidden = m.section !== 'recording';
  const saved = byId('saved');
  if (saved) {
    saved.hidden = m.section !== 'saved';
    byId('savedFile').textContent = m.savedFile ?? '';
    byId('savedShot').textContent = m.savedShot ?? '';
    byId('savedMissing').textContent = m.savedMissing ?? '';
  }
  const disclosureDev = byId('disclosureDev');
  if (disclosureDev) {
    disclosureDev.textContent = m.disclosureDev ?? '';
    disclosureDev.hidden = !m.disclosureDev;
  }
  byId('since').textContent = m.since;
  byId('hint').hidden = !m.hint;
  byId('note').textContent = m.note;
  byId('record').disabled = !m.buttons.record;
  byId('save').disabled = !m.buttons.save;
  // The screenshot checkbox follows "Zapisz paczkę"; `checked` is the reporter's, set only when the default changes.
  const includeScreenshot = byId('includeScreenshot');
  if (includeScreenshot) {
    includeScreenshot.disabled = !m.buttons.save;
    const screenshotDefault = m.screenshotDefault !== false;
    if (!appliedDefaults.has(includeScreenshot)) {
      // `change` fires only for the reporter's click, never for `checked` set here.
      includeScreenshot.addEventListener('change', () => touchedBoxes.add(includeScreenshot));
    }
    const changed = appliedDefaults.has(includeScreenshot) ? appliedDefaults.get(includeScreenshot) !== screenshotDefault : !screenshotDefault;
    if (changed && !touchedBoxes.has(includeScreenshot)) includeScreenshot.checked = screenshotDefault;
    appliedDefaults.set(includeScreenshot, screenshotDefault);
  }
  const screenshotNote = byId('screenshotNote');
  if (screenshotNote) screenshotNote.textContent = m.screenshotNote ?? '';
  const status = byId('status');
  status.textContent = m.statusText;
  status.classList.toggle('error', m.isError);
}
