// E0-T7a smoke: one snapshot on basic.html through the real popup (AC-1.1, AC-6.5, AC-2.3)
// and the click→download timing for the NFR (median of 5, compared with the baseline in QA).
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension, openPopupFor } from './helpers/launch.js';
import { waitForDownloadJson, expectNoDownload, countDownloads } from './helpers/download.js';
import { MESSAGES } from '../../src/popup/messages.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// test-results/ is Playwright's outputDir and is gitignored (AC-3.4).
const TIMING_FILE = resolve(ROOT, 'test-results/snapshot-timing.json');

// Top-level keys of the 1.0.0 package (AC-6.5); E0 must not change them.
const PACKAGE_KEYS = [
  'version', 'collectedAt', 'initializedAt', 'notes', 'environment', 'dom',
  'performance', 'storage', 'consoleLogs', 'runtimeErrors', 'network',
];
const PERF_RUNS = 5;
const PERF_LIMIT_MS = 2000;

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

const isStatusError = (popup) =>
  popup.evaluate(`document.getElementById('status').classList.contains('error')`);

// Opens basic.html in a fresh tab, clicks the popup button and returns the parsed package.
async function snapshotBasic() {
  const page = await ext.context.newPage();
  await page.goto(`${server.url}/basic.html`);
  const popup = await openPopupFor(page);
  const downloads = countDownloads(page);
  const { suggestedFilename, json } = await waitForDownloadJson(page, () => popup.click('#runSnapshot'));
  const status = await popup.waitForText('#status', suggestedFilename);
  return { page, popup, downloads, suggestedFilename, json, status };
}

async function closeRun(run) {
  await run.popup.close();
  await run.page.close();
}

test('smoke: one json downloaded and status contains its filename', async () => {
  const run = await snapshotBasic();
  try {
    expect(run.suggestedFilename).toMatch(/^page-debug-snapshot-\d+\.json$/);
    expect(run.status).toContain(run.suggestedFilename);
    expect(run.status).toBe(MESSAGES.success(run.suggestedFilename));
    expect(await isStatusError(run.popup)).toBe(false);
    await expectNoDownload(run.page, 1000);
    expect(run.downloads.names).toEqual([run.suggestedFilename]);
  } finally {
    await closeRun(run);
  }
});

test('smoke: package top-level keys and version 1.0.0', async () => {
  const run = await snapshotBasic();
  try {
    expect(Object.keys(run.json).sort()).toEqual([...PACKAGE_KEYS].sort());
    expect(run.json.version).toBe('1.0.0');
  } finally {
    await closeRun(run);
  }
});

test('smoke: no chrome-extension script nodes added and no leftover nodes', async () => {
  const run = await snapshotBasic();
  try {
    const added = await run.page.evaluate('window.__added');
    const extensionScripts = added.filter(
      (n) => n.nodeName === 'SCRIPT' && typeof n.src === 'string' && n.src.startsWith('chrome-extension://'),
    );
    expect(extensionScripts).toEqual([]);

    // Anything added during the snapshot (e.g. the temporary download link) is gone again.
    const leftovers = await run.page.evaluate(`({
      floatingButton: !!document.getElementById('__page_debug_snapshot_button__'),
      extensionScripts: [...document.scripts].filter((s) => s.src.startsWith('chrome-extension://')).length,
      bodyChildren: [...document.body.children].map((el) => el.id || el.tagName),
    })`);
    expect(leftovers).toEqual({
      floatingButton: false,
      extensionScripts: 0,
      bodyChildren: ['H1', 'content', 'action'],
    });
  } finally {
    await closeRun(run);
  }
});

test('perf: median click→download of 5 runs logged and < 2000 ms', async () => {
  test.setTimeout(90_000);
  const runs = [];
  for (let i = 0; i < PERF_RUNS; i += 1) {
    const page = await ext.context.newPage();
    await page.goto(`${server.url}/basic.html`);
    const popup = await openPopupFor(page);
    try {
      let start = 0;
      await waitForDownloadJson(page, () => {
        start = performance.now();
        return popup.click('#runSnapshot');
      });
      runs.push(Math.round(performance.now() - start));
    } finally {
      await popup.close();
      await page.close();
    }
  }
  const medianMs = [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)];
  const result = { fixture: 'basic.html', runs, medianMs, measuredAt: new Date().toISOString() };
  await mkdir(dirname(TIMING_FILE), { recursive: true });
  await writeFile(TIMING_FILE, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[perf] click→download on basic.html: runs ${runs.join(', ')} ms, median ${medianMs} ms`);
  expect(medianMs).toBeLessThan(PERF_LIMIT_MS);
});
