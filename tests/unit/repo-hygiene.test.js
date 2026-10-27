import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forbiddenTracked, forbiddenInHistory } from '../../scripts/check-repo.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const thisFile = fileURLToPath(import.meta.url);

describe('forbiddenTracked', () => {
  it('flags pem, crx, xpi, zip, node_modules, snapshots, test output, settings.local.json, logo pngs', () => {
    const bad = [
      'page-debug-extension.pem',
      'keys/other.PEM',
      'page-debug-extension.crx',
      'build/addon.xpi',
      'page-debug-extension.zip',
      'dist/page-debug-snapshot-chrome.zip',
      'dist/chrome/manifest.json',
      'node_modules/vitest/package.json',
      'tools/node_modules/x/index.js',
      'page-debug-snapshot-1792487181606.json',
      'page-debug-snapshot-1792487181606.zip',
      'test-results/run/trace.zip',
      'test-results/.last-run.json',
      'playwright-report/index.html',
      'coverage/lcov.info',
      '.claude/settings.local.json',
      'src/icons/logo.png',
      'src/icons/logo-640.png',
      'page-debug-extension/icons/logo.png',
    ];
    expect(forbiddenTracked(bad)).toEqual(bad);
  });

  it('accepts regular project files', () => {
    const good = [
      'src/icons/icon16.png',
      'src/icons/icon128.png',
      'src/manifest.base.json',
      'src/popup/popup.js',
      '.claude/settings.json',
      '.claude/skills/snapshot-schema/SKILL.md',
      'tests/unit/layout.test.js',
      'tests/fixtures/snapshot-sample.json',
      'scripts/dist-helpers.mjs',
      'docs/coverage-notes.md',
      'package-lock.json',
    ];
    expect(forbiddenTracked(good)).toEqual([]);
  });
});

describe('forbiddenInHistory', () => {
  it('flags logo.png in any path', () => {
    const log = ['', 'page-debug-extension/icons/logo.png', 'README.md', '', 'some/deep/dir/logo-640.png', ''].join('\n');
    expect(forbiddenInHistory(log)).toEqual(['page-debug-extension/icons/logo.png', 'some/deep/dir/logo-640.png']);
  });

  it('flags pem, crx, xpi, zip, snapshot json and node_modules; dedupes', () => {
    const log = [
      'a.pem', 'b.crx', 'c.xpi', 'd.zip', 'page-debug-snapshot-1.json',
      'node_modules/x/y.js', 'a.pem', 'src/popup/popup.js', '.claude/skills/snapshot-schema/SKILL.md',
    ].join('\r\n');
    expect(forbiddenInHistory(log)).toEqual([
      'a.pem', 'b.crx', 'c.xpi', 'd.zip', 'page-debug-snapshot-1.json', 'node_modules/x/y.js',
    ]);
  });

  it('returns an empty list for clean or empty logs', () => {
    expect(forbiddenInHistory('')).toEqual([]);
    expect(forbiddenInHistory('src/icons/icon16.png\nREADME.md\n')).toEqual([]);
  });
});

describe('repository state', () => {
  it('current index has no forbidden paths', () => {
    // AC-5.1, AC-5.3
    const out = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], { cwd: root, encoding: 'utf8' });
    expect(forbiddenTracked(out.split('\0').filter(Boolean))).toEqual([]);
  });

  it('.gitignore contains src/icons/logo*.png', () => {
    // AC-5.6 (path after the move to src/)
    const lines = readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain('src/icons/logo*.png');
  });

  it('.gitattributes normalizes line endings and marks png as binary', () => {
    // D13
    const lines = readFileSync(join(root, '.gitattributes'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain('* text=auto eol=lf');
    expect(lines).toContain('*.png binary');
  });

  it('tests contain no production domains', () => {
    // AC-5.4: domains taken from the sample real-world snapshot; fixtures must be synthetic.
    const domains = [
      'gazeta', 'im-g', 'g', 'sport', 'plotek', 'avanti24', 'moto', 'wyborcza', 'edziecko',
      'publio', 'agora', 'czterykaty', 'tokfm',
    ];
    const re = new RegExp(String.raw`(?<![\w.-])(?:[\w-]+\.)*(?:${domains.join('|')})\.pl\b`, 'i');
    const walk = (dir) => readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const hits = walk(join(root, 'tests'))
      .filter((p) => p !== thisFile)
      .filter((p) => re.test(readFileSync(p, 'utf8')))
      .map((p) => relative(root, p));
    expect(hits).toEqual([]);
  }, 30_000); // walks the whole tree; 6 s on /mnt/c (E4 TEST0, timeout only)
});
