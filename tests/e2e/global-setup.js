// Builds dist/ before any e2e test (AC-3.3) and remembers `git status` so the teardown
// can prove the run left no files in tracked or unignored paths (AC-3.4).
import { build } from '../../scripts/build.mjs';
import { gitStatus } from './helpers/git-status.js';

export default async function globalSetup() {
  // Default run: build dist/ first (AC-3.3 of E0, e2e loads dist/chrome from `npm run build`).
  // PDS_E2E_NO_BUILD=1 skips it, so a second e2e run started while another one is using
  // dist/chrome does not rebuild the extension under the running browser (E1 F-e1-2).
  if (process.env.PDS_E2E_NO_BUILD !== '1') await build();
  const status = gitStatus();
  // Workers and the teardown inherit process.env from the runner process.
  if (status !== null) process.env.PDS_E2E_GIT_STATUS_BEFORE = status;
}
