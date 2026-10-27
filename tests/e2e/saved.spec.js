// E4-TEST4a (1): the "Zapisano" screen of the popup (AC-1.1, 1.2, 1.6, 2.1, 6.2). Texts from src/popup/messages.js,
// ids from popup.html. Popup state is read over CDP; "Pokaż plik" is checked with a spy on chrome.downloads.show in the popup
// (the real call would open a file manager).
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MESSAGES } from '../../src/popup/messages.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { DIST_CHROME, launchWithExtension, openPopupFor, waitForDownloadFile } from './helpers/launch.js';
import { readSaveOutcome, SCREENSHOT_DECIDED, saveRecording, startRecording } from './helpers/recording.js';

let server;
let ext;

test.beforeAll(async () => {
  server = await startFixtureServer({ port: 0 });
  ext = await launchWithExtension();
});

test.afterAll(async () => {
  await ext?.close();
  await server?.close();
});

async function withTab(url, fn) {
  const page = await ext.context.newPage();
  try {
    await page.goto(url);
    return await fn(page);
  } finally {
    await page.close();
  }
}

const SAVED_STATE = `(() => {
  const byId = (id) => document.getElementById(id);
  const sections = ['ready', 'recording', 'saved'].filter((id) => !byId(id).hidden);
  return { sections, title: byId('savedTitle').textContent, file: byId('savedFile').textContent, instruction: byId('savedInstruction').textContent,
    missing: byId('savedMissing').textContent, status: byId('status').textContent };
})()`;

// The saved screen after the popup (re)opened: waits until a section is shown.
async function openSaved(page) {
  const popup = await openPopupFor(page);
  await popup.waitFor(`!document.getElementById('saved').hidden || !document.getElementById('ready').hidden`);
  return popup;
}

test('saved screen: file name, instruction and "Pokaż plik" visible without scrolling at 360×600 (AC-1.1)', async () => {
  await withTab(`${server.url}/basic.html`, async (page) => {
    await startRecording(page);
    const saved = await saveRecording(page);
    const popup = await openSaved(page);
    try {
      const state = await popup.evaluate(SAVED_STATE);
      expect(state.sections).toEqual(['saved']);
      expect(state.title).toBe(MESSAGES.savedTitle);
      expect(state.file).toBe(MESSAGES.savedFile(saved.fileName));
      expect(state.instruction).toBe('Wyślij ten plik osobie, która poprosiła Cię o zgłoszenie — jako załącznik e-maila lub w zgłoszeniu.');
      expect(state.instruction).toBe(MESSAGES.savedInstruction);
      const box = await popup.evaluate(`(() => {
        const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: b.top + scrollY, bottom: b.bottom + scrollY, right: b.right }; };
        return { show: r('showFile'), again: r('newRecording'), file: r('savedFile'), instruction: r('savedInstruction'),
          bodyWidth: document.body.getBoundingClientRect().width, scrollHeight: document.documentElement.scrollHeight };
      })()`);
      expect(box.bodyWidth).toBe(360);
      for (const id of ['show', 'again', 'file', 'instruction']) expect(box[id].bottom, `${id} bottom`).toBeLessThanOrEqual(600);
      expect(box.show.right).toBeLessThanOrEqual(360);
      expect(box.scrollHeight).toBeLessThanOrEqual(600);
      expect(await popup.evaluate(`!document.getElementById('showFile').hidden && !document.getElementById('showFile').disabled`)).toBe(true);
    } finally {
      await popup.close();
    }
  });
});

test('"Pokaż plik" calls downloads.show with the saved downloadId; deleted file → "Nie znaleziono pliku…", no console error (AC-1.2)', async () => {
  await withTab(`${server.url}/basic.html`, async (page) => {
    await startRecording(page);
    const saved = await saveRecording(page);
    const popup = await openSaved(page);
    try {
      const downloadId = await popup.evaluate(
        `(async () => (await chrome.downloads.search({})).find((d) => d.filename.endsWith(${JSON.stringify(saved.fileName)}))?.id)()`,
      );
      expect(Number.isInteger(downloadId)).toBe(true);
      await popup.evaluate(`(() => {
        window.__shown = [];
        window.__errors = [];
        const original = console.error;
        console.error = (...a) => { window.__errors.push(a.map(String).join(' ')); original.apply(console, a); };
        addEventListener('error', (e) => window.__errors.push(String(e.message)));
        addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));
        chrome.downloads.show = (id) => { window.__shown.push(id); };
      })()`);

      await popup.click('#showFile');
      await popup.waitFor(`window.__shown.length === 1`);
      expect(await popup.evaluate(`window.__shown`)).toEqual([downloadId]);
      expect(await popup.evaluate(SAVED_STATE).then((s) => s.missing)).toBe('');

      // The file is removed from disk by the browser itself (downloads.removeFile): `exists` turns false at once, the next
      // click finds it gone (search before show) and show is not called again. A plain unlink by another process is not
      // noticed by Chromium within seconds in this environment (spike S1 saw it; here exists stayed true for 3 s), so it
      // cannot serve as a deterministic trigger.
      await popup.evaluate(`chrome.downloads.removeFile(${downloadId})`);
      await popup.click('#showFile');
      await popup.waitFor(`document.getElementById('savedMissing').textContent !== ''`, 8000);
      expect(await popup.evaluate(`document.getElementById('savedMissing').textContent`)).toBe('Nie znaleziono pliku. Zapisz paczkę ponownie.');
      expect(await popup.evaluate(`window.__shown.length`)).toBe(1);
      expect(await popup.evaluate(`window.__errors`)).toEqual([]);
    } finally {
      await popup.close();
    }
  });
});

test('close and reopen popup → saved screen; Nowe nagranie → ready; Nagrywaj → recording; new save → new file name (AC-1.6)', async () => {
  await withTab(`${server.url}/basic.html`, async (page) => {
    await startRecording(page);
    const first = await saveRecording(page);

    let popup = await openSaved(page);
    expect(await popup.evaluate(SAVED_STATE)).toMatchObject({ sections: ['saved'], file: MESSAGES.savedFile(first.fileName) });
    await popup.click('#newRecording');
    await popup.waitFor(`!document.getElementById('ready').hidden`);
    expect((await popup.evaluate(SAVED_STATE)).sections).toEqual(['ready']);
    await popup.close();

    // "Nowe nagranie" is local to that popup: the next one shows the saved screen again.
    popup = await openSaved(page);
    expect(await popup.evaluate(SAVED_STATE)).toMatchObject({ sections: ['saved'], file: MESSAGES.savedFile(first.fileName) });
    await popup.close();

    // Nagrywaj ends the saved screen.
    await startRecording(page);
    popup = await openPopupFor(page);
    await popup.waitFor(`!document.getElementById('recording').hidden`);
    expect((await popup.evaluate(SAVED_STATE)).sections).toEqual(['recording']);
    await popup.close();

    await page.waitForTimeout(1100); // names carry the second: keep the two saves apart
    const second = await saveRecording(page);
    expect(second.fileName).not.toBe(first.fileName);
    popup = await openSaved(page);
    try {
      expect(await popup.evaluate(SAVED_STATE)).toMatchObject({ sections: ['saved'], file: MESSAGES.savedFile(second.fileName) });
    } finally {
      await popup.close();
    }
  });
});

test('from Zapisz paczkę to closing the saved screen (incl. Pokaż plik): 0 http/https/ws requests from the service worker and the popup (AC-2.1)', async () => {
  const sw = await ext.serviceWorker();
  const offenders = [];
  const onRequest = (request) => {
    let from = null;
    try {
      if (request.serviceWorker()) from = 'service worker';
      else if (request.frame().url().startsWith('chrome-extension://')) from = 'extension page';
    } catch {
      from = null;
    }
    if (from && /^(https?|wss?):/i.test(request.url())) offenders.push(`${from}: ${request.method()} ${request.url()}`);
  };
  const resourceUrls = (target) =>
    target.evaluate(`performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /^(https?|wss?):/i.test(n))`);
  await withTab(`${server.url}/basic.html`, async (page) => {
    await startRecording(page);
    const swBefore = (await resourceUrls(sw)).length;
    ext.context.on('request', onRequest);
    try {
      const popup = await openPopupFor(page);
      try {
        await popup.waitFor(`!document.getElementById('save').disabled`);
        await popup.waitFor(SCREENSHOT_DECIDED, 10_000);
        await popup.click('#save');
        const outcome = await readSaveOutcome(popup);
        expect('error' in outcome, JSON.stringify(outcome)).toBe(false);
        await waitForDownloadFile(page, { fileName: outcome.fileName });
        await popup.evaluate(`window.__shown = []; chrome.downloads.show = (id) => { window.__shown.push(id); };`);
        await popup.click('#showFile');
        await popup.waitFor(`window.__shown.length === 1`);
        await popup.click('#newRecording');
        await popup.waitFor(`!document.getElementById('ready').hidden`);
        expect(await resourceUrls(popup)).toEqual([]);
      } finally {
        await popup.close();
      }
    } finally {
      ext.context.off('request', onRequest);
    }
    expect(offenders).toEqual([]);
    expect((await resourceUrls(sw)).length, 'service worker resource entries').toBe(swBefore);
  });
});

test('popup has no settings controls; manifest has no options page (AC-6.2)', async () => {
  const manifest = JSON.parse(await readFile(join(DIST_CHROME, 'manifest.json'), 'utf8'));
  expect(manifest.options_ui).toBeUndefined();
  expect(manifest.options_page).toBeUndefined();

  await withTab(`${server.url}/basic.html`, async (page) => {
    const popup = await openPopupFor(page);
    try {
      await popup.waitFor(`!document.getElementById('ready').hidden`);
      // Every control of popup.html, hidden sections included: the closed set of the reporter's actions.
      const controls = await popup.evaluate(
        `[...document.querySelectorAll('button, input, select, textarea, a, [contenteditable], [role=switch], [role=checkbox]')].map((el) => el.id || el.tagName)`,
      );
      expect(controls.sort()).toEqual(['includeScreenshot', 'newRecording', 'record', 'save', 'showFile'].sort());
      expect(await popup.evaluate(`document.querySelector('a, select, textarea, input[type=text]')`)).toBeNull();
      // The ready screen: one action, no setting about redaction.
      expect(await popup.evaluate(`document.getElementById('ready').querySelectorAll('button, input, select').length`)).toBe(1);
    } finally {
      await popup.close();
    }
  });
});
