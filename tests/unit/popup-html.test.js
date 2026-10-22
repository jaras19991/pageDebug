import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../src/popup/messages.js';

const HTML_PATH = fileURLToPath(new URL('../../src/popup/popup.html', import.meta.url));
const html = readFileSync(HTML_PATH, 'utf8');
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

  it('popup.html: every <button> has a Polish label from the allowed set (Nagrywaj, Zapisz paczkę), none English', () => {
    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
    expect(labels.sort()).toEqual(['Nagrywaj', 'Zapisz paczkę']);
    expect(text('#record')).toBe('Nagrywaj');
    expect(text('#save')).toBe('Zapisz paczkę');
  });

  it('popup.html static disclosure text equals MESSAGES', () => {
    expect(text('#ready #disclosureTitle')).toBe(MESSAGES.disclosureTitle);
    const items = [...document.querySelectorAll('#ready #disclosure > li')].map((li) => li.textContent.trim());
    expect(items).toEqual([...MESSAGES.disclosureItems]);
    expect(text('#ready #noUpload')).toBe(MESSAGES.noUpload);
    expect(text('#ready #reloadNotice')).toBe(MESSAGES.reloadNotice);
    expect(text('#recording #hint')).toBe(MESSAGES.recordingHint);
  });

  it('disclosure sits above the record button', () => {
    const disclosure = document.getElementById('disclosure');
    const record = document.getElementById('record');
    expect(disclosure.compareDocumentPosition(record) & 4).toBe(4); // DOCUMENT_POSITION_FOLLOWING
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
});
