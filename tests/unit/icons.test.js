import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { buildToTmp } from './helpers/build-to-tmp.js';

// AC-4.7: icons in dist/*/icons are exactly 16/48/128 px PNGs, total <= 50 KB, no logo file.
const TARGETS = ['chrome', 'firefox'];
const EXPECTED_SIZES = [16, 48, 128];
const MAX_ICONS_BYTES = 50 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Reads width/height from the IHDR chunk without dependencies.
// Layout: 8 B signature, 4 B chunk length, 4 B "IHDR", then width (16–19) and height (20–23), big-endian.
function readPngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let built;
beforeAll(async () => { built = await buildToTmp(); });
afterAll(async () => { await built?.cleanup(); });

const targetDir = (t) => join(built.outDir, t);
const iconsDir = (t) => join(targetDir(t), 'icons');
const readManifest = async (t) => JSON.parse(await readFile(join(targetDir(t), 'manifest.json'), 'utf8'));

describe('readPngSize', () => {
  it('rejects non-PNG data', () => {
    expect(readPngSize(Buffer.from('GIF89a................................'))).toBeNull();
    expect(readPngSize(Buffer.alloc(10))).toBeNull();
  });
});

describe.each(TARGETS)('icons in dist/%s', (target) => {
  it('icons are PNG with exact sizes 16, 48, 128', async () => {
    const names = (await readdir(iconsDir(target))).sort();
    expect(names).toEqual(EXPECTED_SIZES.map((s) => `icon${s}.png`).sort());
    for (const size of EXPECTED_SIZES) {
      const buf = await readFile(join(iconsDir(target), `icon${size}.png`));
      expect(readPngSize(buf), `icon${size}.png`).toEqual({ width: size, height: size });
    }
  });

  it('icons total ≤ 50 KB', async () => {
    let total = 0;
    for (const name of await readdir(iconsDir(target))) {
      total += (await stat(join(iconsDir(target), name))).size;
    }
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(MAX_ICONS_BYTES);
  });

  it('no logo*.png in dist', async () => {
    const entries = await readdir(targetDir(target), { recursive: true });
    const logos = entries.filter((p) => /^logo.*\.png$/i.test(posix.basename(p.replaceAll('\\', '/'))));
    expect(logos).toEqual([]);
  });

  it('manifest icons and action.default_icon point to existing PNGs of the declared size', async () => {
    const manifest = await readManifest(target);
    const declared = [
      ...Object.entries(manifest.icons ?? {}),
      ...Object.entries(manifest.action?.default_icon ?? {}),
    ];
    expect(Object.keys(manifest.icons ?? {}).sort()).toEqual(EXPECTED_SIZES.map(String).sort());
    expect(declared.length).toBeGreaterThan(EXPECTED_SIZES.length);
    for (const [size, path] of declared) {
      const buf = await readFile(join(targetDir(target), path));
      expect(readPngSize(buf), path).toEqual({ width: Number(size), height: Number(size) });
    }
  });
});
