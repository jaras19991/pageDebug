// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../scripts/build.mjs';
import { zipTarget } from '../../scripts/pack.mjs';

// E4-T9 (NFR size, design E4-T9): the binding budget is the shipped zip, built exactly as `npm run pack` does.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ZIP_0_5_0_BYTES = 162413; // dist/page-debug-snapshot-chrome-0.5.0.zip (E3 release)
const MAX_ZIP_GROWTH_BYTES = 30 * 1024;
const MAX_VIEWER_BYTES = 300 * 1024;

let outDir;
let files;
beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'pds-size-'));
  files = await build({ outDir, targets: ['chrome'] });
}, 60000);
afterAll(async () => { if (outDir) await rm(outDir, { recursive: true, force: true }); });

describe('size budget (E4-T9)', () => {
  it('chrome extension zip grows ≤ 30 KB vs 0.5.0', async () => {
    const zip = await zipTarget(join(outDir, 'chrome'), files.chrome);
    expect(zip.length).toBeLessThanOrEqual(ZIP_0_5_0_BYTES + MAX_ZIP_GROWTH_BYTES);
  });

  it('viewer/MCP-only modules stay out of the extension (E4 D1)', () => {
    for (const lib of ['unzip', 'migrate', 'package-reader', 'snapshot-diff']) expect(files.chrome).not.toContain(`lib/${lib}.js`);
    expect(files.chrome.some((f) => f.startsWith('viewer/') || f.startsWith('standalone/'))).toBe(false);
  });

  it('viewer.html ≤ 300 KB', async () => {
    const { size } = await stat(join(ROOT, 'src', 'standalone', 'viewer.html'));
    expect(size).toBeLessThanOrEqual(MAX_VIEWER_BYTES);
  });
});
