// E0-T7b / AC-4.5: the Chrome release zip, unpacked and loaded as an unpacked extension,
// passes the smoke test. pack() writes into a temp dir, never into dist/, which other
// spec files have loaded in their browsers at the same time.
import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pack } from '../../scripts/pack.mjs';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension, openPopupFor, expectDownload } from './helpers/launch.js';
import { unzipToTemp, listZipEntries } from './helpers/unzip.js';
import { MESSAGES } from '../../src/popup/messages.js';

let packDir;
let zips;
let unpacked;
let server;
let ext;

test.beforeAll(async () => {
  packDir = await mkdtemp(join(tmpdir(), 'pds-e2e-pack-'));
  zips = await pack({ distDir: packDir });
});

test.afterAll(async () => {
  await ext?.close();
  await server?.close();
  await unpacked?.cleanup();
  if (packDir) await rm(packDir, { recursive: true, force: true });
});

function zipFor(target) {
  const zip = zips.find((z) => basename(z).startsWith(`page-debug-snapshot-${target}-`));
  expect(zip, `${target} zip`).toBeTruthy();
  return zip;
}

test('packed chrome zip loads and passes smoke', async () => {
  const zip = zipFor('chrome');
  unpacked = await unzipToTemp(zip);
  const manifest = JSON.parse(await readFile(join(unpacked.dir, 'manifest.json'), 'utf8'));
  expect(basename(zip)).toBe(`page-debug-snapshot-chrome-${manifest.version}.zip`);

  server = await startFixtureServer({ port: 0 });
  ext = await launchWithExtension({ distDir: unpacked.dir });
  expect(ext.extensionInfo.version).toBe(manifest.version);

  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/basic.html`);
    const popup = await openPopupFor(page);
    try {
      const download = await expectDownload(page, () => popup.click('#runSnapshot'));
      expect(download.suggestedFilename).toMatch(/^page-debug-snapshot-\d+\.json$/);
      const status = await popup.waitForText('#status', download.suggestedFilename);
      expect(status).toBe(MESSAGES.success(download.suggestedFilename));
      const json = JSON.parse(await readFile(download.path, 'utf8'));
      expect(json).toHaveProperty('version');
    } finally {
      await popup.close();
    }
  } finally {
    await page.close();
  }
});

// Loading in Firefox is manual QA; `web-ext lint` on the same content runs in `npm run lint` (T15).
test('packed firefox zip exists with manifest.json at root', async () => {
  const zip = zipFor('firefox');
  expect(await listZipEntries(zip)).toContain('manifest.json');
});
