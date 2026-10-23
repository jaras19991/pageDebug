// Release consistency check (E2-IN5), run by `npm run pack` before building: the recorder version
// baked into the page bundles must equal the manifest version, and the generated bundles must be
// up to date with src/page. Otherwise a release could ship an old recorder under a new version.
//
// CLI: `node scripts/check-release.mjs` prints the problems and exits 1, or prints OK.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateAll } from './gen-content.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECORDER_VERSION_RE = /^export const RECORDER_VERSION = (['"])([^'"\n]{1,64})\1;/m;

/**
 * @param {{ root?: string }} [options]
 * @returns {Promise<string[]>} human-readable problems; empty when the tree is releasable
 */
export async function checkRelease({ root = ROOT } = {}) {
  const errors = [];
  const src = join(root, 'src');

  let manifestVersion = null;
  try {
    manifestVersion = JSON.parse(await readFile(join(src, 'manifest.base.json'), 'utf8')).version ?? null;
  } catch (error) {
    errors.push(`Cannot read version from src/manifest.base.json: ${error.message}`);
  }

  let recorderVersion = null;
  try {
    recorderVersion = RECORDER_VERSION_RE.exec(await readFile(join(src, 'page', 'constants.js'), 'utf8'))?.[2] ?? null;
    if (recorderVersion === null) errors.push('RECORDER_VERSION not found in src/page/constants.js');
  } catch (error) {
    errors.push(`Cannot read RECORDER_VERSION from src/page/constants.js: ${error.message}`);
  }

  if (manifestVersion !== null && recorderVersion !== null && manifestVersion !== recorderVersion) {
    errors.push(
      `RECORDER_VERSION '${recorderVersion}' in src/page/constants.js differs from version '${manifestVersion}' ` +
        'in src/manifest.base.json (update constants.js, then `npm run gen`)',
    );
  }

  try {
    const { stale } = await generateAll({ root, check: true });
    if (stale.length) errors.push(`Stale generated files (run \`npm run gen\`): ${stale.map((f) => `src/${f}`).join(', ')}`);
  } catch (error) {
    errors.push(`Cannot check generated files: ${error.message}`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = await checkRelease();
  if (errors.length) {
    console.error(`Release check failed:\n${errors.map((e) => `- ${e}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('Release check OK.');
  }
}
