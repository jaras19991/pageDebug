import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../scripts/build.mjs';
import { collectReachable } from '../../scripts/lib/reachability.mjs';
import { TARGET_KEYS } from '../../scripts/lib/manifest.mjs';
import { buildToTmp } from './helpers/build-to-tmp.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'src');
const TARGETS = ['chrome', 'firefox'];
const MAX_TARGET_BYTES = 500 * 1024;

// Sorted POSIX paths of every file under dir.
async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

async function hashTree(dir) {
  const out = {};
  for (const rel of await listFiles(dir)) {
    out[rel] = createHash('sha256').update(await readFile(join(dir, rel))).digest('hex');
  }
  return out;
}

const readManifest = async (dir) => JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));

let built;
beforeAll(async () => { built = await buildToTmp(); });
afterAll(async () => { await built?.cleanup(); });

const targetDir = (t) => join(built.outDir, t);

describe('build', () => {
  it('build is deterministic', async () => {
    const second = await buildToTmp();
    try {
      for (const t of TARGETS) {
        const a = await hashTree(targetDir(t));
        const b = await hashTree(join(second.outDir, t));
        expect(Object.keys(b)).toEqual(Object.keys(a));
        expect(b).toEqual(a);
      }
      expect(second.files).toEqual(built.files);
    } finally {
      await second.cleanup();
    }
  });

  it('build removes stale files', async () => {
    const tmp = await buildToTmp();
    try {
      const junk = join(tmp.outDir, 'chrome', 'stale.txt');
      await writeFile(junk, 'old');
      await build({ outDir: tmp.outDir });
      expect(existsSync(junk)).toBe(false);
    } finally {
      await tmp.cleanup();
    }
  });

  it('returns the file list per target, manifest included', async () => {
    for (const t of TARGETS) {
      expect(built.files[t]).toEqual(await listFiles(targetDir(t)));
      expect(built.files[t]).toContain('manifest.json');
    }
  });

  it('both targets contain the background module, its lib imports, the popup modules and the registered content files', async () => {
    const expected = [
      'background.js',
      'lib/content-scripts.js',
      'lib/origin.js',
      'lib/package.js',
      'lib/recording.js',
      'lib/save.js',
      'lib/session-store.js',
      'popup/controller.js',
      'popup/view.js',
      'popup/target.js',
      'content/main-world.js',
      'content/isolated-world.js',
    ];
    for (const t of TARGETS) {
      expect(built.files[t], t).toEqual(expect.arrayContaining(expected));
    }
  });

  it('registered content files exist in both dist targets', async () => {
    const { scriptsFor } = await import('../../src/lib/content-scripts.js');
    const files = scriptsFor('https://example.com/*').flatMap((s) => s.js.map((p) => p.replace(/^\//, '')));
    expect(files).toHaveLength(2);
    for (const t of TARGETS) {
      for (const f of files) expect(existsSync(join(targetDir(t), f)), `${t}/${f}`).toBe(true);
    }
  });

  it('writes manifest.json as 2-space JSON with LF and trailing newline', async () => {
    for (const t of TARGETS) {
      const text = await readFile(join(targetDir(t), 'manifest.json'), 'utf8');
      expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2) + '\n');
      expect(text).not.toContain('\r');
    }
  });

  it('every dist file is reachable and every reference exists', async () => {
    for (const t of TARGETS) {
      // collectReachable throws on a missing reference, so this covers both directions.
      const reachable = await collectReachable(targetDir(t));
      expect(await listFiles(targetDir(t))).toEqual(['manifest.json', ...reachable].sort());
    }
  });

  it('dist contains no forbidden files', async () => {
    const forbidden = [
      /(^|\/)node_modules\//,
      /\.pem$/i,
      /\.crx$/i,
      /\.zip$/i,
      /(^|\/)package(-lock)?[^/]*\.json$/i,
      /(^|\/)logo[^/]*\.png$/i,
      /(^|\/)console-snapshot\.js$/,
      /(^|\/)standalone\//,
      /(^|\/)tests?\//,
      /(^|\/)scripts\//,
      /\.test\.js$/,
      /\.ps1$/i,
      /\.mjs$/i,
    ];
    for (const t of TARGETS) {
      for (const file of await listFiles(targetDir(t))) {
        for (const re of forbidden) expect(file, `${t}/${file}`).not.toMatch(re);
      }
    }
  });

  it('each target is under 500 KB', async () => {
    for (const t of TARGETS) {
      let total = 0;
      for (const f of await listFiles(targetDir(t))) total += (await stat(join(targetDir(t), f))).size;
      expect(total, t).toBeLessThan(MAX_TARGET_BYTES);
    }
  });

  it('inject.js absent in src and both targets', async () => {
    expect((await listFiles(SRC)).filter((f) => posix.basename(f) === 'inject.js')).toEqual([]);
    for (const t of TARGETS) {
      expect((await listFiles(targetDir(t))).filter((f) => posix.basename(f) === 'inject.js')).toEqual([]);
    }
  });

  it('no remote code', async () => {
    const patterns = [
      /<script\b[^>]*\ssrc\s*=\s*["']?\s*(?:https?:)?\/\//i,
      /\bimport\s*\(\s*["'`]\s*(?:https?:)?\/\//i,
      /\bfrom\s*["']\s*(?:https?:)?\/\//i,
      /\bimport\s*["']\s*(?:https?:)?\/\//i,
      /\beval\s*\(/,
      /\bnew\s+Function\s*\(/,
    ];
    for (const t of TARGETS) {
      for (const f of await listFiles(targetDir(t))) {
        if (!/\.(?:js|mjs|html|json|css)$/i.test(f)) continue;
        const text = await readFile(join(targetDir(t), f), 'utf8');
        for (const re of patterns) expect(text, `${t}/${f}`).not.toMatch(re);
      }
    }
  });

  it('dist manifests: same permission rules', async () => {
    // AC-3.1: no (broad) host_permissions, no WAR; host access only via the exact optional set.
    for (const t of TARGETS) {
      const m = await readManifest(targetDir(t));
      expect(m).not.toHaveProperty('web_accessible_resources');
      expect(m.host_permissions ?? [], t).toEqual([]);
      expect([...(m.optional_host_permissions ?? [])].sort(), t).toEqual(['file:///*', 'http://*/*', 'https://*/*']);
      for (const p of m.permissions ?? []) expect(['activeTab', 'scripting', 'storage', 'downloads']).toContain(p);
    }
  });

  it('dist manifests differ only in target keys', async () => {
    const strip = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => !TARGET_KEYS.includes(k)));
    const [c, f] = await Promise.all(TARGETS.map((t) => readManifest(targetDir(t))));
    expect(strip(f)).toEqual(strip(c));
    expect(f.browser_specific_settings?.gecko?.strict_min_version).toBe('128.0');
    expect(c).toHaveProperty('minimum_chrome_version');
    expect(f).not.toHaveProperty('minimum_chrome_version');
    expect(c).not.toHaveProperty('browser_specific_settings');
  });

  it('no callbacks or importScripts in src', async () => {
    const callback = /chrome\.\w+\.\w+\([^)]*\b(function|=>)/;
    for (const f of await listFiles(SRC)) {
      if (!/\.(?:js|mjs)$/.test(f)) continue;
      const text = await readFile(join(SRC, f), 'utf8');
      expect(text, f).not.toMatch(/\bimportScripts\b/);
      expect(text, f).not.toMatch(callback);
    }
  });
});
