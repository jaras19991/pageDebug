// E1-T19d: the release artefact works, not only dist/ (regression E0 AC-4.5). pack() builds into
// a temp dir, the Chrome zip is unpacked and loaded as the extension, and the full flow
// Nagrywaj -> Zapisz paczkę gives a v2 package. The Firefox zip is checked for its shape only.
import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pack } from '../../scripts/pack.mjs';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';
import { unzipToTemp } from './helpers/unzip.js';

let packDir;
let zips;
const unpacked = [];

test.beforeAll(async () => {
  packDir = await mkdtemp(join(tmpdir(), 'pds-e2e-pack-'));
  zips = await pack({ distDir: packDir });
});

test.afterAll(async () => {
  for (const u of unpacked) await u.cleanup();
  if (packDir) await rm(packDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function zipFor(target) {
  const zip = zips.find((z) => basename(z).startsWith(`page-debug-snapshot-${target}-`));
  expect(zip, `${target} zip`).toBeTruthy();
  return zip;
}

async function unzip(target) {
  const u = await unzipToTemp(zipFor(target));
  unpacked.push(u);
  return u;
}

test('packed chrome zip loads and records basic.html end-to-end', async () => {
  test.setTimeout(60_000);
  const { dir, entries } = await unzip('chrome');
  expect(entries).toContain('manifest.json');

  const server = await startFixtureServer({ port: 0 });
  const ext = await launchWithExtension({ distDir: dir });
  try {
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    expect(ext.extensionInfo.version).toBe(manifest.version);

    const page = await ext.context.newPage();
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);
    const marker = `packed-zip-${Date.now()}`;
    await page.evaluate((m) => console.log(m), marker);

    const { fileName, json } = await saveRecording(page);
    expect(fileName).toMatch(/^snapshot-[a-z0-9.-]+-\d{8}-\d{6}( \(\d+\))?\.zip$/);
    expect(json.schemaVersion).toBe(4);
    expect(json.extensionVersion).toBe(manifest.version);
    expect(json.documents.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(json.consoleLogs)).toContain(marker);
  } finally {
    await ext.close();
    await server.close();
  }
});

test('packed firefox zip has manifest.json at the root with background.scripts', async () => {
  const { dir, entries } = await unzip('firefox');
  expect(entries).toContain('manifest.json');
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  expect(Array.isArray(manifest.background?.scripts)).toBe(true);
  expect(manifest.background.scripts.length).toBeGreaterThan(0);
  for (const script of manifest.background.scripts) expect(entries).toContain(script);
});
