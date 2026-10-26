// E3-TEST5: format and size of the v4 package, the popup with the screenshot toggle, the built extension
// (AC-1.1, 1.2, 1.4, 5.2, 6.1, 6.2, 6.4, NFR rozmiar/uprawnienia). Save times (AC-1.5) are in perf.spec.js.
// Measured zip sizes go to test-results/e3-package-sizes.json for the QA report (test-coverage.md).
import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { mergeManifest } from '../../scripts/lib/manifest.mjs';
import { ZIP_ENTRIES } from '../helpers/snapshot-validator.js';
import { countDownloads } from './helpers/download.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SIZES_FILE = resolve(ROOT, 'test-results/e3-package-sizes.json');
const PACKAGE_BYTES = 2_097_152; // AC-6.1
const STRUCTURE_CHARS = 300_000; // AC-5.2
const DIST_FILE_BYTES = 500 * 1024; // NFR rozszerzenie
const BASELINE_TAG = 'v0.4.0';
const run = promisify(execFile);

let server;
let ext;
const sizes = {};

test.beforeAll(async () => {
  server = await startFixtureServer({ port: 0 });
  ext = await launchWithExtension();
});

test.afterAll(async () => {
  await ext?.close();
  await server?.close();
  if (Object.keys(sizes).length) {
    await mkdir(dirname(SIZES_FILE), { recursive: true });
    await writeFile(SIZES_FILE, JSON.stringify({ measuredAt: new Date().toISOString(), limit: PACKAGE_BYTES, sizes }, null, 2));
  }
});

async function withTab(fn) {
  const page = await ext.context.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

async function zipBytes(path) {
  return (await stat(path)).size;
}

test('zip entries order; unzip -t on downloaded file "No errors"; exactly one file in downloads (AC-1.1, 1.2, 6.4)', async () => {
  await withTab(async (page) => {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);
    const counter = await countDownloads(page);
    const { entries, path, json, files } = await saveRecording(page);

    expect(entries).toEqual([...ZIP_ENTRIES]); // snapshot.json first, then summary.md, screenshot.jpg
    expect(json.screenshots).toHaveLength(1);
    expect(json.screenshots[0].file).toBe('screenshot.jpg');
    expect(new TextDecoder().decode(files['snapshot.json'])).not.toMatch(/data:image|\/9j\//); // no base64 JPEG inside
    const { stdout } = await run('unzip', ['-t', path], { timeout: 30_000 });
    expect(stdout).toContain('No errors detected');
    expect(await counter.names()).toHaveLength(1);
  });
});

for (const { fixture, act } of [
  { fixture: 'basic.html' },
  { fixture: 'privacy.html' },
  { fixture: 'network.html', act: (page) => page.evaluate(async () => { await globalThis.__done; await globalThis.runSeq('size'); }) },
]) {
  test(`${fixture}: zip ≤ 2 MB (AC-6.1)`, async () => {
    await withTab(async (page) => {
      await page.goto(`${server.url}/${fixture}`);
      await startRecording(page);
      await act?.(page);
      const { path, json } = await saveRecording(page);
      const bytes = await zipBytes(path);
      sizes[fixture] = bytes;
      console.log(`[E3-TEST5] ${fixture}: zip ${bytes} B`);
      expect(bytes).toBeLessThanOrEqual(PACKAGE_BYTES);
      expect(json.limits.packageBytes).toBe(PACKAGE_BYTES);
    });
  });
}

test('heavy-e3 → zip ≤ 2 MB with truncated flags and notes; never-cut sections intact (AC-6.1, 6.2)', async () => {
  test.setTimeout(180_000);
  await withTab(async (page) => {
    await page.goto(`${server.url}/heavy-e3.html`);
    await startRecording(page, { timeout: 30_000 });
    expect(await page.evaluate(() => globalThis.__elements)).toBeGreaterThanOrEqual(50_000);
    // 5000 successful requests first: the network buffer keeps the newest 5000 (E1), so the failures come after them.
    expect(await page.evaluate(() => globalThis.heavyFetch(5000))).toBe(5000);
    for (let i = 0; i < 3; i++) await page.click('#act');
    expect(await page.evaluate(() => globalThis.heavyFailures(20))).toBe(20);
    expect(await page.evaluate(() => globalThis.heavyErrors(5))).toBe(5);
    expect(await page.evaluate(() => globalThis.heavyLogs(5000, 40_000))).toBe(5000);

    const { path, json, files, savedAfterMs } = await saveRecording(page, { timeout: 30_000, resultTimeout: 60_000 });
    const bytes = await zipBytes(path);
    sizes['heavy-e3.html'] = bytes;
    sizes['heavy-e3.html screenshot.jpg'] = files['screenshot.jpg']?.length ?? 0;
    console.log(`[E3-TEST5] heavy-e3: zip ${bytes} B, screenshot ${sizes['heavy-e3.html screenshot.jpg']} B, saved after ${savedAfterMs} ms`);
    console.log(`[E3-TEST5] heavy-e3: truncated ${JSON.stringify(json.truncated)}, notes ${JSON.stringify(json.notes)}`);
    console.log(`[E3-TEST5] heavy-e3: snapshot.json ${files['snapshot.json'].length} B, consoleLogs ${json.consoleLogs.length}, network ${json.network.length}, resources ${json.performance?.resources?.length}, limits ${JSON.stringify(json.limits)}`);
    expect(bytes).toBeLessThanOrEqual(PACKAGE_BYTES);

    // Cut: flags and a note per cut (the budget cuts logs and successful requests first, D8).
    expect(json.truncated.consoleLogs).toBe(true);
    expect(json.truncated.network).toBe(true);
    expect(json.notes.some((n) => /console logs \(debug, log, info, warn\) were removed/.test(n))).toBe(true);
    expect(json.notes.some((n) => /network requests were removed/.test(n))).toBe(true);

    // Never cut: steps, runtime errors, failed requests, vitals, overview and screenshot metadata.
    const clicks = json.steps.filter((s) => s.type === 'click' && s.selector === '#act');
    expect(clicks).toHaveLength(3);
    const errors = json.runtimeErrors.filter((e) => /heavy error \d/.test(JSON.stringify(e)));
    expect(errors).toHaveLength(5);
    const failed = json.network.filter((e) => /\/status\/500\?fail=\d+$/.test(e.url));
    expect(failed).toHaveLength(20);
    expect(failed.every((e) => e.status === 500)).toBe(true);
    expect(json.overview.runtimeErrors).toBeGreaterThanOrEqual(5);
    expect(json.overview.failedRequests).toBeGreaterThanOrEqual(20);
    expect(json.overview.steps).toBeGreaterThanOrEqual(3);
    expect(json.vitals).toBeTruthy();
    expect(json.screenshots).toHaveLength(1);
    expect(json.screenshots[0].file).toBe('screenshot.jpg');
    expect(files['screenshot.jpg'].length).toBeGreaterThan(0);
  });
});

test('dom-10k: dom.structure ≤ 300 000, truncated.html true + note (AC-5.2)', async () => {
  await withTab(async (page) => {
    await page.goto(`${server.url}/dom-10k.html`);
    await startRecording(page);
    expect(await page.evaluate(() => globalThis.__elements)).toBeGreaterThanOrEqual(10_000);
    const { json } = await saveRecording(page);
    expect(json.limits.html).toBe(STRUCTURE_CHARS);
    expect(typeof json.dom.structure).toBe('string');
    expect(json.dom.structure.length).toBeGreaterThan(100_000);
    expect(json.dom.structure.length).toBeLessThanOrEqual(STRUCTURE_CHARS);
    expect(json.truncated.html).toBe(true);
    expect(json.notes.some((n) => n.startsWith('dom.structure was cut'))).toBe(true);
    expect(json.dom.fullHtml).toBeNull();
    // Structure without texts (AC-5.2): the row labels are not there, the ids are.
    expect(json.dom.structure).toContain('id="row-0"');
    expect(json.dom.structure).not.toContain('Wiersz 0');
  });
});

// The popup target cannot be resized over CDP (screenshot.spec.js), so popup.html is opened as a tab at the maximum
// popup size and the recording section is shown by hand: only the layout of the real file is under test.
test('popup 360×600: Nagrywaj and Zapisz paczkę fully visible with the checkbox (AC-1.4)', async () => {
  await withTab(async (page) => {
    await page.setViewportSize({ width: 360, height: 600 });
    await page.goto(`chrome-extension://${ext.extensionId}/popup/popup.html`);
    const layout = await page.evaluate(() => {
      const w = globalThis;
      const doc = w.document;
      const box = (id) => {
        const r = doc.getElementById(id).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
      };
      const show = (section) => {
        doc.getElementById('ready').hidden = section !== 'ready';
        doc.getElementById('recording').hidden = section !== 'recording';
        doc.getElementById('since').textContent = 'Nagrywam od 12:34:56';
        w.scrollTo(0, 0);
      };
      show('ready');
      const ready = { record: box('record'), scrollHeight: doc.documentElement.scrollHeight, scrollY: w.scrollY };
      show('recording');
      const recording = {
        toggle: box('includeScreenshot'),
        label: doc.getElementById('includeScreenshot').closest('label').getBoundingClientRect().toJSON(),
        save: box('save'),
        scrollY: w.scrollY,
        checked: doc.getElementById('includeScreenshot').checked,
      };
      return { innerWidth: w.innerWidth, innerHeight: w.innerHeight, scrollWidth: doc.documentElement.scrollWidth, ready, recording };
    });
    const info = JSON.stringify(layout);
    const inside = (b) => b.width > 0 && b.height > 0 && b.top >= 0 && b.left >= 0 && b.bottom <= layout.innerHeight && b.right <= layout.innerWidth;
    expect(layout.innerWidth).toBe(360);
    expect(layout.innerHeight).toBe(600);
    expect(layout.scrollWidth, info).toBeLessThanOrEqual(360);
    expect(inside(layout.ready.record), info).toBe(true);
    expect(inside(layout.recording.toggle), info).toBe(true);
    expect(inside(layout.recording.label), info).toBe(true);
    expect(inside(layout.recording.save), info).toBe(true);
    expect(layout.recording.label.bottom, info).toBeLessThanOrEqual(layout.recording.save.top); // the toggle is above "Zapisz paczkę"
    expect(layout.recording.checked).toBe(true); // on by default (spec question 1)
  });
});

async function filesOf(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesOf(path)));
    else out.push(path);
  }
  return out;
}

test('dist/chrome and dist/firefox: no file > 500 KB (NFR)', async () => {
  for (const target of ['chrome', 'firefox']) {
    const files = await filesOf(resolve(ROOT, 'dist', target));
    expect(files.length, target).toBeGreaterThan(0);
    const big = [];
    let largest = { path: '', size: 0 };
    for (const path of files) {
      const { size } = await stat(path);
      if (size > largest.size) largest = { path, size };
      if (size > DIST_FILE_BYTES) big.push(`${path}: ${size} B`);
    }
    console.log(`[E3-TEST5] dist/${target}: ${files.length} files, largest ${largest.path.slice(ROOT.length + 1)} ${largest.size} B`);
    expect(big, target).toEqual([]);
  }
});

async function gitShow(path) {
  const { stdout } = await run('git', ['show', `${BASELINE_TAG}:${path}`], { cwd: ROOT, timeout: 30_000 });
  return JSON.parse(stdout);
}

test('manifests equal 0.4.0 except version (NFR uprawnienia)', async () => {
  const base = await gitShow('src/manifest.base.json');
  for (const target of ['chrome', 'firefox']) {
    const baseline = mergeManifest(base, await gitShow(`src/manifest.${target}.json`));
    const built = JSON.parse(await readFile(resolve(ROOT, 'dist', target, 'manifest.json'), 'utf8'));
    const { version: builtVersion, ...builtRest } = built;
    const { version: baselineVersion, ...baselineRest } = baseline;
    expect(typeof builtVersion).toBe('string');
    expect(typeof baselineVersion).toBe('string');
    expect(builtRest, target).toEqual(baselineRest);
    expect(built.permissions, target).toEqual(['activeTab', 'scripting', 'storage', 'downloads']);
    expect(built.host_permissions, target).toBeUndefined();
  }
});
