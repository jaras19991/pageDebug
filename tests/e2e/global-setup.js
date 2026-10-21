// Builds dist/ before any e2e test (AC-3.3) and remembers `git status` so the teardown
// can prove the run left no files in tracked or unignored paths (AC-3.4).
import { build } from '../../scripts/build.mjs';
import { gitStatus } from './helpers/git-status.js';

export default async function globalSetup() {
  await build();
  const status = gitStatus();
  // Workers and the teardown inherit process.env from the runner process.
  if (status !== null) process.env.PDS_E2E_GIT_STATUS_BEFORE = status;
}
