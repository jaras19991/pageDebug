import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../../../scripts/build.mjs';

// Builds both targets into a fresh temp dir, so tests never touch the repo's dist/.
// Call once per test file in beforeAll and call `cleanup()` in afterAll.
// Returns { outDir, files, cleanup } where files = { chrome: [...], firefox: [...] }.
export async function buildToTmp(options = {}) {
  const outDir = await mkdtemp(join(tmpdir(), 'pds-build-'));
  const files = await build({ ...options, outDir });
  return {
    outDir,
    files,
    cleanup: () => rm(outDir, { recursive: true, force: true }),
  };
}
