// @vitest-environment node
// E4-T4c (D6): the seven MCP tools on a real directory — summary byte-identical with summary.md (AC-5.3), errors /
// steps / vitals with absolute times (AC-5.4), network filter (AC-5.5), diff (AC-5.6), the 25 000-character cap with a
// narrowing hint (AC-5.7), read-only and offline code (AC-5.8).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as realFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTools, capResponse, MAX_RESPONSE_CHARS, TOOL_NAMES } from '../../mcp/tools.js';
import { readPackage } from '../../src/lib/package-reader.js';
import { createZip } from '../../src/lib/zip.js';
import { exportPackage } from '../../src/lib/export.js';
import { diffSnapshots } from '../../src/lib/snapshot-diff.js';
import { heavyPackage } from './helpers/heavy-package.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const enc = new TextEncoder();
const readFixture = async (name) => JSON.parse(await realFs.readFile(join(root, 'tests', 'fixtures', 'snapshots', `${name}.json`), 'utf8'));
const iso = (ms) => new Date(ms).toISOString();

const STARTED = Date.UTC(2026, 9, 26, 8, 0, 0);
const DATE = new Date(2026, 9, 26, 14, 5, 9);

// Smallest exportPackage input (shape as in mcp-dir.test.js).
function exportInput() {
  return {
    meta: { extensionVersion: '0.6.0', source: 'extension', startedAt: STARTED, collectedAt: STARTED + 60_000, stopReason: null, screenshots: [] },
    current: {
      protocol: 3, docId: 1, url: 'https://app.example.test/page', timeOrigin: STARTED + 30_000, navigationType: 'navigate', stopReason: null,
      environment: { location: { href: 'https://app.example.test/page', hostname: 'app.example.test', pathname: '/page' } },
      performance: { timeOrigin: STARTED + 30_000, navigation: null, resources: [] },
      storage: { cookies: 'consent=1', localStorage: {}, sessionStorage: {} },
      dom: { counts: { totalElements: 3, forms: 0 }, html: { lang: 'pl' }, forms: [], structure: '<html></html>', structureTruncated: false, omittedElements: 0 },
      consoleLogs: [{ t: 11, level: 'error', args: ['save failed'] }],
      runtimeErrors: [{ t: 12, type: 'error', message: 'TypeError: x is undefined', filename: 'https://app.example.test/a.js', lineno: 1, colno: 2 }],
      network: [{ t: 5, type: 'fetch', method: 'POST', url: 'https://app.example.test/api', status: 500, ok: false, durationMs: 3, error: null }],
      steps: [{ t: 2, type: 'click', selector: '#save', text: 'Zapisz' }],
      truncated: {},
      counts: { consoleLogs: 1, runtimeErrors: 1, network: 1, steps: 1 },
    },
    priorDocs: [],
    docs: [{ id: 1, url: 'https://app.example.test/page' }],
  };
}

let dir;
let tools;
let exported;
let v4;
let heavy;

// Calls a tool handler like the server does: string as is, anything else as JSON.
async function call(name, args = {}) {
  const tool = tools.find((t) => t.name === name);
  const value = await tool.handler(args);
  return typeof value === 'string' ? value : JSON.stringify(value);
}
const callJson = async (name, args) => JSON.parse(await call(name, args));

async function listing(path) {
  const names = (await realFs.readdir(path)).sort();
  return Promise.all(names.map(async (n) => {
    const st = await realFs.stat(join(path, n));
    return `${n}:${st.size}:${st.mtimeMs}`;
  }));
}

beforeAll(async () => {
  dir = await realFs.mkdtemp(join(tmpdir(), 'pds-mcp-tools-'));
  exported = await exportPackage({ input: exportInput(), date: DATE });
  await realFs.writeFile(join(dir, exported.fileName), exported.bytes);

  v4 = await readFixture('v4');
  const v4zip = await createZip([{ name: 'snapshot.json', data: enc.encode(JSON.stringify(v4)), compress: true }]);
  await realFs.writeFile(join(dir, 'v4.zip'), v4zip.bytes);

  heavy = heavyPackage({ logs: 1000, logChars: 2000, requests: 3000, errors: 600, structureChars: 20000, resources: 200 });
  await realFs.writeFile(join(dir, 'heavy.json'), JSON.stringify(heavy));
  // Console errors whose arguments are one cut entry `{ truncated, preview }` (E4-FIX2).
  const cut = { ...v4, runtimeErrors: [], consoleLogs: [
    { t: 100, doc: v4.documents[0].id, level: 'error', args: { truncated: true, preview: '["first long failure",' } },
    { t: 110, doc: v4.documents[0].id, level: 'error', args: { truncated: true, preview: '["second long failure",' } },
  ] };
  await realFs.writeFile(join(dir, 'cut-args.json'), JSON.stringify(cut));
  // A package from before redaction (schemaVersion 3, E4-FIX2).
  await realFs.writeFile(join(dir, 'old-v3.json'), JSON.stringify(await readFixture('v3')));
  await realFs.writeFile(join(dir, 'diff-a.json'), JSON.stringify(await readFixture('diff-a')));
  await realFs.writeFile(join(dir, 'diff-b.json'), JSON.stringify(await readFixture('diff-b')));
  await realFs.writeFile(join(dir, 'broken.zip'), Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]));
  tools = createTools(dir);
}, 60_000);

afterAll(async () => {
  if (dir) await realFs.rm(dir, { recursive: true, force: true });
});

describe('registry (AC-5.1)', () => {
  it('seven tools with description and an object inputSchema; ids required where a package is read', () => {
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect(TOOL_NAMES).toEqual(['list_snapshots', 'get_summary', 'get_errors', 'get_network', 'get_vitals', 'get_steps', 'diff_snapshots']);
    for (const t of tools) {
      expect(typeof t.description, t.name).toBe('string');
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(t.inputSchema.type, t.name).toBe('object');
      expect(typeof t.handler, t.name).toBe('function');
    }
    const required = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema.required ?? []]));
    expect(required).toMatchObject({ list_snapshots: [], get_summary: ['id'], get_errors: ['id'], get_network: ['id'], get_vitals: ['id'], get_steps: ['id'], diff_snapshots: ['a', 'b'] });
  });
});

describe('list_snapshots (AC-5.2)', () => {
  it('lists every package newest first, broken one marked', async () => {
    const res = await callJson('list_snapshots');
    expect(res.total).toBe(8);
    const ids = res.items.map((e) => e.id);
    expect(ids).toHaveLength(8);
    expect(ids).toContain(exported.fileName);
    expect(res.items.find((e) => e.id === 'broken.zip').error).toBeTruthy();
    expect(res.items.find((e) => e.id === 'v4.zip')).toMatchObject({ host: '127.0.0.1', schemaVersion: 4 });
  });
});

describe('packages from before redaction (E4-FIX2)', () => {
  const NOTE = 'Paczka sprzed automatycznej redakcji — może zawierać hasła i tokeny';

  it('list_snapshots: warnings field on a v3 package, empty on v4', async () => {
    const res = await callJson('list_snapshots');
    expect(res.items.find((e) => e.id === 'old-v3.json').warnings).toEqual([NOTE]);
    expect(res.items.find((e) => e.id === 'v4.zip').warnings).toEqual([]);
  });

  it('get_summary: the note on top for v3, none for v4', async () => {
    const text = await call('get_summary', { id: 'old-v3.json' });
    expect(text.split('\n')[0]).toBe(`Uwaga: ${NOTE}.`);
    expect(text).toContain('# Paczka diagnostyczna');
    expect(await call('get_summary', { id: 'v4.zip' })).not.toContain(NOTE);
  });
});

describe('get_summary (AC-5.3)', () => {
  it('equals summary.md of a zip made by exportPackage (byte-identical)', async () => {
    const { summaryMd } = await readPackage(exported.bytes);
    expect(summaryMd).toBeTruthy();
    const text = await call('get_summary', { id: exported.fileName });
    expect(Buffer.from(text, 'utf8').equals(Buffer.from(summaryMd, 'utf8'))).toBe(true);
  });
});

describe('get_errors / get_steps / get_vitals on v4.json (AC-5.4)', () => {
  const docOrigin = (doc) => v4.documents.find((d) => d.id === doc).timeOrigin;
  const start = () => Date.parse(v4.recordingStartedAt);

  it('get_errors: groups, absolute time = timeOrigin + t, full stack ≤ 4000, step before the error', async () => {
    const res = await callJson('get_errors', { id: 'v4.zip' });
    const runtime = v4.runtimeErrors[0];
    const first = res.groups.find((g) => g.message === runtime.message);
    expect(first).toBeTruthy();
    expect(first.count).toBe(1);
    expect(first.firstAt).toBe(iso(docOrigin(runtime.doc) + runtime.t));
    expect(first.firstRel).toBeCloseTo((docOrigin(runtime.doc) + runtime.t - start()) / 1000, 2);
    expect(first.stack).toBe(runtime.stack);
    expect(first.frame).toBe('result.html:3:9');
    expect(first.stepBefore).toMatchObject({ type: expect.any(String) });
    expect(Date.parse(first.stepBefore.at)).toBeLessThan(Date.parse(first.firstAt));
    expect(res.total).toBe(res.groups.length + res.more);
    expect(res.overview).toMatchObject({ runtimeErrors: v4.overview.runtimeErrors, consoleErrors: v4.overview.consoleErrors });
  });

  it('get_errors: console args {truncated, preview} give the preview as message, one group each (E4-FIX2)', async () => {
    const res = await callJson('get_errors', { id: 'cut-args.json' });
    expect(res.groups.map((g) => g.message)).toEqual(['["first long failure",', '["second long failure",']);
  });

  it('get_errors: stack cut to 4000 characters, limit respected', async () => {
    const res = await callJson('get_errors', { id: 'heavy.json', limit: 3 });
    expect(res.groups).toHaveLength(3);
    expect(res.total).toBeGreaterThan(heavy.runtimeErrors.length); // unique runtime messages + console error groups
    expect(res.more).toBe(res.total - 3);
    for (const g of res.groups) {
      expect(g.stack.length).toBe(4000);
      expect(g.stackTruncated).toBe(true);
    }
  });

  it('get_steps: every step with ISO and relative time, the one before the first error marked', async () => {
    const res = await callJson('get_steps', { id: 'v4.zip' });
    expect(res.total).toBe(v4.steps.length);
    expect(res.items).toHaveLength(v4.steps.length);
    const sorted = [...v4.steps].sort((a, b) => (docOrigin(a.doc) + a.t) - (docOrigin(b.doc) + b.t));
    res.items.forEach((item, i) => {
      expect(item.at).toBe(iso(docOrigin(sorted[i].doc) + sorted[i].t));
      expect(item.rel).toBeCloseTo((docOrigin(sorted[i].doc) + sorted[i].t - start()) / 1000, 2);
      expect(item.type).toBe(sorted[i].type);
    });
    expect(res.items.filter((s) => s.beforeFirstError)).toHaveLength(1);
    const limited = await callJson('get_steps', { id: 'v4.zip', limit: 2 });
    expect(limited.items).toHaveLength(2);
    expect(limited.items.at(-1).at).toBe(res.items.at(-1).at);
  });

  it('get_vitals: values and ratings as in the fixture, metric time absolute, reasons for missing values', async () => {
    const res = await callJson('get_vitals', { id: 'v4.zip' });
    expect(res.docs).toHaveLength(v4.vitals.length);
    for (const [i, raw] of v4.vitals.entries()) {
      const doc = res.docs[i];
      expect(doc.doc).toBe(raw.doc);
      expect(doc.timeOrigin).toBe(iso(docOrigin(raw.doc)));
      for (const name of ['TTFB', 'FCP', 'LCP', 'CLS', 'INP']) {
        const m = doc.metrics[name];
        if (raw[name].available) {
          expect(m).toMatchObject({ available: true, value: raw[name].value, rating: raw[name].rating });
          expect(m.at).toBe(iso(docOrigin(raw.doc) + raw[name].t));
        } else {
          expect(m).toMatchObject({ available: false, reason: raw[name].reason });
          expect(typeof m.reasonText).toBe('string');
        }
      }
    }
    expect(res.docs[1].metrics.LCP).toMatchObject({ value: 4300, rating: 'poor', ratingText: 'słabo' });
  });
});

describe('get_network (AC-5.5)', () => {
  it('default: failed only, limit 50, remaining, no headers or bodies', async () => {
    const res = await callJson('get_network', { id: 'v4.zip' });
    const failed = v4.network.filter((e) => e.status >= 400 || e.error);
    expect(res.matched).toBe(failed.length);
    expect(res.total).toBe(v4.network.length);
    expect(res.items.map((e) => e.url)).toEqual(failed.map((e) => e.url));
    expect(res.remaining).toBe(0);
    for (const item of res.items) {
      expect(item).not.toHaveProperty('requestHeaders');
      expect(item).not.toHaveProperty('responseHeaders');
      expect(item).not.toHaveProperty('requestBody');
      expect(item).not.toHaveProperty('responseBodyPreview');
      expect(typeof item.at).toBe('string');
    }
    const api = res.items.find((e) => e.url.endsWith('/api/fail'));
    expect(api.at).toBe(iso(v4.documents[1].timeOrigin + 12.5));

    const big = await callJson('get_network', { id: 'heavy.json' });
    const heavyFailed = heavy.network.filter((e) => e.status >= 400 || e.error).length;
    expect(big.items).toHaveLength(50);
    expect(big.matched).toBe(heavyFailed);
    expect(big.remaining).toBe(heavyFailed - 50);
  });

  it('status range, class and exact; type, method, urlContains; offset', async () => {
    const all = await callJson('get_network', { id: 'v4.zip', failedOnly: false, limit: 500 });
    expect(all.matched).toBe(v4.network.length);
    const range = await callJson('get_network', { id: 'v4.zip', status: '400-499' });
    expect(range.items.map((e) => e.status)).toEqual(v4.network.filter((e) => e.status >= 400 && e.status <= 499).map((e) => e.status));
    const cls = await callJson('get_network', { id: 'v4.zip', status: '5xx' });
    expect(cls.items.map((e) => e.status)).toEqual([500]);
    const exact = await callJson('get_network', { id: 'v4.zip', status: 200 });
    expect(exact.items.map((e) => e.url)).toEqual(['http://127.0.0.1:8080/style.css']); // status set → failedOnly off by default
    expect((await callJson('get_network', { id: 'v4.zip', type: 'script' })).items.map((e) => e.url)).toEqual(['http://127.0.0.1:8080/missing.js']);
    expect((await callJson('get_network', { id: 'v4.zip', method: 'post' })).items.map((e) => e.method)).toEqual(['POST']);
    expect((await callJson('get_network', { id: 'v4.zip', urlContains: 'MISSING' })).matched).toBe(2);
    const page = await callJson('get_network', { id: 'v4.zip', limit: 1, offset: 1 });
    expect(page).toMatchObject({ offset: 1, returned: 1, remaining: page.matched - 2 });
  });

  it('headers and body only on request', async () => {
    const withHeaders = await callJson('get_network', { id: 'v4.zip', urlContains: '/api/fail', includeHeaders: true });
    expect(withHeaders.items[0].requestHeaders).toEqual(v4.network[2].requestHeaders);
    expect(withHeaders.items[0]).not.toHaveProperty('responseBodyPreview');
    const withBody = await callJson('get_network', { id: 'v4.zip', urlContains: '/api/fail', includeBody: true });
    expect(withBody.items[0]).toMatchObject({ requestBody: v4.network[2].requestBody, responseBodyPreview: '{"error":"expired"}' });
    expect(withBody.items[0]).not.toHaveProperty('requestHeaders');
  });

  it('bad filter → error with a Polish message', async () => {
    for (const args of [{ id: 'v4.zip', status: 'abc' }, { id: 'v4.zip', limit: 0 }, { id: 'v4.zip', offset: -1 }, { id: 'v4.zip', limit: 'x' }]) {
      await expect(call('get_network', args), JSON.stringify(args)).rejects.toThrow(/[ąćęłńóśźż]|Nieprawidłow/);
    }
  });
});

describe('diff_snapshots (AC-5.6)', () => {
  it('wires snapshot-diff with both packages read from the directory', async () => {
    const res = await callJson('diff_snapshots', { a: 'diff-a.json', b: 'diff-b.json' });
    const expected = diffSnapshots(await readFixture('diff-a'), await readFixture('diff-b'));
    expect(res).toMatchObject({ errors: expected.errors, statuses: expected.statuses, vitals: expected.vitals, cookies: expected.cookies, omitted: expected.omitted });
    expect(res.a.id).toBe('diff-a.json');
    expect(res.b.id).toBe('diff-b.json');
  });
});

describe('errors and limits (AC-5.7, AC-5.8)', () => {
  it('bad id, ../, absolute path, corrupt file, missing argument → rejected with a Polish message', async () => {
    for (const [name, args] of [
      ['get_summary', { id: '../x.json' }], ['get_errors', { id: '/etc/passwd' }], ['get_steps', { id: 'broken.zip' }],
      ['get_vitals', {}], ['diff_snapshots', { a: 'v4.zip' }], ['get_network', { id: 'nope.zip' }],
    ]) {
      await expect(call(name, args), `${name} ${JSON.stringify(args)}`).rejects.toThrow(/./);
    }
    await expect(call('get_summary', { id: 'broken.zip' })).rejects.toThrow(/uszkodzony/);
  });

  it('capResponse: short text untouched; long text cut to the limit with a hint', () => {
    expect(capResponse('abc', 'x')).toBe('abc');
    const long = 'a'.repeat(MAX_RESPONSE_CHARS + 5000);
    const cut = capResponse(long, 'użyj limit');
    expect(cut.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    expect(cut).toMatch(/ucięto \d+ znaków; zawęź zapytanie: użyj limit$/);
    const n = Number(/ucięto (\d+)/.exec(cut)[1]);
    expect(cut.startsWith('a'.repeat(long.length - n))).toBe(true);
    expect(MAX_RESPONSE_CHARS).toBe(25_000);
  });

  it('heavy package: every response ≤ 25 000 characters; a cut one tells how to narrow the query', async () => {
    const calls = [
      ['list_snapshots', {}], ['get_summary', { id: 'heavy.json' }], ['get_errors', { id: 'heavy.json' }],
      ['get_errors', { id: 'heavy.json', limit: 200 }], ['get_network', { id: 'heavy.json' }],
      ['get_network', { id: 'heavy.json', failedOnly: false, limit: 500, includeHeaders: true, includeBody: true }],
      ['get_vitals', { id: 'heavy.json' }], ['get_steps', { id: 'heavy.json', limit: 1000 }], ['diff_snapshots', { a: 'heavy.json', b: 'v4.zip' }],
    ];
    let narrowed = 0;
    for (const [name, args] of calls) {
      const text = await call(name, args);
      expect(text.length, `${name} ${JSON.stringify(args)}`).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
      if (/zawęź zapytanie/.test(text)) narrowed++;
    }
    expect(narrowed).toBeGreaterThanOrEqual(2); // get_errors limit 200 and get_network limit 500 do not fit
  }, 60_000);

  it('directory unchanged after all calls', async () => {
    const before = await listing(dir);
    for (const t of tools) await call(t.name, t.name === 'diff_snapshots' ? { a: 'v4.zip', b: 'heavy.json' } : { id: 'v4.zip' });
    expect(await listing(dir)).toEqual(before);
  });
});

describe('static: no network, no process spawning (AC-5.8)', () => {
  // mcp/*.js and every module reachable from them through relative imports.
  async function reachable() {
    const seen = new Set();
    const queue = (await realFs.readdir(join(root, 'mcp'))).filter((n) => n.endsWith('.js')).map((n) => join(root, 'mcp', n));
    while (queue.length) {
      const file = queue.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      const text = await realFs.readFile(file, 'utf8');
      for (const m of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) queue.push(resolve(dirname(file), m[1]));
    }
    return [...seen];
  }

  it('mcp/*.js and imported src/lib modules import no net/http/https/tls/dgram/child_process and call no fetch(', async () => {
    const files = await reachable();
    expect(files.some((f) => f.endsWith(join('src', 'lib', 'snapshot-diff.js')))).toBe(true);
    expect(files.some((f) => f.endsWith(join('mcp', 'tools.js')))).toBe(true);
    for (const file of files) {
      const code = (await realFs.readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
      expect(code, file).not.toMatch(/['"](?:node:)?(?:net|http|https|http2|tls|dgram|child_process|worker_threads)['"]/);
      expect(code, file).not.toMatch(/\bfetch\s*\(/);
      expect(code, file).not.toMatch(/\b(?:writeFile|appendFile|unlink|rename|rmdir|mkdir|copyFile|createWriteStream|symlink|truncate|utimes|chmod)\b|\.rm\s*\(/);
    }
  });
});
