// Unpacks a release zip into a fresh temp dir for e2e (AC-4.5). fflate is already a
// devDependency (scripts/pack.mjs), so no new packages. Entries are checked so a zip
// cannot write outside the target dir.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';

/**
 * @param {string} zipPath
 * @param {{ prefix?: string }} [options]
 * @returns {Promise<{ dir: string, entries: string[], cleanup: () => Promise<void> }>}
 */
export async function unzipToTemp(zipPath, { prefix = 'pds-e2e-unzip-' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    const files = unzipSync(new Uint8Array(await readFile(zipPath)));
    const entries = Object.keys(files).sort();
    for (const name of entries) {
      if (name.endsWith('/')) continue; // directory entry
      const target = resolve(dir, ...name.split('/'));
      if (!target.startsWith(dir + sep)) throw new Error(`Zip entry escapes target dir: ${name}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, files[name]);
    }
    return { dir, entries, cleanup: () => rm(dir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Entry names of a zip, without writing anything to disk. */
export async function listZipEntries(zipPath) {
  return Object.keys(unzipSync(new Uint8Array(await readFile(zipPath)))).sort();
}
