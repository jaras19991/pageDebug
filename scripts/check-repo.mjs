// Repo hygiene check (US-5): nothing from the "ignored, never in repo" column may be tracked or in history.
//   node scripts/check-repo.mjs            -> checks `git ls-files` (AC-5.1, AC-5.3)
//   node scripts/check-repo.mjs --history  -> checks local history (AC-5.2); remote-tracking refs are reported
//                                             separately as a warning, or as errors with --include-remotes.
// Exit code 1 with a list of offending paths on violation. Read-only: runs only `git ls-files` / `git log`.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_PATH = 4096;

// Spec US-5, column "Ignorowane, nigdy w repo".
const TRACKED_RULES = [
  /\.(pem|crx|xpi|zip)$/i,
  /(^|\/)node_modules\//,
  /^dist\//,
  /(^|\/)page-debug-snapshot-[^/]*\.(json|zip)$/i,
  /^(test-results|playwright-report|coverage)\//,
  /^\.claude\/settings\.local\.json$/,
  /(^|\/)logo[^/]*\.png$/i,
];

// AC-5.2 list; logo*.png in any path (source logo was removed from history).
const HISTORY_RULES = [
  /\.(pem|crx|xpi|zip)$/i,
  /(^|\/)node_modules\//,
  /(^|\/)page-debug-snapshot-[^/]*\.json$/i,
  /(^|\/)logo[^/]*\.png$/i,
];

const matches = (rules) => (path) => path.length <= MAX_PATH && rules.some((re) => re.test(path));

export function forbiddenTracked(paths) {
  return paths.filter(matches(TRACKED_RULES));
}

export function forbiddenInHistory(nameOnlyLog) {
  const paths = new Set(nameOnlyLog.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  return [...paths].filter(matches(HISTORY_RULES));
}

const git = (args) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});

function report(title, hits) {
  console.log(`${title}: ${hits.length}`);
  for (const p of hits) console.log(`  ${p}`);
}

function main(argv) {
  if (!argv.includes('--history')) {
    const hits = forbiddenTracked(git(['ls-files', '-z']).split('\0').filter(Boolean));
    if (hits.length) {
      report('Forbidden paths in git index', hits);
      return 1;
    }
    console.log('Index OK: no forbidden paths tracked.');
    return 0;
  }

  // Local refs = everything `--all` sees except remote-tracking refs (branches, tags, stash, notes).
  // Remote-tracking refs mirror what the server had at last fetch; they are checked separately so a stale
  // origin/* (e.g. before the planned force push) does not mask the state of local history.
  const logArgs = ['log', '--name-only', '--format='];
  const local = forbiddenInHistory(git([...logArgs, '--exclude=refs/remotes/*', '--all']));
  const localSet = new Set(local);
  const remoteOnly = forbiddenInHistory(git([...logArgs, '--remotes'])).filter((p) => !localSet.has(p));
  const strictRemotes = argv.includes('--include-remotes');

  let code = 0;
  if (local.length) {
    report('Forbidden paths in local history', local);
    code = 1;
  } else {
    console.log('Local history OK: no forbidden paths.');
  }
  if (remoteOnly.length) {
    report(`${strictRemotes ? 'Forbidden' : 'WARNING: forbidden'} paths only on remote-tracking refs (origin/*)`, remoteOnly);
    if (strictRemotes) code = 1;
    else console.log('  Remote still has these paths; force push the cleaned history, then fetch and re-run with --include-remotes.');
  } else {
    console.log('Remote-tracking refs OK: no forbidden paths.');
  }
  return code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
