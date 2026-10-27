import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../src/popup/messages.js';

const HTML_PATH = fileURLToPath(new URL('../../src/popup/popup.html', import.meta.url));
const html = readFileSync(HTML_PATH, 'utf8');
const README_PATH = fileURLToPath(new URL('../../README.md', import.meta.url));
const { document } = new JSDOM(html).window;

const text = (selector) => document.querySelector(selector)?.textContent.trim();

describe('popup.html', () => {
  it('has the ready, recording and status containers', () => {
    for (const id of ['ready', 'recording', 'status', 'since', 'hint', 'note', 'record', 'save']) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    expect(document.querySelector('#ready #record')).not.toBeNull();
    expect(document.querySelector('#recording #save')).not.toBeNull();
  });

  it('popup.html: every <button> has a Polish label from the allowed set (Nagrywaj, Zapisz paczkę, Pokaż plik, Nowe nagranie), none English', () => {
    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
    expect(labels.sort()).toEqual(['Nagrywaj', 'Nowe nagranie', 'Pokaż plik', 'Zapisz paczkę']);
    expect(text('#record')).toBe('Nagrywaj');
    expect(text('#save')).toBe('Zapisz paczkę');
  });

  it('button set equals E1 set {record, save} + E4 saved screen {showFile, newRecording}; no "Wyślij" (decision 2026-10-26)', () => {
    const ids = [...document.querySelectorAll('button')].map((b) => b.id).sort();
    expect(ids).toEqual(['newRecording', 'record', 'save', 'showFile']);
    // Sending from the popup was rejected: no send button, no mailto, no link at all.
    expect(document.querySelectorAll('a, form').length).toBe(0);
    expect(html).not.toMatch(/mailto:/i);
    for (const b of document.querySelectorAll('button')) expect(b.textContent).not.toMatch(/Wyślij/);
    // E3: the only form control is the screenshot checkbox (AC-2.1).
    const controls = [...document.querySelectorAll('input, select, textarea, [role="switch"], [role="checkbox"]')];
    expect(controls.map((el) => el.id)).toEqual(['includeScreenshot']);
  });

  it('checkbox #includeScreenshot checked by default, above #save (AC-2.1, AC-1.4)', () => {
    const box = document.querySelector('#recording #includeScreenshot');
    expect(box).not.toBeNull();
    expect(box.getAttribute('type')).toBe('checkbox');
    expect(box.checked).toBe(true);
    expect(box.hasAttribute('checked')).toBe(true);
    const label = box.closest('label');
    expect(label).not.toBeNull();
    expect(label.textContent.trim()).toBe(MESSAGES.includeScreenshot);
    expect(box.compareDocumentPosition(document.getElementById('save')) & 4).toBe(4); // DOCUMENT_POSITION_FOLLOWING
    // Above the button, not inside the sticky ready actions: one short line, so "Zapisz paczkę" stays visible.
    expect(label.closest('#ready')).toBeNull();
  });

  it('#screenshotNote sits between the checkbox and #save, empty and hidden until cross-origin frames are found (store S1)', () => {
    const note = document.querySelector('#recording #screenshotNote');
    expect(note).not.toBeNull();
    expect(note.textContent).toBe('');
    const box = document.getElementById('includeScreenshot');
    expect(box.compareDocumentPosition(note) & 4).toBe(4); // DOCUMENT_POSITION_FOLLOWING
    expect(note.compareDocumentPosition(document.getElementById('save')) & 4).toBe(4);
    const css = document.querySelector('style').textContent.replace(/\s+/g, ' ');
    expect(css).toMatch(/#screenshotNote:empty \{[^}]*display: none;/);
  });

  it('popup.html static texts equal MESSAGES incl. privacyNote and includeScreenshot label (AC-1.3)', () => {
    expect(text('#ready #disclosureTitle')).toBe(MESSAGES.disclosureTitle);
    const items = [...document.querySelectorAll('#ready #disclosure > li:not(#disclosureDev)')].map((li) => li.textContent.trim());
    expect(items).toEqual([...MESSAGES.disclosureItems]);
    expect(text('#ready #privacyNote')).toBe(MESSAGES.privacyNote);
    expect(text('#ready #noUpload')).toBe(MESSAGES.noUpload);
    expect(document.querySelector('#recording #includeScreenshot')?.closest('label')?.textContent.trim()).toBe(MESSAGES.includeScreenshot);
    expect(text('#ready #consentNotice')).toBe(MESSAGES.consentNotice);
    expect(text('#ready #reloadNotice')).toBe(MESSAGES.reloadNotice);
    expect(text('#recording #hint')).toBe(MESSAGES.recordingHint);
  });

  it('disclosure sits above the record button', () => {
    const disclosure = document.getElementById('disclosure');
    const record = document.getElementById('record');
    expect(disclosure.compareDocumentPosition(record) & 4).toBe(4); // DOCUMENT_POSITION_FOLLOWING
  });

  it('consent notice sits below the no-upload sentence and above the record button', () => {
    const noUpload = document.getElementById('noUpload');
    const consent = document.getElementById('consentNotice');
    const record = document.getElementById('record');
    expect(noUpload.compareDocumentPosition(consent) & 4).toBe(4); // DOCUMENT_POSITION_FOLLOWING
    expect(consent.compareDocumentPosition(record) & 4).toBe(4);
  });

  it('consent order: disclosure < privacyNote < noUpload < consentNotice < record', () => {
    const order = ['disclosure', 'privacyNote', 'noUpload', 'consentNotice', 'record'].map((id) => document.getElementById(id));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & 4, order[i].id).toBe(4);
    }
  });

  it('fits the 360 px popup and keeps the ready actions sticky at the bottom (AC-1.3)', () => {
    const css = document.querySelector('style').textContent.replace(/\s+/g, ' ');
    expect(css).toMatch(/body \{[^}]*width: 328px;/);
    expect(css).toMatch(/body \{[^}]*padding: 16px;/);
    expect(css).toMatch(/#ready \.actions \{[^}]*position: sticky;[^}]*bottom: 0;[^}]*background: #fff/);
    expect(document.querySelector('#ready .actions #record')).not.toBeNull();
  });

  it('consent and reload notices sit in the sticky footer right above "Nagrywaj", only the list scrolls (QA E4 F-1, AC-1.8)', () => {
    const footer = document.querySelector('#ready .actions');
    const kids = [...footer.children].map((el) => el.id);
    expect(kids).toEqual(['consentNotice', 'reloadNotice', 'record']);
    // The disclosure, privacy note and no-upload sentence stay in the scrolling part above the footer.
    for (const id of ['disclosure', 'privacyNote', 'noUpload']) expect(footer.contains(document.getElementById(id)), id).toBe(false);
    const css = document.querySelector('style').textContent.replace(/\s+/g, ' ');
    expect(css).toMatch(/#ready \.actions p \{[^}]*margin: 0;/);
  });

  it('saved screen texts in popup.html equal MESSAGES; instruction is Q-2 verbatim (AC-1.1)', () => {
    const saved = document.querySelector('section#saved');
    expect(saved).not.toBeNull();
    expect(saved.hasAttribute('hidden')).toBe(true);
    expect(text('#saved #savedTitle')).toBe(MESSAGES.savedTitle);
    expect(text('#saved #savedInstruction')).toBe(MESSAGES.savedInstruction);
    expect(text('#saved #savedInstruction')).toBe(
      'Wyślij ten plik osobie, która poprosiła Cię o zgłoszenie — jako załącznik e-maila lub w zgłoszeniu.',
    );
    expect(text('#saved #showFile')).toBe(MESSAGES.showFile);
    expect(text('#saved #newRecording')).toBe(MESSAGES.newRecording);
    // Filled by view.js: the file name, the screenshot suffix and the "file not found" alert.
    for (const id of ['savedFile', 'savedShot', 'savedMissing']) {
      expect(document.querySelector(`#saved #${id}`), id).not.toBeNull();
      expect(text(`#saved #${id}`), id).toBe('');
    }
    expect(document.getElementById('savedMissing').getAttribute('role')).toBe('alert');
    const order = ['savedTitle', 'savedFile', 'savedInstruction', 'showFile', 'newRecording'].map((id) => document.getElementById(id));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & 4, order[i].id).toBe(4); // FOLLOWING
    }
    const css = document.querySelector('style').textContent.replace(/\s+/g, ' ');
    expect(css).toMatch(/#savedShot:empty, #savedMissing:empty \{[^}]*display: none;/);
  });

  it('consentNotice is AC-1.8 verbatim in messages.js and popup.html (AC-1.8)', () => {
    expect(text('#ready #consentNotice')).toBe(
      'Mimo automatycznego usuwania haseł i tokenów plik może zawierać Twoje dane osobowe (np. adresy stron, treść logów) — wyślij go tylko developerowi. Klikając „Nagrywaj”, zgadzasz się na zapisanie tych danych w pliku.',
    );
    expect(text('#ready #consentNotice')).toBe(MESSAGES.consentNotice);
  });

  it('disclosure ends with the hidden, empty #disclosureDev item filled by the view (AC-6.5)', () => {
    const items = [...document.querySelectorAll('#ready #disclosure > li')];
    const last = items.at(-1);
    expect(last.id).toBe('disclosureDev');
    expect(last.hasAttribute('hidden')).toBe(true);
    expect(last.textContent).toBe('');
  });

  it('no element in popup.html changes developer settings (no select/checkbox other than #includeScreenshot) (AC-6.2)', () => {
    const controls = [...document.querySelectorAll('input, select, textarea, [contenteditable], [role="switch"], [role="checkbox"], [role="radio"], [role="listbox"]')];
    expect(controls.map((el) => el.id)).toEqual(['includeScreenshot']);
    expect(document.body.textContent).not.toMatch(/ustawienia|opcje|konfiguracj/i);
  });

  it('status message sits above both sections, so "Zapisano…" is visible without scrolling at 360×600 (QA F-1)', () => {
    const status = document.getElementById('status');
    for (const id of ['ready', 'recording', 'saved']) {
      expect(status.compareDocumentPosition(document.getElementById(id)) & 4, id).toBe(4); // FOLLOWING
    }
    expect(status.parentElement).toBe(document.body);
    const css = document.querySelector('style').textContent.replace(/\s+/g, ' ');
    expect(css).toMatch(/#status:empty \{[^}]*display: none;/); // no empty gap above the disclosure
  });

  it('README discloses that cross-origin frames are visible on the screenshot (E3 PB-1 B, store S1)', () => {
    const readme = readFileSync(README_PATH, 'utf8').replace(/\r\n/g, '\n');
    const section = readme.match(/^## Znane ograniczenia\n([\s\S]*?)(?=^## |(?![\s\S]))/m)[1];
    const item = section.split(/\n(?=- )/).find((entry) => entry.includes('Zrzut a ramki innych serwisów'));
    expect(item?.replace(/\s+/g, ' ')).toMatch(/ramki cross-origin .*nie są zakrywane/);
    expect(section).not.toMatch(/Dane nie są redagowane|Zrzut ekranu nie jest maskowany/);
  });

  it('README activeTab line mentions screenshot in PL and EN', () => {
    const readme = readFileSync(README_PATH, 'utf8').replace(/\r\n/g, '\n');
    const section = readme.match(/^## Uprawnienia\n([\s\S]*?)(?=^## |(?![\s\S]))/m)[1];
    const short = section.match(/^- `activeTab` — .*$/m);
    expect(short, 'short activeTab line').not.toBeNull();
    expect(short[0]).toContain('zrzut');
    const entry = section.match(/^- `activeTab`\n((?: {2}.*\n?)+)/m);
    expect(entry, 'store-form activeTab entry').not.toBeNull();
    expect(entry[1]).toMatch(/^ {2}- PL: .*zrzut.*$/m);
    expect(entry[1]).toMatch(/^ {2}- EN: .*screenshot.*$/m);
  });

  it('loads popup.js as a module and has no inline scripts or handlers (CSP)', () => {
    const scripts = [...document.querySelectorAll('script')];
    expect(scripts).toHaveLength(1);
    expect(scripts[0].getAttribute('type')).toBe('module');
    expect(scripts[0].getAttribute('src')).toBe('popup.js');
    expect(scripts[0].textContent.trim()).toBe('');
    for (const el of document.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) {
        expect(attr.startsWith('on'), `${el.tagName} ${attr}`).toBe(false);
      }
    }
    expect(html).not.toMatch(/javascript:/i);
  });

  it('is Polish and has no leftover E0 snapshot button', () => {
    expect(document.documentElement.getAttribute('lang')).toBe('pl');
    expect(document.getElementById('runSnapshot')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Debug snapshot|snapshot debugowy/);
  });

  it('no JSON, zip, hash, redakcja in the popup; "token" only inside #privacyNote and #consentNotice (AC-1.3, AC-1.8)', () => {
    const body = document.body.cloneNode(true);
    for (const el of body.querySelectorAll('script, #privacyNote, #consentNotice')) el.remove();
    const visible = body.textContent.toLowerCase();
    // "Snapshot" stays allowed only as part of the product name in <h1>.
    for (const word of ['json', 'zip', 'hash', 'redakcj', 'token', 'mcp']) expect(visible, word).not.toContain(word);
  });
});
