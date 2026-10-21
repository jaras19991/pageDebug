import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const readJson = (name) => JSON.parse(readFileSync(root + name, 'utf8'));

const pkg = readJson('package.json');
const lock = readJson('package-lock.json');

describe('package.json', () => {
  it('has no dependencies section', () => {
    // AC-4.6: the extension ships no runtime dependencies.
    expect(pkg).not.toHaveProperty('dependencies');
    expect(lock.packages[''] ?? {}).not.toHaveProperty('dependencies');
  });

  it('has web-ext in devDependencies and no sharp anywhere', () => {
    expect(pkg.devDependencies).toHaveProperty('web-ext');
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      expect(pkg[section] ?? {}).not.toHaveProperty('sharp');
    }
    const lockPaths = Object.keys(lock.packages ?? {});
    expect(lockPaths.filter((p) => /(^|\/)node_modules\/(@img\/)?sharp(-|$|\/)/.test(p))).toEqual([]);
  });

  it('defines required scripts', () => {
    for (const name of ['build', 'pack', 'test', 'test:e2e', 'lint', 'dev:chrome', 'dev:firefox']) {
      expect(pkg.scripts?.[name], name).toBeTypeOf('string');
    }
  });

  it('lint script runs eslint and web-ext lint on dist/firefox', () => {
    // AC-3.1: lint covers our sources and the built Firefox package.
    const lint = pkg.scripts?.lint ?? '';
    expect(lint).toMatch(/\beslint\b/);
    expect(lint).toMatch(/\bweb-ext lint\b.*--source-dir[ =]dist\/firefox\b/);
  });
});
