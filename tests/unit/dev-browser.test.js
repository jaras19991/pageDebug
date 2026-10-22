import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runOptions, UsageError, BROWSERS, DEFAULT_URL } from '../../scripts/dev-browser.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'dev-browser.mjs');

describe('dev-browser parseArgs', () => {
  it('parseArgs accepts chrome and firefox', () => {
    expect(parseArgs(['chrome'])).toEqual({ browser: 'chrome', url: DEFAULT_URL });
    expect(parseArgs(['firefox', '--url', 'https://a.test/'])).toEqual({ browser: 'firefox', url: 'https://a.test/' });
    expect(parseArgs(['--browser', 'firefox'])).toEqual({ browser: 'firefox', url: DEFAULT_URL });
    expect(parseArgs(['--url=https://b.test/', '--browser=chrome'])).toEqual({ browser: 'chrome', url: 'https://b.test/' });
    expect(BROWSERS).toEqual(['chrome', 'firefox']);
  });

  it('parseArgs rejects unknown browser with allowed values in message', () => {
    expect(() => parseArgs(['opera'])).toThrow(UsageError);
    expect(() => parseArgs(['opera'])).toThrow('Unknown browser "opera". Allowed: chrome, firefox');
    expect(() => parseArgs(['--browser', 'Chrome'])).toThrow('Allowed: chrome, firefox');
  });

  it('parseArgs rejects missing browser, missing --url value and extra arguments', () => {
    expect(() => parseArgs([])).toThrow(/Allowed: chrome, firefox/);
    expect(() => parseArgs(['chrome', '--url'])).toThrow(UsageError);
    expect(() => parseArgs(['chrome', 'firefox'])).toThrow(UsageError);
    expect(() => parseArgs(['chrome', '--verbose'])).toThrow(UsageError);
  });
});

describe('dev-browser runOptions', () => {
  it('maps browser to web-ext target and dist/<browser> source dir', () => {
    const chrome = runOptions({ browser: 'chrome', url: 'https://a.test/' }, { env: {} });
    expect(chrome).toEqual({ sourceDir: resolve(ROOT, 'dist', 'chrome'), target: ['chromium'], startUrl: ['https://a.test/'] });
    const firefox = runOptions({ browser: 'firefox', url: 'https://a.test/' }, { env: {} });
    expect(firefox).toEqual({ sourceDir: resolve(ROOT, 'dist', 'firefox'), target: ['firefox-desktop'], startUrl: ['https://a.test/'] });
  });

  it('uses PDS_CHROMIUM_BINARY for chrome only', () => {
    const env = { PDS_CHROMIUM_BINARY: 'C:\\chromium\\chrome.exe' };
    expect(runOptions({ browser: 'chrome', url: DEFAULT_URL }, { env }).chromiumBinary).toBe('C:\\chromium\\chrome.exe');
    expect(runOptions({ browser: 'firefox', url: DEFAULT_URL }, { env })).not.toHaveProperty('chromiumBinary');
  });
});

describe('dev-browser cli', () => {
  it('cli exits with code 2 for unknown browser', () => {
    const r = spawnSync(process.execPath, [SCRIPT, 'opera'], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Unknown browser "opera". Allowed: chrome, firefox');
  });

  it('cli does not build when args invalid', () => {
    const manifest = join(ROOT, 'dist', 'chrome', 'manifest.json');
    const before = existsSync(manifest) ? statSync(manifest).mtimeMs : null;
    const r = spawnSync(process.execPath, [SCRIPT, '--browser', 'safari'], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
    expect(r.status).toBe(2);
    expect(r.stdout).not.toMatch(/dist\//);
    const after = existsSync(manifest) ? statSync(manifest).mtimeMs : null;
    expect(after).toBe(before);
  });
});

describe('dev-browser.ps1 -Pack', () => {
  // E0-F1: -Pack delegates to `npm run pack` instead of its own file filter + Compress-Archive
  // (an invalid `-notmatch` regex made it throw; PS 5.1 Compress-Archive writes `\` entry names).
  const ps1 = readFileSync(join(ROOT, 'scripts', 'dev-browser.ps1'), 'utf8');

  it('delegates packing to npm run pack and keeps ValidateSet', () => {
    expect(ps1).toMatch(/npm run pack/);
    expect(ps1).toMatch(/ValidateSet\("chrome", "firefox"\)/);
    expect(ps1).not.toMatch(/Compress-Archive/);
    expect(ps1).not.toMatch(/-notmatch/);
  });

  it('prints recipient instructions for both browsers', () => {
    expect(ps1).toMatch(/chrome:\/\/extensions/);
    expect(ps1).toMatch(/about:debugging/);
    expect(ps1).toMatch(/page-debug-snapshot-\$Browser-/);
  });
});
