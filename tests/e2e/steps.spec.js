// E2-TEST4: user steps end to end with trusted input from Playwright (AC-3.1, 3.3, 3.4, 3.6, 3.7). Fixtures: steps.html,
// steps-2.html. The package of every test goes through assertValidSnapshot.
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValidSnapshot } from '../helpers/snapshot-validator.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OVERHEAD_FILE = resolve(ROOT, 'test-results/steps-overhead.json');

const EMAIL = 'jan@example.com';
const PASSWORD = 'Sekret123!';
const NOTE = 'Notatka prywatna 42';
const NAME = 'Jan Kowalski Test1'; // 18 characters
const STEP_TYPES = ['click', 'input', 'change', 'submit', 'navigate', 'key'];

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

// The reporter's session on steps.html, with trusted mouse and keyboard events; ends on steps-2.html.
async function recordSession(page) {
  await page.goto(`${server.url}/steps.html`);
  await startRecording(page);
  await page.click('#btn');
  await page.click('#email');
  await page.keyboard.type(EMAIL);
  await page.click('#chk');
  await page.click('#push');
  await page.click('#pass');
  await page.keyboard.type(PASSWORD);
  await page.click('#rich');
  await page.keyboard.type(NOTE);
  await page.click('#name');
  await page.keyboard.type(NAME);
  await page.click('#go');
  expect(await page.evaluate(() => globalThis.__submitted)).toBe(true);
  await Promise.all([page.waitForURL(/steps-2\.html$/), page.click('#next')]);
  await page.click('#second');
  const saved = await saveRecording(page);
  assertValidSnapshot(saved.json);
  return saved;
}

async function withSession(fn) {
  const page = await ext.context.newPage();
  try {
    return await fn(await recordSession(page), page);
  } finally {
    await page.close();
  }
}

// Index of the first step after `from` that matches; fails with the whole list when there is none.
function findStep(steps, from, match, what) {
  const index = steps.findIndex((step, i) => i >= from && match(step));
  expect(index, `${what} after step #${from}: ${JSON.stringify(steps)}`).toBeGreaterThanOrEqual(from);
  return index;
}

test('steps in order: click, input, change, submit, navigate(pushState), navigate(full page), each with t, doc, type and selector (AC-3.1)', async () => {
  await withSession(async ({ json }) => {
    const { steps } = json;
    for (const step of steps) {
      expect(typeof step.t, JSON.stringify(step)).toBe('number');
      expect(Number.isInteger(step.doc)).toBe(true);
      expect(STEP_TYPES).toContain(step.type);
      if (step.type !== 'navigate') expect(typeof step.selector, JSON.stringify(step)).toBe('string');
    }
    let at = 0;
    at = findStep(steps, at, (s) => s.type === 'navigate' && s.doc === 0 && s.via === 'reload', 'navigate reload') + 1;
    at = findStep(steps, at, (s) => s.type === 'click' && s.selector === '#btn' && s.text === 'Zapisz szkic', 'click #btn') + 1;
    at = findStep(steps, at, (s) => s.type === 'input' && s.selector === '#email' && s.inputType === 'email', 'input #email') + 1;
    at = findStep(steps, at, (s) => s.type === 'change' && s.selector === '#chk' && s.checked === true, 'change #chk') + 1;
    at = findStep(steps, at, (s) => s.type === 'click' && s.selector === '#push', 'click #push') + 1;
    at = findStep(steps, at, (s) => s.type === 'navigate' && s.via === 'pushState' && String(s.url).endsWith('?step=1'), 'navigate pushState') + 1;
    at = findStep(steps, at, (s) => s.type === 'input' && s.selector === '#pass' && s.inputType === 'password', 'input #pass') + 1;
    at = findStep(steps, at, (s) => s.type === 'input' && s.selector === '#rich' && s.inputType === 'contenteditable', 'input #rich') + 1;
    at = findStep(steps, at, (s) => s.type === 'input' && s.selector === '#name', 'input #name') + 1;
    at = findStep(steps, at, (s) => s.type === 'submit' && s.selector === '#f', 'submit #f') + 1;
    at = findStep(steps, at, (s) => s.type === 'click' && s.selector === '#next', 'click #next') + 1;
    at = findStep(steps, at, (s) => s.type === 'navigate' && s.doc === 1 && String(s.url).endsWith('/steps-2.html'), 'navigate to steps-2') + 1;
    findStep(steps, at, (s) => s.type === 'click' && s.doc === 1 && s.selector === '#second', 'click #second');
    // t grows within one document.
    for (const doc of [0, 1]) {
      const times = steps.filter((s) => s.doc === doc).map((s) => s.t);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
    expect(json.overview.steps).toBe(steps.length);
  });
});

test('18 typed characters → one input step with valueLength 18 (AC-3.3)', async () => {
  await withSession(async ({ json }) => {
    const name = json.steps.filter((s) => s.selector === '#name' && s.type === 'input');
    expect(name).toHaveLength(1);
    expect(name[0].valueLength).toBe(18);
    expect(NAME).toHaveLength(18);
    const email = json.steps.filter((s) => s.selector === '#email' && s.type === 'input');
    expect(email).toHaveLength(1);
    expect(email[0].valueLength).toBe(EMAIL.length);
    // A password step carries no length at all.
    const pass = json.steps.filter((s) => s.selector === '#pass' && s.type === 'input');
    expect(pass).toHaveLength(1);
    expect(pass[0]).not.toHaveProperty('valueLength');
  });
});

test('jan@example.com, Sekret123!, contenteditable text: no hits outside dom; the password nowhere (AC-3.4)', async () => {
  await withSession(async ({ json }) => {
    // The values really were typed (the steps know their lengths), otherwise the grep proves nothing.
    expect(json.steps.some((s) => s.selector === '#email' && s.valueLength === EMAIL.length)).toBe(true);
    expect(json.steps.some((s) => s.selector === '#rich' && s.valueLength === NOTE.length)).toBe(true);
    const { dom, ...rest } = json;
    const outsideDom = JSON.stringify(rest);
    for (const secret of [EMAIL, PASSWORD, NOTE, NAME]) expect(outsideDom, `"${secret}" outside dom`).not.toContain(secret);
    expect(JSON.stringify(json)).not.toContain(PASSWORD);
    expect(JSON.stringify(dom)).not.toContain(PASSWORD);
  });
});

test('steps of the first document are present after navigation: doc 0 and doc 1 (AC-3.6)', async () => {
  await withSession(async ({ json }) => {
    expect(json.documents.map((d) => d.id)).toEqual([0, 1]);
    expect(json.documents[0]).toMatchObject({ flushed: true, recorded: true });
    const doc0 = json.steps.filter((s) => s.doc === 0);
    const doc1 = json.steps.filter((s) => s.doc === 1);
    expect(doc0.length).toBeGreaterThanOrEqual(9);
    expect(doc1.length).toBeGreaterThanOrEqual(2); // navigate + click
    expect(json.documents[0].counts.steps).toBe(doc0.length);
    expect(json.documents[1].counts.steps).toBe(doc1.length);
    expect(json.truncated.steps).toBe(false);
    expect(json.notes.join('\n')).not.toContain('was not received');
  });
});

const percentile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
};

async function clickAt(page, selector, times) {
  const box = await page.locator(selector).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (let i = 0; i < times; i++) await page.mouse.click(x, y);
}

test('page sees the same defaultPrevented and propagation with and without recording; 1000 clicks p95 overhead ≤ 0.5 ms (AC-3.7)', async () => {
  test.setTimeout(120_000);
  // The unrecorded tab is loaded first, so the recorder is not in it (same origin, same server).
  const plain = await ext.context.newPage();
  const recorded = await ext.context.newPage();
  try {
    await plain.goto(`${server.url}/steps.html`);
    await recorded.goto(`${server.url}/steps.html`);
    await startRecording(recorded);

    // Page-observable outcome of the same real clicks.
    const observed = {};
    for (const [name, page] of [['plain', plain], ['recorded', recorded]]) {
      await page.bringToFront();
      await page.click('#blocked');
      await page.click('#stopper');
      await page.click('#btn');
      observed[name] = {
        seen: await page.evaluate(() => globalThis.__seen),
        seenCapture: await page.evaluate(() => globalThis.__seenCapture),
        url: await page.evaluate(() => globalThis.location.pathname),
      };
    }
    expect(observed.recorded).toEqual(observed.plain);
    expect(observed.plain.seen).toEqual([
      { id: 'blocked', defaultPrevented: true },
      { id: 'btn', defaultPrevented: false },
    ]); // #stopper never reached document
    expect(observed.plain.seenCapture.map((e) => e.id)).toEqual(['blocked', 'stopper', 'btn']);
    expect(observed.plain.url).toBe('/steps.html'); // the prevented link did not navigate

    // Latency of 1000 real clicks per side, two interleaved rounds (machine noise spreads over both sides).
    const latency = { plain: [], recorded: [] };
    for (let round = 0; round < 2; round++) {
      for (const [name, page] of [['plain', plain], ['recorded', recorded]]) {
        await page.bringToFront();
        await page.evaluate(() => { globalThis.__latency.length = 0; });
        await clickAt(page, '#btn', 500);
        latency[name].push(...(await page.evaluate(() => globalThis.__latency)));
      }
    }
    expect(latency.plain).toHaveLength(1000);
    expect(latency.recorded).toHaveLength(1000);
    const stats = (values) => ({ median: percentile(values, 0.5), p95: percentile(values, 0.95) });
    const report = {
      measuredAt: new Date().toISOString(),
      spec: { p95Ms: 0.5 },
      plain: stats(latency.plain),
      recorded: stats(latency.recorded),
      overhead: { medianMs: stats(latency.recorded).median - stats(latency.plain).median, p95Ms: stats(latency.recorded).p95 - stats(latency.plain).p95 },
    };
    await mkdir(dirname(OVERHEAD_FILE), { recursive: true });
    await writeFile(OVERHEAD_FILE, JSON.stringify(report, null, 2));
    console.log(`[E2-TEST4] click latency: ${JSON.stringify(report)}`);

    const { json } = await saveRecording(recorded);
    assertValidSnapshot(json);
    expect(json.steps.filter((s) => s.type === 'click' && s.selector === '#btn').length).toBe(1001); // 1000 + the observed one
    expect(report.overhead.p95Ms).toBeLessThanOrEqual(0.5);
  } finally {
    await plain.close();
    await recorded.close();
  }
});
