// A sample snapshots directory for the MCP integration test (E4-TEST3): a v4 zip made by exportPackage, a zip of the
// redacted trap corpus (tests/fixtures/redaction/sensitive.json pushed through exportPackage), a heavy zip
// (heavy-package.js), v2.json, v3.json, a damaged zip and the diff pair. Everything is deterministic.
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportPackage } from '../../../src/lib/export.js';
import { createZip } from '../../../src/lib/zip.js';
import { heavyPackage } from './heavy-package.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const enc = new TextEncoder();
const fixture = (...parts) => fs.readFile(join(root, 'tests', 'fixtures', ...parts), 'utf8');

const STARTED = Date.UTC(2026, 9, 26, 8, 0, 0);
const DATE = new Date(2026, 9, 26, 14, 5, 9);
export const TRAP_HOST = 'traps.invalid';

/** File names in the directory (the exported zip has the name exportPackage gives it). */
export const FILES = Object.freeze({
  traps: 'traps.zip',
  heavy: 'heavy.zip',
  v2: 'v2.json',
  v3: 'v3.json',
  broken: 'broken.zip',
  diffA: 'diff-a.json',
  diffB: 'diff-b.json',
});

/** Smallest exportPackage input (shape as in mcp-tools.test.js); `extra` adds entries to the current document. */
export function exportInput(extra = {}, host = 'app.example.test') {
  return {
    meta: { extensionVersion: '0.6.0', source: 'extension', startedAt: STARTED, collectedAt: STARTED + 60_000, stopReason: null, screenshots: [] },
    current: {
      protocol: 3, docId: 1, url: `https://${host}/page`, timeOrigin: STARTED + 30_000, navigationType: 'navigate', stopReason: null,
      environment: { location: { href: `https://${host}/page`, hostname: host, pathname: '/page' } },
      performance: { timeOrigin: STARTED + 30_000, navigation: null, resources: [] },
      storage: { cookies: 'consent=1', localStorage: {}, sessionStorage: {} },
      dom: { counts: { totalElements: 3, forms: 0 }, html: { lang: 'pl' }, forms: [], structure: '<html></html>', structureTruncated: false, omittedElements: 0 },
      consoleLogs: [{ t: 11, level: 'error', args: ['save failed'] }, ...(extra.consoleLogs ?? [])],
      runtimeErrors: [
        { t: 12, type: 'error', message: 'TypeError: x is undefined', filename: `https://${host}/a.js`, lineno: 1, colno: 2 },
        ...(extra.runtimeErrors ?? []),
      ],
      network: [
        { t: 5, type: 'fetch', method: 'POST', url: `https://${host}/api`, status: 500, ok: false, durationMs: 3, error: null },
        ...(extra.network ?? []),
      ],
      steps: [{ t: 2, type: 'click', selector: '#save', text: 'Zapisz' }, ...(extra.steps ?? [])],
      truncated: {},
      counts: { consoleLogs: 1, runtimeErrors: 1, network: 1, steps: 1 },
    },
    priorDocs: [],
    docs: [{ id: 1, url: `https://${host}/page` }],
  };
}

/** Sensitive corpus items (AC-3.1): `{ id, text, secrets, via? }`. */
export async function sensitiveItems() {
  return JSON.parse(await fixture('redaction', 'sensitive.json')).items;
}

// Every corpus text lands where the corpus says it is masked (maskText with e-mail and phone: error message, console
// argument, request body; maskUrl: request and navigation URLs) and exportPackage redacts it on the way in. The host
// shares no 8-character fragment with the corpus (`example.` would).
function trapInput(items) {
  const extra = { consoleLogs: [], runtimeErrors: [], network: [], steps: [] };
  items.forEach((item, i) => {
    const t = 20 + i;
    if (item.via === 'url') {
      extra.network.push({ t, type: 'fetch', method: 'GET', url: item.text, status: 401, ok: false, durationMs: 1, error: null });
      extra.steps.push({ t, type: 'navigate', url: item.text, via: 'pushState' });
      return;
    }
    extra.runtimeErrors.push({ t, type: 'error', message: item.text, filename: `https://${TRAP_HOST}/a.js`, lineno: i + 1, colno: 1 });
    extra.consoleLogs.push({ t, level: 'error', args: [item.text] });
    extra.network.push({ t, type: 'xhr', method: 'POST', url: `https://${TRAP_HOST}/api/${i}`, status: 500, ok: false, durationMs: 1, error: null, requestBody: item.text });
  });
  return exportInput(extra, TRAP_HOST);
}

/**
 * Creates the directory. `heavy` options go to heavyPackage() (defaults keep the zip small but every list over the cap).
 * @returns {Promise<{ dir: string, exported: { bytes: Uint8Array, fileName: string }, traps: Uint8Array,
 *   items: object[], cleanup: () => Promise<void> }>}
 */
export async function createSnapshotDir({ heavy: heavyOptions } = {}) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'pds-mcp-it-'));
  const exported = await exportPackage({ input: exportInput(), date: DATE });
  await fs.writeFile(join(dir, exported.fileName), exported.bytes);

  const items = await sensitiveItems();
  const traps = await exportPackage({ input: trapInput(items), date: DATE });
  await fs.writeFile(join(dir, FILES.traps), traps.bytes);

  const heavy = heavyPackage({ logs: 1000, logChars: 2000, requests: 3000, errors: 600, structureChars: 20000, resources: 200, ...heavyOptions });
  const heavyZip = await createZip([{ name: 'snapshot.json', data: enc.encode(JSON.stringify(heavy)), compress: true }]);
  await fs.writeFile(join(dir, FILES.heavy), heavyZip.bytes);

  await fs.writeFile(join(dir, FILES.v2), await fixture('snapshots', 'v2.json'));
  await fs.writeFile(join(dir, FILES.v3), await fixture('snapshots', 'v3.json'));
  await fs.writeFile(join(dir, FILES.diffA), await fixture('snapshots', 'diff-a.json'));
  await fs.writeFile(join(dir, FILES.diffB), await fixture('snapshots', 'diff-b.json'));
  await fs.writeFile(join(dir, FILES.broken), Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]));

  return {
    dir,
    exported: { bytes: exported.bytes, fileName: exported.fileName },
    traps: traps.bytes,
    items,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

/** `name:size:mtimeMs` of every entry, sorted: equal before and after = nothing written, added or removed. */
export async function listing(dir) {
  const names = (await fs.readdir(dir)).sort();
  return Promise.all(names.map(async (n) => {
    const st = await fs.stat(join(dir, n));
    return `${n}:${st.size}:${st.mtimeMs}`;
  }));
}
