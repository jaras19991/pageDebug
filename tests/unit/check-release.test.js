// E2-IN5: `npm run pack` refuses to zip a tree whose recorder version or generated bundles
// disagree with the sources.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRelease } from '../../scripts/check-release.mjs';
import { pack } from '../../scripts/pack.mjs';
import { BUNDLES, generateAll } from '../../scripts/gen-content.mjs';

let tmp;
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), 'pds-release-')); });
afterAll(async () => { await rm(tmp, { recursive: true, force: true }); });

// Minimal project: manifest.base.json, constants.js with RECORDER_VERSION, entries and fresh bundles.
async function project(name, { manifestVersion = '1.2.3', recorderVersion = '1.2.3' } = {}) {
  const root = join(tmp, name);
  await mkdir(join(root, 'src', 'page'), { recursive: true });
  await writeFile(join(root, 'src', 'manifest.base.json'), JSON.stringify({ manifest_version: 3, name: 'x', version: manifestVersion }));
  await writeFile(join(root, 'src', 'page', 'constants.js'), `// c\nexport const RECORDER_VERSION = '${recorderVersion}';\n`);
  for (const { entry } of BUNDLES) {
    await writeFile(join(root, 'src', entry), "import { RECORDER_VERSION } from './constants.js';\n\nglobalThis.__v = RECORDER_VERSION;\n");
  }
  // E4-T3a: the viewer page is a generated file as well.
  await mkdir(join(root, 'src', 'viewer'), { recursive: true });
  await writeFile(join(root, 'src', 'viewer', 'viewer.html'), '<meta content="{{CSP}}"><style></style><script>{{SCRIPT}}</script>\n');
  await writeFile(join(root, 'src', 'viewer', 'viewer-entry.js'), 'globalThis.__v = 1;\n');
  await generateAll({ root });
  return root;
}

describe('checkRelease', () => {
  it('mismatched RECORDER_VERSION fails with both versions in message', async () => {
    const root = await project('mismatch', { manifestVersion: '0.4.0', recorderVersion: '0.3.0' });
    const errors = await checkRelease({ root });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/RECORDER_VERSION/);
    expect(errors[0]).toContain('0.3.0');
    expect(errors[0]).toContain('0.4.0');
  });

  it('stale bundle fails', async () => {
    const root = await project('stale');
    await writeFile(join(root, 'src', 'content', 'main-world.js'), '// hand edit\n');
    const errors = await checkRelease({ root });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('src/content/main-world.js');
    expect(errors[0]).toMatch(/npm run gen/);
  });

  it('missing RECORDER_VERSION is reported, not thrown', async () => {
    const root = await project('no-const');
    await writeFile(join(root, 'src', 'page', 'constants.js'), "export const OTHER = '1.2.3';\n");
    const errors = await checkRelease({ root });
    expect(errors.some((e) => /RECORDER_VERSION/.test(e))).toBe(true);
  });

  it('consistent tree passes', async () => {
    const root = await project('ok');
    expect(await checkRelease({ root })).toEqual([]);
  });
});

describe('pack with release check', () => {
  it('pack refuses to zip on failed check', async () => {
    const root = await project('pack-bad', { manifestVersion: '0.4.0', recorderVersion: '0.3.0' });
    const distDir = join(root, 'dist');
    await expect(pack({ root, distDir })).rejects.toThrow(/RECORDER_VERSION.*0\.3\.0.*0\.4\.0|0\.4\.0.*0\.3\.0/s);
    const zips = existsSync(distDir) ? (await readdir(distDir)).filter((f) => f.endsWith('.zip')) : [];
    expect(zips).toEqual([]);
    expect(existsSync(join(distDir, 'chrome'))).toBe(false);
  });
});
