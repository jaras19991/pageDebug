// E2-TEST6: performance and size of E2 (NFR). Complements perf.spec.js of E1 (buffer limits, console and fetch overhead).
// Measured values go to test-results/perf-e2.json for the QA report. Run alone for meaningful numbers
// (PDS_E2E_NO_BUILD=1, no parallel e2e run): the timing assertions compare two tabs of the same browser.
import { test, expect } from '@playwright/test';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValidSnapshot } from '../helpers/snapshot-validator.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPORT_FILE = resolve(ROOT, 'test-results/perf-e2.json');

const SPEC = {
  fetchP95Ms: 2, // NFR: 200 × 500-JSON responses, p95 overhead of the fetch hook
  lcpDiffMs: 50, // NFR: LCP with vs without recording (median of 5)
  basicPackageBytes: 1024 * 1024,
  floodPackageBytes: 12 * 1024 * 1024,
  saveMs: 5000,
  distBytes: 500 * 1024,
};

let server;
let ext;
const report = {};

test.beforeAll(async () => {
  server = await startFixtureServer({ port: 0 });
  ext = await launchWithExtension();
});

test.afterAll(async () => {
  await ext?.close();
  await server?.close();
  await mkdir(dirname(REPORT_FILE), { recursive: true });
  let previous = {};
  try {
    previous = JSON.parse(await readFile(REPORT_FILE, 'utf8'));
  } catch {
    // first run
  }
  await writeFile(REPORT_FILE, JSON.stringify({ ...previous, measuredAt: new Date().toISOString(), spec: SPEC, ...report }, null, 2));
});

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test('fetch hook overhead with 200 × 500-JSON responses: p95 ≤ 2 ms (NFR)', async () => {
  test.setTimeout(90_000);
  // Unrecorded: the same page in a tab loaded before recording starts, so the recorder is not in it.
  const plain = await ext.context.newPage();
  await plain.goto(`${server.url}/flood-e2.html`);
  const recorded = await ext.context.newPage();
  try {
    await recorded.goto(`${server.url}/flood-e2.html`);
    await startRecording(recorded);
    const installed = (page) => page.evaluate(() => Object.hasOwn(globalThis, Symbol.for('pds.installed')));
    expect(await installed(plain)).toBe(false);
    expect(await installed(recorded)).toBe(true);

    const run = async (page) => {
      await page.bringToFront();
      return page.evaluate(() => globalThis.timedErrorFetch(200));
    };
    // Interleaved twice; the better run of each side counts (spreads machine noise over both sides, as in perf.spec.js).
    const a1 = await run(plain);
    const b1 = await run(recorded);
    const a2 = await run(plain);
    const b2 = await run(recorded);
    const best = (x, y, part, key) => Math.min(x[part][key], y[part][key]);
    const overhead = {
      responseP95Ms: best(b1, b2, 'response', 'p95') - best(a1, a2, 'response', 'p95'),
      responseMedianMs: best(b1, b2, 'response', 'median') - best(a1, a2, 'response', 'median'),
      totalP95Ms: best(b1, b2, 'total', 'p95') - best(a1, a2, 'total', 'p95'),
    };
    report.fetchOverhead = { overhead, runs: { without: [a1, a2], with: [b1, b2] } };
    console.log(`[E2-TEST6] fetch overhead (500 JSON): ${JSON.stringify(overhead)}`);

    const { json } = await saveRecording(recorded);
    assertValidSnapshot(json);
    const timed = json.network.filter((e) => /status\/500\?body=json&timed=/.test(e.url));
    expect(timed.length).toBe(420);
    expect(timed.every((e) => e.status === 500 && typeof e.responseBodyPreview === 'string')).toBe(true);
    // Time to the response headers is what the hook can delay synchronously; the whole read includes the clone read.
    expect(overhead.responseP95Ms).toBeLessThanOrEqual(SPEC.fetchP95Ms);
    expect(overhead.totalP95Ms).toBeLessThanOrEqual(SPEC.fetchP95Ms);
  } finally {
    await plain.close();
    await recorded.close();
  }
});

// LCP as the page sees it (its own observer), loaded N times without the extension and N times with the recorder.
const readLcp = (page) =>
  page.evaluate(
    () =>
      new Promise((resolveLcp) => {
        let last = null;
        new PerformanceObserver((list) => {
          last = list.getEntries().at(-1).startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => resolveLcp(last), 400);
      }),
  );

test('slow-lcp: LCP with vs without recording differs ≤ 50 ms (median of 5) (NFR)', async () => {
  test.setTimeout(90_000);
  const without = [];
  const withRecording = [];
  const page = await ext.context.newPage();
  try {
    // First without the extension in the page (recording not started: no content scripts are registered yet).
    for (let i = 0; i < 5; i++) {
      await page.goto(`${server.url}/slow-lcp.html`);
      without.push(await readLcp(page));
    }
    await startRecording(page);
    withRecording.push(await readLcp(page));
    for (let i = 1; i < 5; i++) {
      await page.reload();
      withRecording.push(await readLcp(page));
    }
    const { json } = await saveRecording(page);
    assertValidSnapshot(json);
    expect(json.vitals.length).toBeGreaterThanOrEqual(5);
    const diff = Math.abs(median(withRecording) - median(without));
    report.lcp = { without, withRecording, medianDiffMs: diff };
    console.log(`[E2-TEST6] LCP without ${JSON.stringify(without)} with ${JSON.stringify(withRecording)} median diff ${diff.toFixed(1)} ms`);
    expect(without.every((v) => v >= 1500)).toBe(true);
    expect(diff).toBeLessThanOrEqual(SPEC.lcpDiffMs);
  } finally {
    await page.close();
  }
});

test('basic.html + screenshot: package ≤ 1 MB (NFR size)', async () => {
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);
    const { json, path } = await saveRecording(page);
    assertValidSnapshot(json);
    expect(json.screenshots).toHaveLength(1);
    const { size } = await stat(path);
    report.basicPackage = { bytes: size, screenshotBytes: json.screenshots[0].bytes };
    console.log(`[E2-TEST6] basic.html + screenshot: ${size} bytes (screenshot ${json.screenshots[0].bytes})`);
    expect(size).toBeLessThanOrEqual(SPEC.basicPackageBytes);
  } finally {
    await page.close();
  }
});

test('flood + 2000 steps + 100 error responses: package ≤ 12 MB, save ≤ 5 s, truncated.responseBodies true (NFR)', async () => {
  test.setTimeout(180_000);
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/flood-e2.html`);
    await startRecording(page);
    expect(await page.evaluate(() => globalThis.floodErrors(100, 5000))).toBe(100);
    await page.evaluate(() => globalThis.floodConsole(10000, 1000));
    const box = await page.locator('#target').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    for (let i = 0; i < 2000; i++) await page.mouse.click(x, y);
    expect(await page.evaluate(() => globalThis.ping())).toBe('pong');

    const { json, path, savedAfterMs } = await saveRecording(page, { timeout: 30_000 });
    assertValidSnapshot(json);
    const { size } = await stat(path);
    report.flood = { bytes: size, savedAfterMs, steps: json.steps.length, truncated: json.truncated, screenshots: json.screenshots.length };
    console.log(`[E2-TEST6] flood: ${(size / 1e6).toFixed(2)} MB, save ${savedAfterMs} ms, steps ${json.steps.length}, truncated ${JSON.stringify(json.truncated)}`);

    expect(size).toBeLessThanOrEqual(SPEC.floodPackageBytes);
    expect(savedAfterMs).toBeLessThanOrEqual(SPEC.saveMs);
    expect(json.steps.length).toBeLessThanOrEqual(json.limits.steps);
    expect(json.steps.filter((s) => s.type === 'click').length).toBeGreaterThanOrEqual(1990);
    expect(json.network.filter((e) => /status\/500\?body=json&size=5000/.test(e.url)).length).toBe(100);
    // 100 bodies of 4096 characters exceed the 262 144 budget: older previews are dropped and the package says so.
    expect(json.truncated.responseBodies).toBe(true);
    const withPreview = json.network.filter((e) => 'responseBodyPreview' in e);
    expect(withPreview.length).toBeLessThan(100);
    expect(withPreview.reduce((sum, e) => sum + e.responseBodyPreview.length, 0)).toBeLessThanOrEqual(json.limits.responseBodyTotalChars);
    expect(json.screenshots).toHaveLength(1);
  } finally {
    await page.close();
  }
});

// docs/snapshot-schema.md (v3, `network[]` and `notes`): previews dropped for the budget → truncated.responseBodies true "i jest notatka".
test('100 big error responses: dropped previews are explained by a note next to truncated.responseBodies (schema v3)', async () => {
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/flood-e2.html`);
    await startRecording(page);
    expect(await page.evaluate(() => globalThis.floodErrors(100, 5000))).toBe(100);
    const { json } = await saveRecording(page);
    assertValidSnapshot(json);
    expect(json.truncated.responseBodies).toBe(true);
    expect(json.notes.some((n) => /response preview/i.test(n)), JSON.stringify(json.notes)).toBe(true);
  } finally {
    await page.close();
  }
});

async function directorySize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? await directorySize(path) : (await stat(path)).size;
  }
  return total;
}

test('dist/chrome and dist/firefox are < 500 KB each (NFR)', async () => {
  const sizes = {};
  for (const target of ['chrome', 'firefox']) sizes[target] = await directorySize(resolve(ROOT, 'dist', target));
  report.dist = sizes;
  console.log(`[E2-TEST6] dist sizes: ${JSON.stringify(sizes)}`);
  for (const [target, bytes] of Object.entries(sizes)) expect(bytes, target).toBeLessThan(SPEC.distBytes);
});
