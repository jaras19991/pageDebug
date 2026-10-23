// `git status --porcelain` for the repo root, or null when git or the repo is unavailable.
// Paths under `exclude` (default docs/) are dropped: documentation is edited in parallel
// with e2e runs and is not something a test can leave behind (E2-IN2).
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// Path a porcelain v1 line refers to: the destination for renames/copies (`R  a -> b`),
// with git's C-style quotes removed (paths with spaces or non-ASCII bytes).
function porcelainPath(line) {
  let path = line.slice(3);
  const arrow = path.indexOf(' -> ');
  if (arrow !== -1) path = path.slice(arrow + 4);
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
  return path;
}

export function filterPorcelain(text, exclude) {
  if (!exclude.length) return text;
  return text
    .split('\n')
    .filter((line) => line === '' || !exclude.some((prefix) => porcelainPath(line).startsWith(prefix)))
    .join('\n');
}

export function gitStatus({ exclude = ['docs/'] } = {}) {
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return r.status === 0 ? filterPorcelain(r.stdout, exclude) : null;
}
