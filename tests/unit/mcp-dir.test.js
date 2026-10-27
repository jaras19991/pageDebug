// @vitest-environment node
// E4-T4b (D6): the MCP snapshots directory — list of packages, safe ids (no way out of the directory,
// symlinks skipped), 64 MB limit, cache by (mtimeMs, size), read-only file system access (AC-5.2, AC-5.8).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as realFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createSnapshotDir, SnapshotDirError, DIR_LIMITS, DIR_ERRORS_PL } from '../../mcp/snapshots-dir.js';
import { readPackage, READ_ERRORS_PL } from '../../src/lib/package-reader.js';
import { createZip } from '../../src/lib/zip.js';
import { exportPackage } from '../../src/lib/export.js';

const enc = new TextEncoder();
const readFixture = async (v) => JSON.parse(await realFs.readFile(new URL(`../fixtures/snapshots/v${v}.json`, import.meta.url), 'utf8'));

const STARTED = Date.UTC(2026, 9, 26, 8, 0, 0);
const DATE = new Date(2026, 9, 26, 14, 5, 9);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

// Smallest exportPackage input (shape as in package-reader.test.js).
function exportInput() {
  return {
    meta: {
      extensionVersion: '0.6.0', source: 'extension', startedAt: STARTED, collectedAt: STARTED + 60_000, stopReason: null,
      screenshots: [{ epochMs: STARTED + 35_000, mime: 'image/jpeg', width: 1, height: 1, bytes: JPEG.length,
        dataUrl: `data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`, maskedFields: 0 }],
    },
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

// File system spy: every call recorded with its arguments; any property other than the four read calls is recorded too.
function spyFs() {
  const calls = [];
  const accessed = new Set();
  const fs = new Proxy(realFs, {
    get(target, prop) {
      accessed.add(String(prop));
      const value = target[prop];
      if (typeof value !== 'function') return value;
      return (...args) => {
        calls.push({ fn: String(prop), path: String(args[0]) });
        return value.apply(target, args);
      };
    },
  });
  return { fs, calls, accessed };
}

let base; // parent of the snapshots directory (holds the "outside" file)
let dir; // the snapshots directory
let dirReal;
let symlinkOk = false;
let exported;

beforeAll(async () => {
  base = await realFs.mkdtemp(join(tmpdir(), 'pds-mcp-dir-'));
  dir = join(base, 'snapshots');
  await realFs.mkdir(dir);
  dirReal = await realFs.realpath(dir);

  exported = await exportPackage({ input: exportInput(), date: DATE });
  await realFs.writeFile(join(dir, exported.fileName), exported.bytes);

  const v4 = await readFixture(4);
  v4.collectedAt = '2026-03-01T10:00:00.000Z';
  const v4zip = await createZip([{ name: 'snapshot.json', data: enc.encode(JSON.stringify(v4)), compress: true }]);
  await realFs.writeFile(join(dir, 'v4-fixture.zip'), v4zip.bytes);

  const v3 = await readFixture(3);
  v3.collectedAt = '2026-02-01T10:00:00.000Z';
  await realFs.writeFile(join(dir, 'v3.json'), JSON.stringify(v3));

  const v2 = await readFixture(2);
  v2.collectedAt = '2026-01-01T10:00:00.000Z';
  await realFs.writeFile(join(dir, 'v2.json'), JSON.stringify(v2));

  await realFs.writeFile(join(dir, 'broken.zip'), Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]));
  const old = new Date(Date.UTC(2025, 11, 1)); // no collectedAt: sorted by mtime, older than every package
  await realFs.utimes(join(dir, 'broken.zip'), old, old);
  await realFs.writeFile(join(dir, 'notes.txt'), 'not a package');
  await realFs.writeFile(join(dir, '.hidden.json'), JSON.stringify(v2));
  await realFs.mkdir(join(dir, 'sub.json'));
  await realFs.writeFile(join(dir, 'sub.json', 'inner.json'), JSON.stringify(v2));

  await realFs.writeFile(join(base, 'outside.json'), JSON.stringify(v2));
  try {
    await realFs.symlink(join(base, 'outside.json'), join(dir, 'link.json'));
    symlinkOk = true;
  } catch {
    symlinkOk = false; // e.g. Windows without the privilege: the symlink case is skipped
  }
});

afterAll(async () => {
  if (base) await realFs.rm(base, { recursive: true, force: true });
});

describe('createSnapshotDir.list (AC-5.2)', () => {
  it('lists zip and JSON packages: id, file, host, collectedAt, schemaVersion, overview; newest first; corrupt marked; list complete', async () => {
    const snapshots = createSnapshotDir(dir, { readPackage });
    const { items, total, shown } = await snapshots.list();
    const ids = items.map((e) => e.id);
    expect(ids).toEqual([exported.fileName, 'v4-fixture.zip', 'v3.json', 'v2.json', 'broken.zip']);
    expect(total).toBe(5);
    expect(shown).toBe(5);

    const [fresh, v4, v3, v2, broken] = items;
    expect(fresh).toMatchObject({ file: exported.fileName, format: 'zip', host: 'app.example.test', schemaVersion: 4 });
    expect(fresh.collectedAt).toBe(exported.snapshot.collectedAt);
    expect(fresh.overview).toEqual(exported.snapshot.overview);
    expect(v4).toMatchObject({ file: 'v4-fixture.zip', host: '127.0.0.1', schemaVersion: 4, collectedAt: '2026-03-01T10:00:00.000Z' });
    expect(v4.overview).toEqual({ runtimeErrors: 2, consoleErrors: 1, failedRequests: 3, steps: 10, poorVitals: 1, screenshot: true });
    expect(v3).toMatchObject({ file: 'v3.json', format: 'json', schemaVersion: 3, collectedAt: '2026-02-01T10:00:00.000Z' });
    expect(v3.overview.steps).toBe(9);
    expect(v2).toMatchObject({ file: 'v2.json', format: 'json', schemaVersion: 2 });
    expect(typeof v2.overview.runtimeErrors).toBe('number');
    expect(broken).toEqual({ id: 'broken.zip', file: 'broken.zip', error: READ_ERRORS_PL.corrupt, modifiedAt: broken.modifiedAt });
    for (const entry of items) expect(JSON.stringify(entry)).not.toContain(base); // no absolute paths leak
  });

  it(`shows at most ${DIR_LIMITS.maxListed} newest, total counts all`, async () => {
    const many = join(base, 'many');
    await realFs.mkdir(many);
    const v4 = await readFixture(4);
    const n = DIR_LIMITS.maxListed + 3;
    for (let i = 0; i < n; i++) {
      v4.collectedAt = new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();
      await realFs.writeFile(join(many, `p${String(i).padStart(3, '0')}.json`), JSON.stringify(v4));
    }
    const { items, total, shown } = await createSnapshotDir(many, { readPackage }).list();
    expect(total).toBe(n);
    expect(shown).toBe(DIR_LIMITS.maxListed);
    expect(items).toHaveLength(DIR_LIMITS.maxListed);
    expect(items[0].id).toBe(`p${n - 1}.json`);
  }, 60_000);

  it('second list uses cache: readPackage called once per unchanged file, again after a change', async () => {
    const read = vi.fn(readPackage);
    const snapshots = createSnapshotDir(dir, { readPackage: read });
    await snapshots.list();
    expect(read).toHaveBeenCalledTimes(5);
    await snapshots.list();
    expect(read).toHaveBeenCalledTimes(5);
    await snapshots.open('v3.json');
    expect(read).toHaveBeenCalledTimes(5);

    const v2 = await readFixture(2);
    v2.collectedAt = '2026-01-02T10:00:00.000Z';
    v2.notes = ['changed size'];
    await realFs.writeFile(join(dir, 'v2.json'), JSON.stringify(v2));
    const { items } = await snapshots.list();
    expect(read).toHaveBeenCalledTimes(6);
    expect(items.find((e) => e.id === 'v2.json').collectedAt).toBe('2026-01-02T10:00:00.000Z');
  });

  it('a missing directory → SnapshotDirError, not a crash', async () => {
    await expect(createSnapshotDir(join(base, 'nope'), { readPackage }).list()).rejects.toBeInstanceOf(SnapshotDirError);
  });
});

describe('createSnapshotDir.open (AC-5.8)', () => {
  it('opens a package by file name → readPackage result with the id', async () => {
    const out = await createSnapshotDir(dir, { readPackage }).open(exported.fileName);
    expect(out.id).toBe(exported.fileName);
    expect(out.format).toBe('zip');
    expect(out.snapshot).toEqual(exported.snapshot);
  });

  const badIds = ['../outside.json', '..', '.', join(tmpdir(), 'outside.json'), '/etc/passwd', 'C:\\x.json', 'C:x.json', 'a/b.json', 'a\\b.json',
    'v2.json\0', '', 'notes.txt', '.hidden.json', 'x'.repeat(300) + '.json', 42, null, { id: 'v2.json' }];
  it.each(badIds.map((id) => [JSON.stringify(id)?.slice(0, 40), id]))('bad id %s → SnapshotDirError bad-id, no fs call', async (_label, id) => {
    const { fs, calls } = spyFs();
    const err = await createSnapshotDir(dir, { readPackage, fs }).open(id).catch((e) => e);
    expect(err).toBeInstanceOf(SnapshotDirError);
    expect(err.code).toBe('bad-id');
    expect(err.message).toBe(DIR_ERRORS_PL['bad-id']);
    expect(calls.filter((c) => c.fn !== 'realpath')).toEqual([]);
  });

  it('missing file / directory / corrupt package → SnapshotDirError with a Polish message', async () => {
    const snapshots = createSnapshotDir(dir, { readPackage });
    await expect(snapshots.open('missing.json')).rejects.toMatchObject({ code: 'not-found', message: DIR_ERRORS_PL['not-found'] });
    await expect(snapshots.open('sub.json')).rejects.toMatchObject({ code: 'not-found' });
    await expect(snapshots.open('broken.zip')).rejects.toMatchObject({ code: 'corrupt', message: READ_ERRORS_PL.corrupt });
  });

  it('symlink pointing outside → error, never listed; nothing read outside the directory', async (ctx) => {
    if (!symlinkOk) ctx.skip();
    const { fs, calls } = spyFs();
    const read = vi.fn(readPackage);
    const snapshots = createSnapshotDir(dir, { readPackage: read, fs });
    const { items } = await snapshots.list();
    expect(items.map((e) => e.id)).not.toContain('link.json');
    await expect(snapshots.open('link.json')).rejects.toMatchObject({ code: 'not-found' });
    for (const c of calls.filter((x) => x.fn !== 'realpath')) {
      expect(c.path === dirReal || c.path.startsWith(dirReal + sep)).toBe(true);
    }
    expect(calls.some((c) => c.fn === 'readFile' && c.path.includes('outside'))).toBe(false);
  });

  it('list() checks realpath like open(): a symlink reported as a file by readdir is still skipped (E4-FIX2)', async (ctx) => {
    if (!symlinkOk) ctx.skip();
    const { fs, calls } = spyFs();
    // readdir that loses the symlink type (a race, a file system without d_type): every entry looks like a file.
    const lyingFs = new Proxy(fs, {
      get(target, prop) {
        if (prop !== 'readdir') return target[prop];
        return async (...args) => (await target.readdir(...args)).map((d) => (d.name === 'link.json'
          ? { name: d.name, isFile: () => true, isSymbolicLink: () => false, isDirectory: () => false } : d));
      },
    });
    const snapshots = createSnapshotDir(dir, { readPackage, fs: lyingFs });
    const { items, total } = await snapshots.list();
    expect(items.map((e) => e.id)).not.toContain('link.json');
    expect(items.map((e) => e.id)).toContain('v3.json');
    expect(total).toBe(items.length);
    expect(calls.some((c) => c.fn === 'readFile' && c.path.includes('outside'))).toBe(false);
    expect(calls.some((c) => c.fn === 'stat' && c.path.endsWith('link.json'))).toBe(false);
  });

  it(`file over ${DIR_LIMITS.maxFileBytes / 1024 / 1024} MB → too-large without reading it`, async () => {
    const { fs, calls } = spyFs();
    const bigFs = new Proxy(fs, {
      get(target, prop) {
        if (prop !== 'stat') return target[prop];
        return async (p, ...rest) => {
          const st = await target.stat(p, ...rest);
          return p.endsWith('v3.json') ? { ...st, isFile: () => true, size: DIR_LIMITS.maxFileBytes + 1, mtimeMs: st.mtimeMs } : st;
        };
      },
    });
    const snapshots = createSnapshotDir(dir, { readPackage, fs: bigFs });
    await expect(snapshots.open('v3.json')).rejects.toMatchObject({ code: 'too-large' });
    const { items } = await snapshots.list();
    expect(items.find((e) => e.id === 'v3.json').error).toBe(DIR_ERRORS_PL['too-large']);
    expect(calls.some((c) => c.fn === 'readFile' && c.path.endsWith('v3.json'))).toBe(false);
  });

  it('uses only readdir/stat/realpath/readFile: no write, unlink, rename, mkdir, open', async () => {
    const { fs, accessed } = spyFs();
    const snapshots = createSnapshotDir(dir, { readPackage, fs });
    await snapshots.list();
    await snapshots.open('v3.json');
    await snapshots.open('../x').catch(() => {});
    await snapshots.open('broken.zip').catch(() => {});
    expect([...accessed].filter((p) => !['readdir', 'stat', 'realpath', 'readFile', 'then'].includes(p))).toEqual([]);
  });
});
