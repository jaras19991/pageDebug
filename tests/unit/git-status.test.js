// E2-IN2: the e2e git-status guard ignores paths under docs/ (parallel documentation work).
import { describe, expect, it } from 'vitest';
import { filterPorcelain, gitStatus } from '../e2e/helpers/git-status.js';

describe('filterPorcelain', () => {
  it('porcelain lines under docs/ are ignored', () => {
    const out = filterPorcelain(' M docs/BACKLOG.md\n?? docs/epics/E2/state.md\n', ['docs/']);
    expect(out).toBe('');
  });

  it('rename into docs/ ignored, out of docs/ kept', () => {
    const into = 'R  notes.md -> docs/notes.md\n';
    const out = 'R  docs/old.md -> src/old.md\n';
    expect(filterPorcelain(into, ['docs/'])).toBe('');
    expect(filterPorcelain(out, ['docs/'])).toBe(out);
  });

  it('other changes still reported', () => {
    const text = ' M src/background.js\n M docs/BACKLOG.md\n?? tests/tmp.json\n?? "docs/with space.md"\n?? docsx/a.md\n';
    expect(filterPorcelain(text, ['docs/'])).toBe(' M src/background.js\n?? tests/tmp.json\n?? docsx/a.md\n');
  });

  it('empty exclude list keeps everything', () => {
    const text = ' M docs/BACKLOG.md\n';
    expect(filterPorcelain(text, [])).toBe(text);
  });

  // Spawns real `git status`; on /mnt/c (WSL, NTFS) in a full parallel run it can exceed the 5 s default.
  it('gitStatus returns a string without docs/ lines in this checkout', () => {
    const s = gitStatus();
    if (s === null) return; // not a git checkout
    expect(s.split('\n').some((l) => /^.. "?docs\//.test(l))).toBe(false);
  }, 30000);
});
