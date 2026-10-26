// E1-T19e: console fallback (US-7) in a browser without the extension. src/standalone/console-snapshot.js
// is injected as a page script, the way a developer pastes it into DevTools; download() saves through
// <a download>, so Playwright's own `download` event is the right tool here (unlike the popup flow).
// E3-TEST0: snapshot() and download() are async from v4; download() saves the same zip as the extension.
import { test, expect, chromium } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValidSnapshot, validateZipEntries } from '../helpers/snapshot-validator.js';
import { readZipPackage } from './helpers/download.js';
import { startFixtureServer } from './helpers/fixtures-server.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = resolve(ROOT, 'src/standalone/console-snapshot.js');
const HINT = 'Zbieram od teraz. Odtwórz problem i wywołaj PageDebugSnapshot.download().';
const RUNNING = 'PageDebugSnapshot już działa. Odtwórz problem i wywołaj PageDebugSnapshot.download().';

let server;
let browser;

test.beforeAll(async () => {
  server = await startFixtureServer({ port: 0 });
  browser = await chromium.launch({ channel: 'chromium', headless: process.env.PDS_E2E_HEADED !== '1' });
});

test.afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const count = (entries, text) => entries.filter((e) => JSON.stringify(e).includes(text)).length;

test('console fallback: script prints the Polish hint, download() yields a v4 zip, source console (AC-7.2, AC-7.3)', async () => {
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await context.newPage();
    const messages = [];
    page.on('console', (msg) => messages.push({ type: msg.type(), text: msg.text() }));
    await page.goto(`${server.url}/basic.html`);

    const pastedAt = Date.now();
    await page.addScriptTag({ path: SCRIPT });
    expect(await page.evaluate(() => typeof globalThis.PageDebugSnapshot?.version)).toBe('string');
    await expect.poll(() => messages.filter((m) => m.type === 'info' && m.text === HINT).length).toBe(1);

    await page.evaluate(() => console.log('fb-marker'));
    const pkg = await page.evaluate(async () => await globalThis.PageDebugSnapshot.snapshot());
    assertValidSnapshot(pkg);
    expect(pkg.schemaVersion).toBe(4);
    expect(pkg.source).toBe('console');
    expect(pkg.documents.length).toBe(1);
    expect(count(pkg.consoleLogs, 'fb-marker')).toBe(1);
    // Logged before the paste, so not recorded (AC-7.3: data from before the paste is not collected).
    expect(count(pkg.consoleLogs, 'basic fixture loaded')).toBe(0);
    expect(Date.parse(pkg.recordingStartedAt)).toBeGreaterThanOrEqual(pastedAt - 1000);
    expect(pkg.notes.join('\n')).toMatch(/pasted/);
    // Our own hint is not in the package.
    expect(count(pkg.consoleLogs, 'Zbieram od teraz')).toBe(0);

    const [download, fileName] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(async () => await globalThis.PageDebugSnapshot.download()),
    ]);
    const host = new URL(server.url).hostname;
    expect(download.suggestedFilename()).toMatch(new RegExp(`^snapshot-${host.replace(/\./g, '\\.')}-\\d{8}-\\d{6}\\.zip$`));
    expect(download.suggestedFilename()).toBe(fileName);
    const { entries, json: saved, summary } = await readZipPackage(await download.path());
    const zip = validateZipEntries(entries, saved);
    expect(zip.errors).toEqual([]);
    expect(entries).toEqual(['snapshot.json', 'summary.md']); // no screenshot without the extension
    expect(summary.length).toBeGreaterThan(0);
    assertValidSnapshot(saved);
    expect(saved.schemaVersion).toBe(4);
    expect(saved.source).toBe('console');
    expect(count(saved.consoleLogs, 'fb-marker')).toBe(1);

    // Pasting again does not install a second set of hooks: one more hint, each marker recorded once.
    await page.addScriptTag({ path: SCRIPT });
    await expect.poll(() => messages.filter((m) => m.type === 'info' && m.text === RUNNING).length).toBe(1);
    await page.evaluate(() => console.log('fb-marker-2'));
    const again = await page.evaluate(async () => await globalThis.PageDebugSnapshot.snapshot());
    expect(count(again.consoleLogs, 'fb-marker-2')).toBe(1);
    expect(count(again.consoleLogs, 'fb-marker')).toBe(2); // 'fb-marker' and 'fb-marker-2'
    expect(messages.filter((m) => m.text === 'fb-marker-2').length).toBe(1);
    expect(messages.filter((m) => m.text === HINT).length).toBe(1);
  } finally {
    await context.close();
  }
});
