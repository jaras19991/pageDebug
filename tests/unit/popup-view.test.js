import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../src/popup/messages.js';
import { applyModel, renderModel, wasTouched } from '../../src/popup/view.js';

const HTML_PATH = fileURLToPath(new URL('../../src/popup/popup.html', import.meta.url));
const html = readFileSync(HTML_PATH, 'utf8');

const STARTED_AT = new Date(2026, 9, 22, 9, 5, 7).getTime();
const WEB = { target: 'web' };
const idle = (extra = {}) => ({
  state: 'idle',
  startedAt: null,
  isRecordingTab: false,
  otherTabRecording: false,
  otherOrigin: false,
  lastSaved: null,
  lastError: null,
  ...extra,
});
const recording = (extra = {}) => idle({ state: 'recording', startedAt: STARTED_AT, isRecordingTab: true, ...extra });

function domFor(model) {
  const { document } = new JSDOM(html).window;
  applyModel(document, model);
  const visible = (id) => !document.getElementById(id).hidden;
  return { document, visible, text: (id) => document.getElementById(id).textContent };
}

describe('renderModel', () => {
  it('ready model shows disclosure section and record button', () => {
    const m = renderModel(idle(), WEB);
    expect(m.section).toBe('ready');
    expect(m.buttons).toEqual({ record: true, save: false });
    expect(m.statusText).toBe('');
    const dom = domFor(m);
    expect(dom.visible('ready')).toBe(true);
    expect(dom.visible('recording')).toBe(false);
    expect(dom.text('disclosureTitle')).toBe(MESSAGES.disclosureTitle);
    expect(dom.document.getElementById('record').disabled).toBe(false);
  });

  it('recording model since matches regex and shows save', () => {
    const m = renderModel(recording(), WEB);
    expect(m.section).toBe('recording');
    expect(m.since).toMatch(/^Nagrywam od \d{2}:\d{2}:\d{2}$/);
    expect(m.since).toBe('Nagrywam od 09:05:07');
    expect(m.hint).toBe(true);
    expect(m.buttons).toEqual({ record: false, save: true });
    const dom = domFor(m);
    expect(dom.visible('recording')).toBe(true);
    expect(dom.visible('ready')).toBe(false);
    expect(dom.text('since')).toBe('Nagrywam od 09:05:07');
    expect(dom.text('note')).toBe('');
  });

  it('otherOrigin note on recording tab', () => {
    const m = renderModel(recording({ otherOrigin: true }), WEB);
    expect(m.note).toBe(MESSAGES.otherOrigin);
    expect(domFor(m).text('note')).toBe(MESSAGES.otherOrigin);
  });

  it('otherTabRecording note in ready state', () => {
    const status = recording({ isRecordingTab: false, otherTabRecording: true });
    const m = renderModel(status, WEB);
    expect(m.section).toBe('ready');
    expect(m.statusText).toBe(MESSAGES.otherTabRecording);
    expect(m.isError).toBe(false);
    expect(m.buttons.record).toBe(true);
  });

  it('stopped view shows stoppedByLimit text and save button', () => {
    const m = renderModel(recording({ state: 'stopped', stopReason: 'time-limit' }), WEB);
    expect(m.section).toBe('recording');
    expect(m.since).toBe(MESSAGES.stoppedByLimit);
    expect(m.hint).toBe(false);
    expect(m.buttons.save).toBe(true);
    expect(domFor(m).visible('hint')).toBe(false);
  });

  it('starting and saving disable both buttons', () => {
    const starting = renderModel(idle(), { target: 'web', busy: 'starting' });
    expect(starting).toMatchObject({ section: 'ready', statusText: MESSAGES.starting });
    expect(starting.buttons).toEqual({ record: false, save: false });
    const fromBackground = renderModel(idle({ state: 'starting', isRecordingTab: true }), WEB);
    expect(fromBackground.statusText).toBe(MESSAGES.starting);
    // The background reports an armed request for this tab without isRecordingTab (T12).
    const armed = renderModel(idle({ state: 'starting' }), WEB);
    expect(armed).toMatchObject({ section: 'ready', statusText: MESSAGES.starting });
    expect(armed.buttons).toEqual({ record: false, save: false });

    const saving = renderModel(recording(), { target: 'web', busy: 'saving' });
    expect(saving).toMatchObject({ section: 'recording', statusText: MESSAGES.saving, isError: false });
    expect(saving.buttons).toEqual({ record: false, save: false });
    const reopened = renderModel(recording({ state: 'saving' }), WEB);
    expect(reopened.statusText).toBe(MESSAGES.saving);
  });

  it('lastSaved in idle → saved section with the file name; outcome saved adds the screenshot suffix (E4 D7)', () => {
    const name = 'page-debug-snapshot-1.json';
    const last = renderModel(idle({ lastSaved: { fileName: name, downloadId: 3 } }), WEB);
    expect(last).toMatchObject({ section: 'saved', savedFile: MESSAGES.savedFile(name), savedShot: '', savedMissing: '', statusText: '', isError: false });
    expect(last.buttons).toEqual({ record: false, save: false });
    const withShot = renderModel(idle({ lastSaved: { fileName: name, downloadId: 3 } }), {
      target: 'web',
      outcome: { kind: 'saved', fileName: name, screenshot: 'failed' },
    });
    expect(withShot.savedShot).toBe(MESSAGES.screenshotFailedSaved);
    const missing = renderModel(idle({ lastSaved: { fileName: name, downloadId: 3 } }), { target: 'web', fileMissing: true });
    expect(missing.savedMissing).toBe(MESSAGES.fileMissing);
    // "Nowe nagranie" (local): ready with the record button, no saved line in the status (D7).
    const ready = renderModel(idle({ lastSaved: { fileName: name, downloadId: 3 } }), { target: 'web', showReady: true });
    expect(ready).toMatchObject({ section: 'ready', statusText: '', buttons: { record: true } });
    // Saved outcome without lastSaved never shows the old status line in ready.
    expect(renderModel(idle(), { target: 'web', outcome: { kind: 'saved', fileName: name } })).toMatchObject({ section: 'ready', statusText: '' });
    // Another tab's recording, this tab idle with a saved file: still the saved screen, with the note.
    const other = renderModel(idle({ otherTabRecording: true, lastSaved: { fileName: name, downloadId: 3 } }), WEB);
    expect(other).toMatchObject({ section: 'saved', statusText: MESSAGES.otherTabRecordingSaved });
    // QA E4 F-3: the saved screen has no "Nagrywaj", so its line does not send the reporter to it.
    expect(MESSAGES.otherTabRecordingSaved).not.toMatch(/Nagrywaj/);
    expect(MESSAGES.otherTabRecordingSaved).toMatch(/innej karcie/);
  });

  it('applyModel shows only the saved section, texts via textContent', () => {
    const name = '<img src=x onerror=alert(1)>.zip';
    const m = renderModel(idle({ lastSaved: { fileName: name, downloadId: 3 } }), { target: 'web', fileMissing: true });
    const dom = domFor(m);
    expect(dom.visible('saved')).toBe(true);
    expect(dom.visible('ready')).toBe(false);
    expect(dom.visible('recording')).toBe(false);
    expect(dom.text('savedFile')).toBe(MESSAGES.savedFile(name));
    expect(dom.document.querySelector('#saved img')).toBeNull();
    expect(dom.text('savedShot')).toBe('');
    expect(dom.text('savedMissing')).toBe(MESSAGES.fileMissing);
    // Back to ready hides it again.
    applyModel(dom.document, renderModel(idle(), WEB));
    expect(dom.visible('saved')).toBe(false);
    expect(dom.text('savedMissing')).toBe('');
  });

  it.each(['saveCancelled', 'downloadFailed', 'pageBusy', 'failed'])('%s while recording keeps save and marks an error', (kind) => {
    const m = renderModel(recording(), { target: 'web', outcome: { kind } });
    expect(m).toMatchObject({ section: 'recording', statusText: MESSAGES[kind], isError: true });
    expect(m.buttons.save).toBe(true);
    const dom = domFor(m);
    expect(dom.document.getElementById('status').classList.contains('error')).toBe(true);
  });

  it('permissionDenied in ready state', () => {
    const m = renderModel(idle(), { target: 'web', outcome: { kind: 'permissionDenied' } });
    expect(m).toMatchObject({ section: 'ready', statusText: MESSAGES.permissionDenied, isError: true });
  });

  it.each(['restricted', 'fileAccess', 'noTab'])('%s hides both sections and offers no button', (target) => {
    const m = renderModel(null, { target });
    expect(m).toMatchObject({ section: null, statusText: MESSAGES[target], isError: true });
    expect(m.buttons).toEqual({ record: false, save: false });
    const dom = domFor(m);
    expect(dom.visible('ready')).toBe(false);
    expect(dom.visible('recording')).toBe(false);
    expect(dom.text('status')).toBe(MESSAGES[target]);
  });

  it('unknown status with failed outcome shows failed only', () => {
    const m = renderModel(null, { target: 'web', outcome: { kind: 'failed' } });
    expect(m).toMatchObject({ section: null, statusText: MESSAGES.failed, isError: true });
  });

  it('unexpected outcome kind never shows raw text', () => {
    const m = renderModel(idle(), { target: 'web', outcome: { kind: 'TypeError: boom' } });
    expect(m.statusText).toBe(MESSAGES.failed);
  });
});

describe('applyModel: screenshot checkbox (E3 AC-2.1)', () => {
  it('checkbox disabled while saving, checked state untouched by re-render', () => {
    const { document } = new JSDOM(html).window;
    const box = document.getElementById('includeScreenshot');
    applyModel(document, renderModel(recording(), WEB));
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);

    box.checked = false; // the reporter's choice lives until the popup closes
    applyModel(document, renderModel(recording(), { target: 'web', busy: 'saving' }));
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);

    applyModel(document, renderModel(recording(), { target: 'web', outcome: { kind: 'pageBusy' } }));
    expect(box.disabled).toBe(false);
    expect(box.checked).toBe(false);
    applyModel(document, renderModel(recording({ state: 'stopped', stopReason: 'time-limit' }), WEB));
    expect(box.disabled).toBe(false);
    expect(box.checked).toBe(false);
  });
});

describe('screenshot default with cross-origin frames (store S1, review F4)', () => {
  it('renderModel: frameCheck pending → off without a note; failed → off with the note; a count wins (N6 fail-closed)', () => {
    expect(renderModel(recording(), { target: 'web', frameCheck: 'pending' })).toMatchObject({ screenshotDefault: false, screenshotNote: '' });
    expect(renderModel(recording(), { target: 'web', frameCheck: 'failed' })).toMatchObject({
      screenshotDefault: false,
      screenshotNote: MESSAGES.screenshotCheckFailedNote,
    });
    expect(renderModel(recording(), { target: 'web', frameCheck: 'done', crossOriginFrames: 0 })).toMatchObject({ screenshotDefault: true, screenshotNote: '' });
    // Outside a recording of this tab there is no check: default on, as before.
    expect(renderModel(idle(), { target: 'web', frameCheck: null })).toMatchObject({ screenshotDefault: true, screenshotNote: '' });
  });

  it('applyModel: pending unchecks, the answer 0 checks again — unless the reporter clicked the box (N6)', () => {
    const fresh = () => new JSDOM(html).window.document;
    let document = fresh();
    let box = document.getElementById('includeScreenshot');
    applyModel(document, renderModel(recording(), { target: 'web', frameCheck: 'pending' }));
    expect(box.checked).toBe(false);
    applyModel(document, renderModel(recording(), { target: 'web', frameCheck: 'done', crossOriginFrames: 0 }));
    expect(box.checked).toBe(true);

    // The reporter clicks twice (on, off) before the answer: the answer 0 does not override it.
    document = fresh();
    box = document.getElementById('includeScreenshot');
    applyModel(document, renderModel(recording(), { target: 'web', frameCheck: 'pending' }));
    box.click();
    box.click();
    expect(box.checked).toBe(false);
    applyModel(document, renderModel(recording(), { target: 'web', frameCheck: 'done', crossOriginFrames: 0 }));
    expect(box.checked).toBe(false);

    // The reporter turns it on during the check; a failed check keeps it on, with the note.
    document = fresh();
    box = document.getElementById('includeScreenshot');
    applyModel(document, renderModel(recording(), { target: 'web', frameCheck: 'pending' }));
    box.click();
    applyModel(document, renderModel(recording(), { target: 'web', frameCheck: 'failed' }));
    expect(box.checked).toBe(true);
    expect(document.getElementById('screenshotNote').textContent).toBe(MESSAGES.screenshotCheckFailedNote);
  });

  it('renderModel: crossOriginFrames > 0 turns the default off and adds the note; 0 or unknown keeps it on', () => {
    const off = renderModel(recording(), { target: 'web', crossOriginFrames: 2 });
    expect(off.screenshotDefault).toBe(false);
    expect(off.screenshotNote).toBe(MESSAGES.screenshotFramesNote);
    for (const crossOriginFrames of [0, null, undefined]) {
      const on = renderModel(recording(), { target: 'web', crossOriginFrames, frameCheck: crossOriginFrames === 0 ? 'done' : null });
      expect(on.screenshotDefault, String(crossOriginFrames)).toBe(true);
      expect(on.screenshotNote, String(crossOriginFrames)).toBe('');
    }
    // Saving and stopped keep the same default and note.
    expect(renderModel(recording(), { target: 'web', busy: 'saving', crossOriginFrames: 1 })).toMatchObject({
      screenshotDefault: false,
      screenshotNote: MESSAGES.screenshotFramesNote,
    });
    expect(renderModel(recording({ state: 'stopped' }), { target: 'web', crossOriginFrames: 1 }).screenshotDefault).toBe(false);
  });

  it('applyModel unchecks the box once when the default turns off; the reporter can check it again', () => {
    const { document } = new JSDOM(html).window;
    const box = document.getElementById('includeScreenshot');
    const note = () => document.getElementById('screenshotNote').textContent;
    applyModel(document, renderModel(recording(), WEB));
    expect(box.checked).toBe(true);
    expect(note()).toBe('');

    applyModel(document, renderModel(recording(), { target: 'web', crossOriginFrames: 1 }));
    expect(box.checked).toBe(false);
    expect(note()).toBe(MESSAGES.screenshotFramesNote);

    box.checked = true; // the reporter turns it on
    applyModel(document, renderModel(recording(), { target: 'web', crossOriginFrames: 1 }));
    applyModel(document, renderModel(recording(), { target: 'web', busy: 'saving', crossOriginFrames: 1 }));
    expect(box.checked).toBe(true);
    expect(note()).toBe(MESSAGES.screenshotFramesNote);
  });
});

describe('developer options in the disclosure (E4 AC-6.5)', () => {
  it('disabledRules [email, html-structure] → disclosureDev lists both texts; [] → hidden', () => {
    const m = renderModel(idle(), { target: 'web', devOptions: { disabledRules: ['email', 'html-structure'] } });
    const expected = `${MESSAGES.disclosureDevExtra.email}; ${MESSAGES.disclosureDevExtra['html-structure']}`;
    expect(m.disclosureDev).toBe(expected);
    const dom = domFor(m);
    expect(dom.visible('disclosureDev')).toBe(true);
    expect(dom.text('disclosureDev')).toBe(expected);

    for (const devOptions of [{ disabledRules: [] }, null, undefined, { disabledRules: ['jwt', '<b>x</b>'] }, { disabledRules: 'email' }]) {
      const none = renderModel(idle(), { target: 'web', devOptions });
      expect(none.disclosureDev, JSON.stringify(devOptions)).toBe('');
      const d = domFor(none);
      expect(d.visible('disclosureDev')).toBe(false);
      expect(d.text('disclosureDev')).toBe('');
    }
  });

  it('phone alone, order of DEFAULT_RULES kept', () => {
    expect(renderModel(idle(), { target: 'web', devOptions: { disabledRules: ['phone'] } }).disclosureDev).toBe(MESSAGES.disclosureDevExtra.phone);
  });
});

describe('wasTouched (E4 D8)', () => {
  it('false until the reporter clicks the box, true after; unknown box → false', () => {
    const { document } = new JSDOM(html).window;
    const box = document.getElementById('includeScreenshot');
    expect(wasTouched(box)).toBe(false);
    applyModel(document, renderModel(recording(), WEB));
    expect(wasTouched(box)).toBe(false);
    applyModel(document, renderModel(recording(), { target: 'web', crossOriginFrames: 2 }));
    expect(wasTouched(box)).toBe(false); // a default set by the view is not a touch
    box.click();
    expect(wasTouched(box)).toBe(true);
    expect(wasTouched(null)).toBe(false);
  });
});
