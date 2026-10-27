// Package files for the viewer e2e (E4-TEST2): zips built from fixtures with createZip/exportPackage, a heavy zip
// (~10 MB JSON, ~1.7 MB zip) and a snapshot with 5000 requests. Built in Node, written to a temp dir by the caller.
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportPackage } from '../../../src/lib/export.js';
import { createZip } from '../../../src/lib/zip.js';
import { exportInput } from '../../unit/helpers/snapshot-dir.js';
import { heavyPackage } from '../../unit/helpers/heavy-package.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const enc = new TextEncoder();

/** Parsed tests/fixtures/snapshots/<name>. */
export async function fixtureJson(name) {
  return JSON.parse(await readFile(join(ROOT, 'tests', 'fixtures', 'snapshots', name), 'utf8'));
}

/** Zip with a snapshot.json entry only (the reader accepts it, like the MCP heavy.zip). */
export async function zipOfSnapshot(snapshot) {
  const { bytes } = await createZip([{ name: 'snapshot.json', data: enc.encode(JSON.stringify(snapshot)), compress: true }]);
  return bytes;
}

/** A real v4 package from exportPackage; `jpegDataUrl` adds the screenshot entry. */
export async function exportedZip({ jpegDataUrl } = {}) {
  const input = exportInput();
  if (jpegDataUrl) {
    input.meta.screenshots = [{ epochMs: input.meta.startedAt + 35_000, mime: 'image/jpeg', width: 8, height: 8, bytes: jpegDataUrl.length, dataUrl: jpegDataUrl, maskedFields: 0 }];
  }
  const { bytes } = await exportPackage({ input, date: new Date(2026, 9, 26, 14, 5, 9) });
  return bytes;
}

/** Heavy package: ~10 MB of JSON that compresses to ~1.7 MB. Returns the zip bytes and the JSON size. */
export async function heavyZip() {
  const snapshot = heavyPackage({ logs: 1000, logChars: 8000, requests: 3000, errors: 300, structureChars: 100_000, resources: 200 });
  const json = JSON.stringify(snapshot);
  const { bytes } = await createZip([{ name: 'snapshot.json', data: enc.encode(json), compress: true }]);
  return { bytes, jsonBytes: json.length };
}

/** Snapshot (JSON object) with 5000 requests of the heavy generator and little else. */
export function networkSnapshot(requests = 5000) {
  return heavyPackage({ logs: 5, logChars: 100, requests, errors: 5, structureChars: 1000, resources: 5 });
}
