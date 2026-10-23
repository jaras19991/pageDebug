// Release packaging (design D5): release check (E2-IN5), build, then one zip per target in dist/.
// Entries are sorted, use `/` separators and a fixed mtime, so the same build gives byte-identical zips.
// `manifest.json` sits at the zip root. Pure JS (fflate), no native binaries.
//
// CLI: `node scripts/pack.mjs` writes dist/page-debug-snapshot-<target>-<version>.zip and prints sizes.

import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';
import { build } from './build.mjs';
import { checkRelease } from './check-release.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Local time on purpose: fflate encodes DOS time from local fields and rejects years before 1980.
const MTIME = new Date(1980, 0, 1, 0, 0, 0);

/**
 * Checks the release (version, fresh bundles), builds all targets into `distDir` and zips each one next to it.
 * Throws with the list of problems, before building anything, when the check fails.
 * @param {{ root?: string, distDir?: string }} [options]
 * @returns {Promise<string[]>} absolute paths of the written zips
 */
export async function pack({ root = ROOT, distDir = join(root, 'dist') } = {}) {
  distDir = resolve(distDir);
  const errors = await checkRelease({ root });
  if (errors.length) throw new Error(`release check failed:\n${errors.map((e) => `- ${e}`).join('\n')}`);
  const built = await build({ srcDir: join(root, 'src'), outDir: distDir });
  const zips = [];

  for (const [target, files] of Object.entries(built)) {
    const targetDir = join(distDir, target);
    const { version } = JSON.parse(await readFile(join(targetDir, 'manifest.json'), 'utf8'));
    const entries = {};
    for (const rel of [...files].sort()) {
      entries[rel] = [new Uint8Array(await readFile(join(targetDir, ...rel.split('/')))), { mtime: MTIME, level: 9 }];
    }
    const zipPath = join(distDir, `page-debug-snapshot-${target}-${version}.zip`);
    await writeFile(zipPath, zipSync(entries));
    zips.push(zipPath);
  }
  return zips;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    for (const zip of await pack()) {
      const kb = (await stat(zip)).size / 1024;
      console.log(`${zip.slice(ROOT.length + 1).split('\\').join('/')}: ${kb.toFixed(1)} KB`);
    }
  } catch (error) {
    console.error(`Pack failed: ${error.message}`);
    process.exitCode = 1;
  }
}
