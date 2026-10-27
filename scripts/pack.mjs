// Release packaging (design D5): release check (E2-IN5), build, then one zip per target in dist/.
// Entries are sorted, use `/` separators and a fixed mtime, so the same build gives byte-identical zips.
// `manifest.json` sits at the zip root. Pure JS (fflate), no native binaries.
// The developer viewer (E4 D3, Q-8) is a release artefact next to the zips, not part of the extension:
// src/standalone/viewer.html copied as dist/page-debug-viewer-<version>.html (freshness is in the release check).
//
// CLI: `node scripts/pack.mjs [--config <file>]` writes dist/page-debug-snapshot-<target>-<version>.zip and
// dist/page-debug-viewer-<version>.html and prints sizes. Unlike build.mjs, PDS_CONFIG in the environment is ignored
// (review E4): a release zip gets a developer configuration only from an explicit `--config`, and is then named
// …-<version>-devconfig.zip, with a warning.

import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';
import { build, cliOptions } from './build.mjs';
import { checkRelease } from './check-release.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Local time on purpose: fflate encodes DOS time from local fields and rejects years before 1980.
const MTIME = new Date(1980, 0, 1, 0, 0, 0);

/** Pack CLI arguments → options: only an explicit `--config` (the environment is not read). */
export const packCliOptions = (argv) => cliOptions(argv, {});

/** File name of the viewer release artefact. */
export const viewerFileName = (version) => `page-debug-viewer-${version}.html`;

/**
 * Deterministic zip of a built target: sorted entries, `/` separators, fixed mtime, deflate level 9.
 * Also used by the size budget test (E4-T9), so the budget measures exactly what pack ships.
 * @param {string} targetDir dist/<target>
 * @param {string[]} files POSIX paths relative to targetDir
 * @returns {Promise<Uint8Array>}
 */
export async function zipTarget(targetDir, files) {
  const entries = {};
  for (const rel of [...files].sort()) {
    entries[rel] = [new Uint8Array(await readFile(join(targetDir, ...rel.split('/')))), { mtime: MTIME, level: 9 }];
  }
  return zipSync(entries);
}

/**
 * Checks the release (version, fresh bundles and viewer), builds all targets into `distDir`, zips each one
 * next to it and copies the viewer there as viewerFileName(version).
 * Throws with the list of problems, before building anything, when the check fails.
 * @param {{ root?: string, distDir?: string, devConfigPath?: string, warn?: (msg: string) => void }} [options]
 *   `devConfigPath`: developer configuration passed to build (E4 D5), as `build --config`; the zips are then named
 *   …-devconfig.zip and `warn` says so.
 * @returns {Promise<string[]>} absolute paths of the written zips
 */
export async function pack({ root = ROOT, distDir = join(root, 'dist'), devConfigPath, warn = (msg) => console.warn(msg) } = {}) {
  distDir = resolve(distDir);
  const errors = await checkRelease({ root });
  if (errors.length) throw new Error(`release check failed:\n${errors.map((e) => `- ${e}`).join('\n')}`);
  const suffix = devConfigPath === undefined ? '' : '-devconfig';
  if (devConfigPath !== undefined) {
    warn(`Warning: packing with the developer configuration ${basename(devConfigPath)}; zips are named …${suffix}.zip`);
  }
  const built = await build({ srcDir: join(root, 'src'), outDir: distDir, devConfigPath, warn });
  const zips = [];

  for (const [target, files] of Object.entries(built)) {
    const targetDir = join(distDir, target);
    const { version } = JSON.parse(await readFile(join(targetDir, 'manifest.json'), 'utf8'));
    const zipPath = join(distDir, `page-debug-snapshot-${target}-${version}${suffix}.zip`);
    await writeFile(zipPath, await zipTarget(targetDir, files));
    zips.push(zipPath);
  }
  const { version } = JSON.parse(await readFile(join(root, 'src', 'manifest.base.json'), 'utf8'));
  await copyFile(join(root, 'src', 'standalone', 'viewer.html'), join(distDir, viewerFileName(version)));
  return zips;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { devConfigPath } = packCliOptions(process.argv.slice(2));
    const zips = await pack({ devConfigPath });
    const { version } = JSON.parse(await readFile(join(ROOT, 'src', 'manifest.base.json'), 'utf8'));
    for (const file of [...zips, join(ROOT, 'dist', viewerFileName(version))]) {
      const kb = (await stat(file)).size / 1024;
      console.log(`${file.slice(ROOT.length + 1).split('\\').join('/')}: ${kb.toFixed(1)} KB`);
    }
  } catch (error) {
    console.error(`Pack failed: ${error.message}`);
    process.exitCode = 1;
  }
}
