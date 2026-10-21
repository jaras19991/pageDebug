// Per-target build (design D3, D4): src/ -> dist/chrome, dist/firefox.
// Each target gets the merged manifest plus exactly the files reachable from it,
// copied byte for byte. Output depends only on file contents, so two builds are identical (AC-4.1).
//
// CLI: `node scripts/build.mjs` builds into dist/ and prints each target's size in KB.

import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mergeManifest } from './lib/manifest.mjs';
import { collectReachable } from './lib/reachability.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

/**
 * Builds every target into `<outDir>/<target>/`, removing previous output first.
 * @param {{ srcDir?: string, outDir?: string, targets?: string[] }} [options]
 * @returns {Promise<Record<string, string[]>>} per target: sorted POSIX paths, manifest.json included
 */
export async function build({ srcDir = join(ROOT, 'src'), outDir = join(ROOT, 'dist'), targets = ['chrome', 'firefox'] } = {}) {
  srcDir = resolve(srcDir);
  outDir = resolve(outDir);
  const base = await readJson(join(srcDir, 'manifest.base.json'));
  const result = {};

  for (const target of targets) {
    const overlay = await readJson(join(srcDir, `manifest.${target}.json`));
    const manifest = mergeManifest(base, overlay);
    // Walk the source with the merged manifest, so a bad reference fails before anything is written.
    const files = await collectReachable(srcDir, { manifest });

    const targetDir = join(outDir, target);
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const rel of files) {
      const to = join(targetDir, ...rel.split('/'));
      await mkdir(dirname(to), { recursive: true });
      await copyFile(join(srcDir, ...rel.split('/')), to);
    }
    result[target] = ['manifest.json', ...files].sort();
  }
  return result;
}

async function dirSize(dir, files) {
  let total = 0;
  for (const rel of files) total += (await stat(join(dir, ...rel.split('/')))).size;
  return total;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outDir = join(ROOT, 'dist');
  try {
    const result = await build({ outDir });
    for (const [target, files] of Object.entries(result)) {
      const kb = (await dirSize(join(outDir, target), files)) / 1024;
      console.log(`dist/${target}: ${files.length} files, ${kb.toFixed(1)} KB`);
    }
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
