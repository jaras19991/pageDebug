import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../src/popup/messages.js';
import { applyModel, renderModel } from '../../src/popup/view.js';

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

  it('saved outcome and lastSaved show the file name in ready state', () => {
    const name = 'page-debug-snapshot-1.json';
    const m = renderModel(idle(), { target: 'web', outcome: { kind: 'saved', fileName: name } });
    expect(m).toMatchObject({ section: 'ready', statusText: MESSAGES.saved(name), isError: false });
    const last = renderModel(idle({ lastSaved: { fileName: name, downloadId: 3 } }), WEB);
    expect(last.statusText).toBe(MESSAGES.saved(name));
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
