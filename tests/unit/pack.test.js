import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { pack, packCliOptions } from '../../scripts/pack.mjs';

const TARGETS = ['chrome', 'firefox'];
// AC-4.3: nothing of this may end up in a target, so not in its zip either.
const FORBIDDEN = [
  /(^|\/)node_modules\//, /\.pem$/, /\.crx$/, /\.zip$/, /(^|\/)package(-lock)?\.json$/,
  /(^|\/)logo[^/]*\.png$/, /(^|\/)console-snapshot\.js$/, /(^|\/)tests?\//, /(^|\/)scripts\//,
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Sorted POSIX paths of every file under dir.
async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

const unzipFile = async (file) => unzipSync(new Uint8Array(await readFile(file)));
const zipFor = (zips, t) => zips.find((z) => basename(z).includes(`-${t}-`));

let distDir;
let zips;
beforeAll(async () => {
  distDir = await mkdtemp(join(tmpdir(), 'pds-pack-'));
  zips = await pack({ distDir });
});
afterAll(async () => { await rm(distDir, { recursive: true, force: true }); });

describe('pack', () => {
  it('creates exactly two zips named with target and version', async () => {
    expect(zips).toHaveLength(2);
    const onDisk = (await readdir(distDir)).filter((f) => f.endsWith('.zip')).sort();
    expect(onDisk).toHaveLength(2);
    for (const t of TARGETS) {
      const { version } = JSON.parse(await readFile(join(distDir, t, 'manifest.json'), 'utf8'));
      expect(onDisk).toContain(`page-debug-snapshot-${t}-${version}.zip`);
      expect(basename(zipFor(zips, t))).toBe(`page-debug-snapshot-${t}-${version}.zip`);
    }
  });

  it('zip has manifest.json at root', async () => {
    for (const t of TARGETS) {
      const entries = await unzipFile(zipFor(zips, t));
      expect(Object.keys(entries)).toContain('manifest.json');
      expect(Object.keys(entries).every((name) => !name.includes('\\'))).toBe(true);
    }
  });

  it('unzipped content equals dist/<target> byte for byte', async () => {
    for (const t of TARGETS) {
      const entries = await unzipFile(zipFor(zips, t));
      const files = await listFiles(join(distDir, t));
      expect(Object.keys(entries).sort()).toEqual(files);
      for (const rel of files) {
        expect(sha256(entries[rel]), rel).toBe(sha256(await readFile(join(distDir, t, ...rel.split('/')))));
      }
    }
  });

  it('pack is deterministic', async () => {
    const before = {};
    for (const z of zips) before[basename(z)] = sha256(await readFile(z));
    const second = await mkdtemp(join(tmpdir(), 'pds-pack-'));
    try {
      const again = await pack({ distDir: second });
      for (const z of again) expect(sha256(await readFile(z)), basename(z)).toBe(before[basename(z)]);
    } finally {
      await rm(second, { recursive: true, force: true });
    }
  });

  it('zip size ≤ target dir size', async () => {
    for (const t of TARGETS) {
      let dirBytes = 0;
      for (const rel of await listFiles(join(distDir, t))) dirBytes += (await stat(join(distDir, t, rel))).size;
      expect((await stat(zipFor(zips, t))).size).toBeLessThanOrEqual(dirBytes);
    }
  });

  it('zip contains no forbidden files', async () => {
    for (const t of TARGETS) {
      for (const name of Object.keys(await unzipFile(zipFor(zips, t)))) {
        for (const re of FORBIDDEN) expect(name, `${t}: ${name}`).not.toMatch(re);
      }
    }
  });
});

describe('pack with a developer configuration (E4-FIX2)', () => {
  it('CLI: only an explicit --config; PDS_CONFIG in env is ignored', () => {
    const saved = process.env.PDS_CONFIG;
    process.env.PDS_CONFIG = 'from-env.json';
    try {
      expect(packCliOptions([])).toEqual({ devConfigPath: undefined });
      expect(packCliOptions(['--config', 'a.json']).devConfigPath).toMatch(/a\.json$/);
      expect(() => packCliOptions(['--config'])).toThrow(/--config/);
    } finally {
      if (saved === undefined) delete process.env.PDS_CONFIG;
      else process.env.PDS_CONFIG = saved;
    }
  });

  it('--config: a warning and zips named …-devconfig.zip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pds-pack-cfg-'));
    try {
      const config = join(dir, 'team.json');
      await writeFile(config, JSON.stringify({ disabledRules: ['email'] }));
      const warnings = [];
      const out = await pack({ distDir: join(dir, 'dist'), devConfigPath: config, warn: (msg) => warnings.push(msg) });
      expect(out).toHaveLength(2);
      for (const t of TARGETS) {
        const { version } = JSON.parse(await readFile(join(dir, 'dist', t, 'manifest.json'), 'utf8'));
        expect(basename(zipFor(out, t))).toBe(`page-debug-snapshot-${t}-${version}-devconfig.zip`);
      }
      expect(warnings.join('\n')).toMatch(/team\.json/);
      expect(warnings.join('\n')).toMatch(/developer configuration/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
