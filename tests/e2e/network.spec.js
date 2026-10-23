// E2-TEST3: statuses, sizes and response bodies end to end (AC-4.1–4.7, 4.9). Server routes: tests/e2e/helpers/fixtures-server.js
// (/status, /seq, /stream, /echo). The package of every test goes through assertValidSnapshot (AC-4.3, 7.1).
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { assertValidSnapshot } from '../helpers/snapshot-validator.js';
import { FIXTURE_SECRETS, startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';

const TYPES = ['fetch', 'xhr', 'img', 'script', 'css', 'font', 'other'];
const unique = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

async function withTab(fn) {
  const page = await ext.context.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

// Saves and checks the package against the schema (a bare status 0 included, AC-4.3).
async function save(page) {
  const saved = await saveRecording(page);
  assertValidSnapshot(saved.json);
  return saved;
}

const entriesFor = (json, fragment) => json.network.filter((e) => e.url.includes(fragment));
const one = (json, fragment, type) => {
  const found = entriesFor(json, fragment).filter((e) => !type || e.type === type);
  expect(found.length, `${type ?? 'any'} entries for ${fragment}: ${JSON.stringify(json.network.map((e) => [e.type, e.url, e.status]))}`).toBe(1);
  return found[0];
};

async function recordNetworkPage(page) {
  await page.goto(`${server.url}/network.html`);
  await startRecording(page);
  await page.evaluate(() => globalThis.__done);
  // Resource Timing entries of the images appear a moment after their load/error events.
  await page.waitForTimeout(300);
}

test('every network entry has status, type and sizeBytes (number|null): img 404, script 404, css, font, fetch 500, xhr 401 (AC-4.1)', async () => {
  await withTab(async (page) => {
    await recordNetworkPage(page);
    const { json } = await save(page);

    for (const entry of json.network) {
      expect(TYPES, entry.url).toContain(entry.type);
      expect(entry, entry.url).toHaveProperty('status');
      expect(entry.status === null || Number.isInteger(entry.status), entry.url).toBe(true);
      expect(entry.sizeBytes === null || (Number.isInteger(entry.sizeBytes) && entry.sizeBytes >= 0), `${entry.url} sizeBytes`).toBe(true);
    }
    const expected = [
      ['/img/missing-e2.png', 'img', 404],
      ['/missing-e2.js', 'script', 404],
      ['/network-e2.css', 'css', 200],
      ['/fonts/pds-test.woff2', 'font', 200],
      ['/status/500?body=json', 'fetch', 500],
      ['/status/401?body=token', 'xhr', 401],
    ];
    for (const [fragment, type, status] of expected) {
      const entry = one(json, fragment, type);
      expect(entry.status, fragment).toBe(status);
      expect(entry.doc).toBe(0);
    }
    // Same-origin resources report their size; only the 200 css has bytes to count.
    expect(one(json, '/network-e2.css', 'css').sizeBytes).toBeGreaterThan(0);
    // Overview counts the requests answered with an error.
    expect(json.overview.failedRequests).toBeGreaterThanOrEqual(4);
  });
});

test('subpage returning 404 during recording: documents[] entry has status 404 (AC-4.2)', async () => {
  await withTab(async (page) => {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);
    await page.goto(`${server.url}/status/404?body=page`);
    const { json } = await save(page);

    expect(json.documents.length).toBe(2);
    expect(json.documents[0]).toMatchObject({ status: 200 });
    expect(json.documents[1].url).toContain('/status/404');
    expect(json.documents[1].status).toBe(404);
  });
});

test('cross-origin img: status null with statusUnavailable cross-origin, never a bare 0 (AC-4.3)', async () => {
  await withTab(async (page) => {
    await recordNetworkPage(page);
    const { json } = await save(page);

    const cross = json.network.filter((e) => e.url.startsWith(`http://localhost:${server.port}/`));
    expect(cross.length).toBe(1);
    expect(cross[0]).toMatchObject({ type: 'img', status: null, statusUnavailable: 'cross-origin' });
    expect(cross[0].sizeBytes).toBeNull();
    for (const entry of json.network) {
      if (entry.status === 0) expect(entry.error, `bare status 0 on ${entry.url}`).not.toBeNull();
      if (entry.status === null) expect(entry.statusUnavailable ?? entry.error, entry.url).toBeTruthy();
    }
  });
});

test('3 identical fetches: exactly 3 fetch entries with 200, 500, 404 and no duplicates (AC-4.4)', async () => {
  await withTab(async (page) => {
    const name = unique('seq');
    await page.goto(`${server.url}/network.html`);
    await startRecording(page);
    await page.evaluate(() => globalThis.__done);
    expect(await page.evaluate((n) => globalThis.runSeq(n), name)).toEqual([200, 500, 404]);
    const { json } = await save(page);

    const entries = entriesFor(json, `/seq/${name}`);
    expect(entries.map((e) => [e.type, e.status])).toEqual([['fetch', 200], ['fetch', 500], ['fetch', 404]]);
    expect(new Set(entries.map((e) => e.t)).size).toBe(3);
    expect(json.documents[0].current).toBe(true);
  });
});

test('preview only for 500 JSON; none for 200 JSON, 500 PNG, endless stream; page reads are intact (AC-4.5, 4.6)', async () => {
  await withTab(async (page) => {
    const pngBytes = (await (await fetch(`${server.url}/status/500?body=png`)).arrayBuffer()).byteLength;
    await page.goto(`${server.url}/responses.html`);
    await startRecording(page);
    const results = await page.evaluate(() => globalThis.runResponses());

    // The page sees what it would see without the extension (AC-4.6).
    expect(results.json500).toEqual({ status: 500, bodyUsedBefore: false, data: { error: 'status 500', status: 500 }, bodyUsedAfter: true });
    expect(results.json200).toEqual({ error: null, status: 200 });
    expect(results.png500).toEqual({ type: 'image/png', bytes: pngBytes });
    expect(results.xhrBlob).toEqual({ status: 500, size: pngBytes, type: 'image/png' });
    expect(results.xhrBuffer).toEqual({ status: 500, bytes: pngBytes });
    expect(results.xhrText.status).toBe(500);
    expect(JSON.parse(results.xhrText.text)).toEqual({ error: 'status 500', status: 500 });
    expect(results.stream.status).toBe(500);
    expect(results.stream.chunks).toBeGreaterThanOrEqual(10);

    const { json } = await save(page);

    const json500 = json.network.filter((e) => e.url.endsWith('/status/500?body=json'));
    expect(json500.map((e) => e.type).sort()).toEqual(['fetch', 'xhr']);
    for (const entry of json500) {
      expect(entry.status).toBe(500);
      expect(JSON.parse(entry.responseBodyPreview)).toEqual({ error: 'status 500', status: 500 });
      expect(entry.responseBodyTruncated).toBe(false);
    }
    const withoutPreview = [
      ...entriesFor(json, '/status/200?body=json'),
      ...entriesFor(json, '/status/500?body=png'),
      ...entriesFor(json, '/stream/500'),
    ];
    expect(entriesFor(json, '/stream/500').length).toBe(1);
    expect(entriesFor(json, '/status/500?body=png').length).toBe(3); // fetch + blob XHR + arraybuffer XHR
    for (const entry of withoutPreview) {
      expect(entry, entry.url).not.toHaveProperty('responseBodyPreview');
      expect(entry, entry.url).not.toHaveProperty('responseBodyTruncated');
    }
    expect(json.truncated.responseBodies).toBe(false);
  });
});

test('token values from a 401 body are absent from the package; [redacted:…] is there (AC-4.7)', async () => {
  await withTab(async (page) => {
    await recordNetworkPage(page);
    const { json, path } = await save(page);

    const raw = JSON.stringify(json);
    const { jwt, bearer } = FIXTURE_SECRETS;
    expect(raw).not.toContain(jwt);
    for (const part of jwt.split('.')) expect(raw, `JWT part ${part.slice(0, 12)}…`).not.toContain(part);
    expect(raw).not.toContain(bearer);
    const entry = one(json, '/status/401?body=token', 'xhr');
    expect(entry.status).toBe(401);
    expect(entry.responseBodyPreview).toMatch(/\[redacted:[^\]]+\]/);
    expect(entry.responseBodyPreview).toContain('expired'); // the harmless part of the body stays readable
    // The file on disk, not only the parsed object (JSON escaping must not hide a value).
    const disk = await readFile(path, 'utf8');
    expect(disk).not.toContain(jwt);
    expect(disk).not.toContain(bearer);
  });
});

test('request headers seen by the server are identical with and without recording (AC-4.9)', async () => {
  const lastHeaders = async (id) => (await fetch(`${server.url}/echo/last?id=${id}`)).json();
  const id = unique('echo');
  const plain = await ext.context.newPage();
  const recorded = await ext.context.newPage();
  try {
    // The unrecorded tab is loaded first, so the recorder is not in it; same page, origin and server for both.
    await plain.goto(`${server.url}/responses.html`);
    await recorded.goto(`${server.url}/responses.html`);
    await startRecording(recorded);
    await plain.evaluate((i) => globalThis.echoRequests(i), `${id}-plain`);
    await recorded.evaluate((i) => globalThis.echoRequests(i), `${id}-rec`);

    for (const kind of ['fetch', 'xhr']) {
      const without = await lastHeaders(`${id}-plain-${kind}`);
      const withRecording = await lastHeaders(`${id}-rec-${kind}`);
      expect(withRecording.method).toBe(without.method);
      expect(withRecording.headers, `${kind} headers`).toEqual(without.headers);
      // Names and their order as they went over the wire (a hook that adds or reorders a header shows here).
      const names = (raw) => raw.filter((_, i) => i % 2 === 0);
      expect(names(withRecording.rawHeaders), `${kind} header names`).toEqual(names(without.rawHeaders));
      expect(withRecording.headers['x-pds-test']).toBeTruthy();
    }
    await save(recorded);
  } finally {
    await plain.close();
    await recorded.close();
  }
});
