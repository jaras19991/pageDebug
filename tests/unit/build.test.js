import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, cliOptions, devConfigModule } from '../../scripts/build.mjs';
import { collectReachable } from '../../scripts/lib/reachability.mjs';
import { TARGET_KEYS } from '../../scripts/lib/manifest.mjs';
import { buildToTmp } from './helpers/build-to-tmp.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'src');
const TARGETS = ['chrome', 'firefox'];
// Raised from 500 KB in E4-T9: E4 D1 ships summary/query/metrics/screenshot-notes/dev-options to the extension (export.js),
// and every dist file is reachable and needed (viewer/MCP-only modules stay out). Unpacked size is only a sanity guard;
// the binding budget is the shipped zip (size-budget.test.js: ≤ 0.5.0 zip + 30 KB).
const MAX_TARGET_BYTES = 600 * 1024;

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
  }, 30_000); // two full builds; >5 s on /mnt/c (E4 test phase, timeout only)

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

  it('each target is under 600 KB', async () => {
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

// E4-D4c: a minimal extension whose background imports lib/dev-config.js, so these tests do not depend on
// which real module (background, popup) imports dev-options.js.
async function devConfigFixture() {
  const root = await mkdtemp(join(tmpdir(), 'pds-devcfg-'));
  const src = join(root, 'src');
  await mkdir(join(src, 'lib'), { recursive: true });
  await writeFile(join(src, 'manifest.base.json'), JSON.stringify({ manifest_version: 3, name: 'Fixture', version: '1.0.0' }));
  await writeFile(join(src, 'manifest.chrome.json'), JSON.stringify({ background: { service_worker: 'background.js', type: 'module' } }));
  await writeFile(join(src, 'manifest.firefox.json'), JSON.stringify({ background: { scripts: ['background.js'], type: 'module' } }));
  await writeFile(join(src, 'background.js'), "import { BUILT_IN_DEV_CONFIG } from './lib/dev-config.js';\nvoid BUILT_IN_DEV_CONFIG;\n");
  await copyFile(join(SRC, 'lib', 'dev-config.js'), join(src, 'lib', 'dev-config.js'));
  const outDir = join(root, 'dist');
  return { root, src, outDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function importModule(file) {
  const { BUILT_IN_DEV_CONFIG } = await import(`data:text/javascript,${encodeURIComponent(await readFile(file, 'utf8'))}`);
  return BUILT_IN_DEV_CONFIG;
}

describe('build: developer configuration (E4-D4c)', () => {
  it('without config dist/lib/dev-config.js equals src byte for byte', async () => {
    const fx = await devConfigFixture();
    try {
      await build({ srcDir: fx.src, outDir: fx.outDir });
      const source = await readFile(join(fx.src, 'lib', 'dev-config.js'));
      for (const t of TARGETS) {
        expect((await readFile(join(fx.outDir, t, 'lib', 'dev-config.js'))).equals(source), t).toBe(true);
      }
    } finally {
      await fx.cleanup();
    }
  });

  it('with --config both targets get identical dev-config.js with the given disabledRules (AC-6.1)', async () => {
    const fx = await devConfigFixture();
    try {
      const config = join(fx.root, 'team.json');
      await writeFile(config, JSON.stringify({ disabledRules: ['html-structure', 'email'] }));
      await build({ srcDir: fx.src, outDir: fx.outDir, devConfigPath: config, warn: () => {} });
      const [c, f] = await Promise.all(TARGETS.map((t) => readFile(join(fx.outDir, t, 'lib', 'dev-config.js'), 'utf8')));
      expect(f).toBe(c);
      expect(c).toBe(
        '// GENERATED by scripts/build.mjs from team.json\n' +
          'export const BUILT_IN_DEV_CONFIG = Object.freeze({"disabledRules":["email","html-structure"]});\n',
      );
      expect(c).not.toContain(fx.root); // no local path in the extension
      const value = await importModule(join(fx.outDir, 'chrome', 'lib', 'dev-config.js'));
      expect(value).toEqual({ disabledRules: ['email', 'html-structure'] });
      expect(Object.isFrozen(value)).toBe(true);
      // The source module is untouched.
      expect(await readFile(join(fx.src, 'lib', 'dev-config.js'), 'utf8')).toBe(await readFile(join(SRC, 'lib', 'dev-config.js'), 'utf8'));
    } finally {
      await fx.cleanup();
    }
  });

  it('invalid JSON fails the build naming the file; jwt in config → warning, build ok (AC-6.3)', async () => {
    const fx = await devConfigFixture();
    try {
      const bad = join(fx.root, 'broken.json');
      await writeFile(bad, '{ "disabledRules": [ "email", }');
      await expect(build({ srcDir: fx.src, outDir: fx.outDir, devConfigPath: bad })).rejects.toThrow(/broken\.json/);
      await expect(build({ srcDir: fx.src, outDir: fx.outDir, devConfigPath: join(fx.root, 'missing.json') })).rejects.toThrow(/missing\.json/);

      const jwt = join(fx.root, 'jwt.json');
      await writeFile(jwt, JSON.stringify({ disabledRules: ['jwt', 'phone'], sendTo: 'x' }));
      const warnings = [];
      await build({ srcDir: fx.src, outDir: fx.outDir, devConfigPath: jwt, warn: (m) => warnings.push(m) });
      expect(warnings.join('\n')).toMatch(/jwt\.json/);
      expect(warnings.join('\n')).toMatch(/disabledRules: jwt/);
      expect(warnings.join('\n')).toMatch(/sendTo/);
      const value = await importModule(join(fx.outDir, 'firefox', 'lib', 'dev-config.js'));
      expect(value).toEqual({ disabledRules: ['phone'] });
    } finally {
      await fx.cleanup();
    }
  });

  it('config given but lib/dev-config.js not part of a target → build error (never silently ignored)', async () => {
    const fx = await devConfigFixture();
    try {
      await writeFile(join(fx.src, 'background.js'), 'void 0;\n');
      const config = join(fx.root, 'team.json');
      await writeFile(config, JSON.stringify({ disabledRules: ['email'] }));
      await expect(build({ srcDir: fx.src, outDir: fx.outDir, devConfigPath: config })).rejects.toThrow(/dev-config\.js/);
    } finally {
      await fx.cleanup();
    }
  });

  it('no implicit config: pds.config.json in repo root is ignored without --config (risk 6)', async () => {
    const fx = await devConfigFixture();
    try {
      const evil = JSON.stringify({ disabledRules: ['email', 'phone', 'html-structure'] });
      await writeFile(join(fx.root, 'pds.config.json'), evil);
      await writeFile(join(fx.src, 'pds.config.json'), evil);
      await build({ srcDir: fx.src, outDir: fx.outDir });
      for (const t of TARGETS) {
        expect(await importModule(join(fx.outDir, t, 'lib', 'dev-config.js'))).toEqual({ disabledRules: [] });
        expect(existsSync(join(fx.outDir, t, 'pds.config.json')), t).toBe(false);
      }
      expect(cliOptions([], {})).toEqual({ devConfigPath: undefined });
      const script = await readFile(join(ROOT, 'scripts', 'build.mjs'), 'utf8');
      expect(script).not.toMatch(/pds\.config\.json/);
      expect(await readFile(join(ROOT, '.gitignore'), 'utf8')).toMatch(/^pds\.config\.json$/m);
      const example = JSON.parse(await readFile(join(ROOT, 'pds.config.example.json'), 'utf8'));
      expect(example).toEqual({ disabledRules: [] });
    } finally {
      await fx.cleanup();
    }
  });

  it('CLI: --config <file>, --config=<file> and PDS_CONFIG, the flag wins', () => {
    expect(cliOptions(['--config', 'a.json'], {})).toEqual({ devConfigPath: resolve('a.json') });
    expect(cliOptions(['--config=b.json'], {})).toEqual({ devConfigPath: resolve('b.json') });
    expect(cliOptions([], { PDS_CONFIG: 'c.json' })).toEqual({ devConfigPath: resolve('c.json') });
    expect(cliOptions(['--config', 'a.json'], { PDS_CONFIG: 'c.json' })).toEqual({ devConfigPath: resolve('a.json') });
    expect(() => cliOptions(['--config'], {})).toThrow(/--config/);
    expect(() => cliOptions(['--bogus'], {})).toThrow(/--bogus/);
  });

  it('devConfigModule escapes nothing executable: only sanitized rule names reach the module', () => {
    const text = devConfigModule({ disabledRules: ['email', '*/alert(1)//', 'x\u2028'] }, 'a.json');
    expect(text).toBe('// GENERATED by scripts/build.mjs from a.json\nexport const BUILT_IN_DEV_CONFIG = Object.freeze({"disabledRules":["email"]});\n');
    expect(devConfigModule({}, 'line\nbreak.json').split('\n')[0]).toBe('// GENERATED by scripts/build.mjs from line break.json');
  });
});
