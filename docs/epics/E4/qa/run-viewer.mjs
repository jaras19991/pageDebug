// E4 QA: the standalone viewer opened from file:// (no extension). Run: node docs/epics/E4/qa/run-viewer.mjs
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const VIEWER = pathToFileURL(join(ROOT, 'src/standalone/viewer.html')).href;
const SHOTS = join(HERE, 'shots');
const TMP = join(HERE, 'pkgs');
await mkdir(SHOTS, { recursive: true });

// Derived files: corrupt zip (truncated), not a package, schema 5.
const iter = await readFile(join(TMP, 'iterator.zip'));
await writeFile(join(TMP, 'corrupt.zip'), iter.subarray(0, Math.floor(iter.length / 2)));
await writeFile(join(TMP, 'notapackage.json'), JSON.stringify({ hello: 'world' }));
await writeFile(join(TMP, 'notapackage.txt'), 'to nie jest paczka');
const v4 = JSON.parse(await readFile(join(ROOT, 'tests/fixtures/snapshots/v4.json'), 'utf8'));
await writeFile(join(TMP, 'schema5.json'), JSON.stringify({ ...v4, schemaVersion: 5 }));

const FILES = [
  ['iterator.zip', join(TMP, 'iterator.zip')],
  ['privacy.zip', join(TMP, 'privacy.zip')],
  ['iterator-keep.zip', join(TMP, 'iterator-keep.zip')],
  ['basic.zip', join(TMP, 'basic.zip')],
  ['network.zip', join(TMP, 'network.zip')],
  ['v4.json', join(ROOT, 'tests/fixtures/snapshots/v4.json')],
  ['v3.json', join(ROOT, 'tests/fixtures/snapshots/v3.json')],
  ['v2.json', join(ROOT, 'tests/fixtures/snapshots/v2.json')],
  ['v1.json', join(ROOT, 'tests/fixtures/snapshots/v1.json')],
  ['corrupt.zip', join(TMP, 'corrupt.zip')],
  ['notapackage.json', join(TMP, 'notapackage.json')],
  ['notapackage.txt', join(TMP, 'notapackage.txt')],
  ['schema5.json', join(TMP, 'schema5.json')],
];
const TABS = ['summary', 'steps', 'errors', 'network', 'console', 'vitals', 'dom', 'storage'];

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const out = {};
for (const [name, path] of FILES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const seen = { requests: [], dialogs: [], errors: [] };
  page.on('request', (r) => { if (r.url() !== VIEWER && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) seen.requests.push(r.url()); });
  page.on('dialog', (d) => { seen.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => seen.errors.push(String(e)));
  await page.goto(VIEWER);
  const rec = { tabsTexts: {} };
  const t0 = Date.now();
  await page.setInputFiles('#file', path).catch(async () => {
    // fall back: first file input
    await page.setInputFiles('input[type=file]', path);
  });
  await page.waitForTimeout(600);
  rec.loadMs = Date.now() - t0;
  rec.header = (await page.locator('header').innerText()).slice(0, 900);
  rec.tabsVisible = await page.locator('nav[role=tablist]').isVisible();
  if (rec.tabsVisible) {
    for (const t of TABS) {
      const ts = Date.now();
      await page.click(`nav[role=tablist] button[data-tab="${t}"]`);
      rec.tabsTexts[t] = await page.locator('#app').innerText();
      rec.tabsTexts[t + '__ms'] = Date.now() - ts;
      if (['iterator.zip', 'v3.json', 'v2.json', 'v1.json', 'network.zip'].includes(name) && ['summary', 'steps', 'errors', 'network'].includes(t)) {
        await page.screenshot({ path: join(SHOTS, `viewer-${name}-${t}.png`) });
      }
    }
    await page.click('nav[role=tablist] button[data-tab="summary"]');
  } else {
    await page.screenshot({ path: join(SHOTS, `viewer-${name}-error.png`) });
  }
  if (name === 'iterator.zip') await page.screenshot({ path: join(SHOTS, `viewer-${name}-full.png`), fullPage: true });
  rec.seen = seen;
  rec.bodyText = (await page.locator('body').innerText()).length;
  out[name] = rec;
  await ctx.close();
}
await browser.close();
await writeFile(join(HERE, 'viewer-results.json'), JSON.stringify(out, null, 1));
for (const [n, r] of Object.entries(out)) console.log(n, r.loadMs, r.tabsVisible, JSON.stringify(r.seen), '\n   ', r.header.replace(/\n/g, ' | ').slice(0, 400));
