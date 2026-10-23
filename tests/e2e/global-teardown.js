// AC-3.4: e2e must not leave files in the repo. Compares `git status` with the snapshot
// taken in global-setup and fails the run when anything changed. Both sides use the same
// `gitStatus()` filter, so edits under docs/ made in parallel do not fail the run (E2-IN2).
import { gitStatus } from './helpers/git-status.js';

export default async function globalTeardown() {
  const before = process.env.PDS_E2E_GIT_STATUS_BEFORE;
  if (before === undefined) return; // not a git checkout: nothing to compare
  const after = gitStatus();
  if (after !== before) {
    throw new Error(
      'e2e changed the working tree (AC-3.4).\n' +
        `git status before:\n${before || '(clean)'}\n` +
        `git status after:\n${after || '(clean)'}`,
    );
  }
}
