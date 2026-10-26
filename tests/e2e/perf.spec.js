// E1-T19e: buffer limits under flood (AC-4.8, NFR "Pamięć/paczka") and hook overhead (NFR "Wydajność
// hooków") on tests/fixtures/pages/flood.html, recorded through the real popup.
// Overhead: the same fixture in an unrecorded tab (opened before Nagrywaj, so the recorder is not in it)
// vs the recorded tab, same origin and server. Spec limits are p95 ≤ 2 ms per fetch and ≤ 0.5 ms per
// console call; the asserted thresholds keep a margin so a busy CI machine does not make the test flaky.
// Measured values go to test-results/hooks-overhead.json for the QA report.
// E3-TEST5 (end of file): save time ≤ 5 s on basic.html and flood (AC-1.5).
import { test, expect } from '@playwright/test';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OVERHEAD_FILE = resolve(ROOT, 'test-results/hooks-overhead.json');

const SPEC = { fetchP95Ms: 2, consoleP95Ms: 0.5 };
// Asserted with margin (see header): fetch median and console p95 overhead.
const ASSERT = { fetchMedianMs: 5, consoleP95Ms: 1 };

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

async function recordedFloodPage() {
  const page = await ext.context.newPage();
  await page.goto(`${server.url}/flood.html`);
  await startRecording(page);
  return page;
}

const indexOf = (entry) => Number(/^flood (\d+)/.exec(entry?.args?.[0] ?? '')?.[1]);

test('flood: 6000 console.log keep the newest 5000, truncated.consoleLogs true (AC-4.8)', async () => {
  const page = await recordedFloodPage();
  try {
    await page.evaluate(() => globalThis.floodConsole(6000));
    const { json } = await saveRecording(page);

    expect(json.limits.consoleLogs).toBe(5000);
    const floods = json.consoleLogs.filter((e) => Number.isInteger(indexOf(e)));
    expect(json.consoleLogs.length).toBe(5000);
    expect(floods.length).toBe(5000);
    expect(json.truncated.consoleLogs).toBe(true);
    expect(indexOf(floods[0])).toBe(1000);
    expect(indexOf(floods.at(-1))).toBe(5999);
    expect(json.truncated.network).toBe(false);
  } finally {
    await page.close();
  }
});

test('flood: big log is capped to {truncated, preview}; 200 fetches all kept, truncated.network false', async () => {
  const page = await recordedFloodPage();
  try {
    const bigChars = await page.evaluate(() => globalThis.bigLog());
    expect(bigChars).toBeGreaterThan(40000); // above limits.entryChars (40 000 since E2)
    expect(await page.evaluate(() => globalThis.floodFetch(200))).toBe(200);
    const { json } = await saveRecording(page);

    const big = json.consoleLogs.find((e) => e.args?.truncated === true);
    expect(big, 'capped big-log entry').toBeTruthy();
    expect(typeof big.args.preview).toBe('string');
    expect(big.args.preview.length).toBeLessThanOrEqual(json.limits.entryChars);
    expect(big.args.preview).toContain('big-log');

    const floods = json.network.filter((e) => /\/api\/fail\?flood=\d+$/.test(e.url));
    expect(floods.length).toBe(200);
    expect(json.network.length).toBe(200);
    expect(json.truncated.network).toBe(false);
    expect(json.truncated.consoleLogs).toBe(false);
  } finally {
    await page.close();
  }
});

test('flood: 20 000 × 1 KB logs → package ≤ 10 MB, consoleLogs capped, page answers within 2 s (NFR)', async () => {
  test.setTimeout(60_000);
  const page = await recordedFloodPage();
  try {
    await page.evaluate(() => globalThis.floodConsole(20000, 1000));
    const t0 = Date.now();
    expect(await page.evaluate(() => globalThis.ping())).toBe('pong');
    expect(Date.now() - t0).toBeLessThan(2000);

    const { json, path } = await saveRecording(page, { timeout: 20_000 });
    const { size } = await stat(path);
    console.log(`[T19e] flood 20000x1KB: package ${(size / 1e6).toFixed(2)} MB, consoleLogs ${json.consoleLogs.length}`);
    expect(size).toBeLessThanOrEqual(10 * 1024 * 1024);
    expect(json.truncated.consoleLogs).toBe(true);
    expect(json.consoleLogs.length).toBeGreaterThan(0);
    expect(json.consoleLogs.length).toBeLessThanOrEqual(json.limits.consoleLogs);
    expect(indexOf(json.consoleLogs.at(-1))).toBe(19999);
  } finally {
    await page.close();
  }
});

test('perf: hook overhead, unrecorded vs recorded tab — fetch (median, p95) and console.log (p95) (NFR)', async () => {
  test.setTimeout(60_000);
  // Unrecorded: the same page and origin in a tab loaded before recording starts, so no recorder in it
  // and the same host and connection pool as the recorded tab (localhost would add name resolution).
  const plain = await ext.context.newPage();
  await plain.goto(`${server.url}/flood.html`);
  const installed = (page) => page.evaluate(() => Object.hasOwn(globalThis, Symbol.for('pds.installed')));
  const recorded = await recordedFloodPage();
  try {
    // The recorded tab really records, the plain one does not (otherwise the comparison is void).
    expect(await installed(plain)).toBe(false);
    expect(await installed(recorded)).toBe(true);

    // Each side measured as the foreground tab, so background-tab priority does not skew it.
    const run = async (page) => {
      await page.bringToFront();
      return {
        fetch: await page.evaluate(() => globalThis.timedFetch(200)),
        console: await page.evaluate(() => globalThis.timedConsole(1000)),
      };
    };
    // Interleaved twice to spread machine noise over both sides; the better run of each side counts.
    const a1 = await run(plain);
    const b1 = await run(recorded);
    const a2 = await run(plain);
    const b2 = await run(recorded);
    const best = (x, y, kind, key) => Math.min(x[kind][key], y[kind][key]);
    const without = {
      fetch: { median: best(a1, a2, 'fetch', 'median'), p95: best(a1, a2, 'fetch', 'p95') },
      console: { median: best(a1, a2, 'console', 'median'), p95: best(a1, a2, 'console', 'p95') },
    };
    const withRec = {
      fetch: { median: best(b1, b2, 'fetch', 'median'), p95: best(b1, b2, 'fetch', 'p95') },
      console: { median: best(b1, b2, 'console', 'median'), p95: best(b1, b2, 'console', 'p95') },
    };
    const overhead = {
      fetchMedianMs: withRec.fetch.median - without.fetch.median,
      fetchP95Ms: withRec.fetch.p95 - without.fetch.p95,
      consoleMedianMs: withRec.console.median - without.console.median,
      consoleP95Ms: withRec.console.p95 - without.console.p95,
    };
    const report = {
      measuredAt: new Date().toISOString(),
      samples: { fetch: 200, console: 1000, consoleBatch: 10, runsPerSide: 2 },
      spec: SPEC,
      asserted: ASSERT,
      without,
      with: withRec,
      overhead,
      runs: { without: [a1, a2], with: [b1, b2] },
    };
    await mkdir(dirname(OVERHEAD_FILE), { recursive: true });
    await writeFile(OVERHEAD_FILE, JSON.stringify(report, null, 2));
    console.log(`[T19e] hooks overhead: ${JSON.stringify({ without, with: withRec, overhead })}`);

    expect(await installed(plain)).toBe(false);
    const { json } = await saveRecording(recorded);
    expect(json.network.filter((e) => /\/api\/fail\?timed=/.test(e.url)).length).toBe(420);

    expect(overhead.fetchMedianMs).toBeLessThan(ASSERT.fetchMedianMs);
    expect(overhead.consoleP95Ms).toBeLessThan(ASSERT.consoleP95Ms);
  } finally {
    await plain.close();
    await recorded.close();
  }
});

// E3-TEST5 (AC-1.5): "Zapisz paczkę" → "Zapisano plik …" ≤ 5 s, median of 5, with redaction, budget and zip in the
// background. savedAfterMs is measured by saveRecording (click → status text, popup polled every 50 ms).
// Times go to test-results/e3-save-times.json for the QA report.
const SAVE_BUDGET_MS = 5000;
const SAVE_TIMES_FILE = resolve(ROOT, 'test-results/e3-save-times.json');
const saveTimes = {};

async function medianSaveTime(name, fixture, act) {
  const times = [];
  const sizes = [];
  for (let i = 0; i < 5; i++) {
    const page = await ext.context.newPage();
    try {
      await page.goto(`${server.url}/${fixture}`);
      await startRecording(page);
      await act?.(page);
      const { savedAfterMs, path } = await saveRecording(page);
      times.push(savedAfterMs);
      sizes.push((await stat(path)).size);
    } finally {
      await page.close();
    }
  }
  const median = [...times].sort((a, b) => a - b)[2];
  saveTimes[name] = { times, median, zipBytes: sizes };
  await mkdir(dirname(SAVE_TIMES_FILE), { recursive: true });
  await writeFile(SAVE_TIMES_FILE, JSON.stringify({ measuredAt: new Date().toISOString(), budgetMs: SAVE_BUDGET_MS, saveTimes }, null, 2));
  console.log(`[E3-TEST5] save ${name}: ms ${JSON.stringify(times)} median ${median}, zip B ${JSON.stringify(sizes)}`);
  return median;
}

test('save → Zapisano ≤ 5 s median of 5 on basic.html (AC-1.5)', async () => {
  test.setTimeout(120_000);
  expect(await medianSaveTime('basic', 'basic.html')).toBeLessThanOrEqual(SAVE_BUDGET_MS);
});

test('save → Zapisano ≤ 5 s median of 5 on flood (5000 logs) (AC-1.5)', async () => {
  test.setTimeout(180_000);
  const act = async (page) => expect(await page.evaluate(() => globalThis.floodConsole(5000))).toBe(5000);
  expect(await medianSaveTime('flood 5000 logs', 'flood.html', act)).toBeLessThanOrEqual(SAVE_BUDGET_MS);
});
