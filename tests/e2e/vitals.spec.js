// E2-TEST2: Core Web Vitals with attribution and long tasks, end to end (AC-5.1, 5.2, 5.3, 5.7) and the web-vitals
// library as the oracle for LCP, CLS and INP (design D7, tolerance 10 %). Every package goes through
// assertValidSnapshot (AC-7.1). Fixtures: slow-lcp.html, cls.html, inp.html, longtask.html + heavy.js, oracle.html.
import { test, expect } from '@playwright/test';
import { assertValidSnapshot } from '../helpers/snapshot-validator.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';

const RATINGS = ['good', 'needs-improvement', 'poor'];
const ORACLE_TOLERANCE = 0.1;

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

// Opens `path`, records it from the reload, runs `act(page)` and saves; the tab is closed afterwards.
async function recordAndSave(path, act) {
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}${path}`);
    await startRecording(page);
    await act?.(page);
    const saved = await saveRecording(page);
    assertValidSnapshot(saved.json);
    return saved;
  } finally {
    await page.close();
  }
}

const vitalsOf = (json, doc = 0) => json.vitals.find((v) => v.doc === doc);

function expectMetric(metric) {
  expect(metric, 'metric').toBeTruthy();
  expect(metric.available).toBe(true);
  expect(typeof metric.value).toBe('number');
  expect(Number.isFinite(metric.value)).toBe(true);
  expect(RATINGS).toContain(metric.rating);
}

test('slow-lcp: TTFB/FCP/LCP/CLS with value and rating; LCP ≥ 1500, selector #hero, url of the image (AC-5.1, 5.2)', async () => {
  const { json } = await recordAndSave('/slow-lcp.html', (page) => page.waitForFunction(() => globalThis.document.getElementById('banner') !== null));
  const v = vitalsOf(json);
  expect(v, 'vitals of document 0').toBeTruthy();
  for (const name of ['TTFB', 'FCP', 'LCP', 'CLS']) expectMetric(v[name]);
  expect(v.LCP.value).toBeGreaterThanOrEqual(1500);
  expect(v.LCP.selector).toBe('#hero');
  expect(v.LCP.url).toContain('/img/hero.png');
  expect(v.FCP.value).toBeLessThan(v.LCP.value);
  // The package says that the values may still grow when the page was visible at save time (AC-5.6 context).
  expect(v.LCP.finalized).toBe(false);
});

test('cls: CLS > 0.1 with at least one source selector and value (AC-5.1, 5.2)', async () => {
  const { json } = await recordAndSave('/cls.html', (page) => page.evaluate(() => globalThis.__bannerShown));
  const { CLS } = vitalsOf(json);
  expectMetric(CLS);
  expect(CLS.value).toBeGreaterThan(0.1);
  expect(CLS.rating).not.toBe('good');
  expect(Array.isArray(CLS.sources)).toBe(true);
  expect(CLS.sources.length).toBeGreaterThanOrEqual(1);
  expect(CLS.sources.length).toBeLessThanOrEqual(5);
  for (const source of CLS.sources) {
    expect(typeof source.selector).toBe('string');
    expect(source.selector.length).toBeGreaterThan(0);
    expect(typeof source.value).toBe('number');
  }
  expect(CLS.sources.map((s) => s.selector)).toContain('#b1');
});

test('inp: INP ≥ 300 with target #slow, click and phases (AC-5.2)', async () => {
  const { json } = await recordAndSave('/inp.html', async (page) => {
    await page.click('#slow');
    await expect(page.locator('#result')).toHaveText('gotowe');
    // Event Timing entries are dispatched after the next paint.
    await page.waitForTimeout(600);
  });
  const { INP } = vitalsOf(json);
  expectMetric(INP);
  expect(INP.value).toBeGreaterThanOrEqual(300);
  expect(INP.selector).toBe('#slow');
  // The longest event of the interaction is reported: Chromium names pointerdown here (its presentation delay waits for the
  // click handler), the handler itself shows in longTasks[].scripts[].invoker.
  expect(['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup']).toContain(INP.eventType);
  for (const phase of ['inputDelay', 'processing', 'presentation']) {
    expect(typeof INP[phase], phase).toBe('number');
    expect(INP[phase]).toBeGreaterThanOrEqual(0);
  }
  // The three phases add up to the duration of the interaction (INP.value), up to rounding.
  expect(Math.abs(INP.inputDelay + INP.processing + INP.presentation - INP.value)).toBeLessThanOrEqual(2);
  expect(INP.interactions).toBeGreaterThanOrEqual(1);
});

test('longtask: entry with heavy.js url, duration ≥ 200, at most 20 items (AC-5.3)', async () => {
  const { json } = await recordAndSave('/longtask.html', async (page) => {
    await page.click('#work');
    await expect(page.locator('#result')).toHaveText('gotowe');
    await page.waitForTimeout(300);
  });
  const { longTasks } = vitalsOf(json);
  expect(longTasks.available).toBe(true);
  expect(longTasks.items.length).toBeGreaterThanOrEqual(1);
  expect(longTasks.items.length).toBeLessThanOrEqual(json.limits.longTasks);
  expect(json.limits.longTasks).toBe(20);
  const heavy = longTasks.items.filter((item) => item.duration >= 200 && item.scripts.some((s) => String(s.url).endsWith('/heavy.js')));
  expect(heavy.length, `long tasks: ${JSON.stringify(longTasks.items)}`).toBeGreaterThanOrEqual(1);
  for (const item of longTasks.items) {
    expect(typeof item.t).toBe('number');
    expect(typeof item.blockingDuration).toBe('number');
  }
});

test('reload during recording: vitals for both documents with their own t (AC-5.7)', async () => {
  const { json } = await recordAndSave('/slow-lcp.html', async (page) => {
    await page.reload();
    await page.waitForFunction(() => globalThis.document.getElementById('banner') !== null);
  });
  expect(json.documents.length).toBeGreaterThanOrEqual(2);
  const docs = json.vitals.map((v) => v.doc);
  expect(docs).toEqual([...docs].sort((a, b) => a - b));
  expect(docs).toEqual(expect.arrayContaining([0, 1]));
  expect(json.documents[1].timeOrigin).toBeGreaterThan(json.documents[0].timeOrigin);
  for (const doc of [0, 1]) {
    const v = vitalsOf(json, doc);
    expectMetric(v.TTFB);
    expectMetric(v.LCP);
    // t is relative to the own document: both loads hold the hero for 1500 ms, so neither t carries the other's time.
    expect(v.LCP.value).toBeGreaterThanOrEqual(1500);
    expect(v.LCP.t).toBeGreaterThanOrEqual(1500);
    expect(v.LCP.t).toBeLessThan(6000);
    expect(v.LCP.selector).toBe('#hero');
  }
  // The first document was handed over at pagehide (final), the current one is still alive.
  expect(vitalsOf(json, 0).LCP.finalized).toBe(true);
  expect(vitalsOf(json, 1).LCP.finalized).toBe(false);
});

test('vitals match the web-vitals oracle within 10 % (LCP, CLS, INP) (D7)', async () => {
  const { json, oracle } = await (async () => {
    let oracleValues;
    const saved = await recordAndSave('/oracle.html', async (page) => {
      await page.evaluate(() => globalThis.__bannerShown);
      await page.waitForFunction(() => globalThis.document.getElementById('hero').complete);
      await page.click('#slow');
      await expect(page.locator('#result')).toHaveText('gotowe');
      // web-vitals reports INP only after the next paint of the interaction.
      await page.waitForFunction(() => globalThis.__wv.INP !== undefined);
      await page.waitForTimeout(300);
      oracleValues = await page.evaluate(() => globalThis.__wv);
    });
    return { ...saved, oracle: oracleValues };
  })();
  const v = vitalsOf(json);
  const report = {};
  for (const name of ['LCP', 'CLS', 'INP']) {
    expect(typeof oracle[name], `oracle ${name}: ${JSON.stringify(oracle)}`).toBe('number');
    expectMetric(v[name]);
    const mine = v[name].value;
    const reference = oracle[name];
    report[name] = { extension: mine, oracle: reference };
    // CLS is a tiny number: also accept 0.005 absolute (rounding of the two implementations).
    const absolute = name === 'CLS' ? 0.005 : 0;
    const allowed = Math.max(ORACLE_TOLERANCE * Math.max(mine, reference), absolute);
    expect(Math.abs(mine - reference), `${name} ${JSON.stringify(report[name])}`).toBeLessThanOrEqual(allowed);
  }
  expect(oracle.LCP).toBeGreaterThanOrEqual(1200);
  expect(oracle.CLS).toBeGreaterThan(0);
  expect(oracle.INP).toBeGreaterThanOrEqual(300);
  console.log(`[E2-TEST2] oracle comparison: ${JSON.stringify(report)}`);
});
