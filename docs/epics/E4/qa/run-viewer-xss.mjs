// E4 QA: xss-traps.json in the viewer (AC-4.5), all tabs, flag/dialog/request/anchor checks.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const VIEWER = pathToFileURL(join(ROOT, 'src/standalone/viewer.html')).href;
const b = await chromium.launch({ channel: 'chromium', headless: true });
const page = await (await b.newContext()).newPage();
const seen = { requests: [], dialogs: [], errors: [] };
page.on('request', (r) => { if (r.url() !== VIEWER && !/^(blob|data):/.test(r.url())) seen.requests.push(r.url()); });
page.on('dialog', (d) => { seen.dialogs.push(d.message()); d.dismiss(); });
page.on('pageerror', (e) => seen.errors.push(String(e)));
await page.goto(VIEWER);
await page.setInputFiles('#file', join(ROOT, 'tests/fixtures/snapshots/xss-traps.json'));
await page.waitForTimeout(700);
const out = {};
for (const t of ['summary', 'steps', 'errors', 'network', 'console', 'vitals', 'dom', 'storage']) {
  await page.click(`nav[role=tablist] button[data-tab="${t}"]`);
  await page.waitForTimeout(100);
}
out.flag = await page.evaluate(() => globalThis.__pwned ?? null);
out.jsAnchors = await page.evaluate(() => [...document.querySelectorAll('a')].filter((a) => /^javascript:/i.test(a.getAttribute('href') ?? '')).length);
out.anchors = await page.evaluate(() => document.querySelectorAll('a[href]').length);
out.scripts = await page.evaluate(() => document.querySelectorAll('main script, main iframe, main img[src^=http], main svg').length);
out.seen = seen;
await page.screenshot({ path: join(HERE, 'shots/viewer-xss-traps.png') });
await b.close();
await writeFile(join(HERE, 'viewer-xss-results.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
