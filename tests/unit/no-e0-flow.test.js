import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

// The console fallback (AC-5.4) saves the file itself; it is the only place allowed to do so.
const STANDALONE = ['standalone/console-snapshot.js', 'page/console-entry.js'];

function listTextFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTextFiles(full));
    else if (/\.(js|html|json)$/.test(entry.name)) out.push(relative(srcDir, full).replace(/\\/g, '/'));
  }
  return out;
}

describe('E0 flow removed (E1-T17)', () => {
  it('E0 flow files are gone from src', () => {
    for (const file of ['page/page-debug-snapshot.js', 'popup/run-in-page.js', 'popup/snapshot-tab.js']) {
      expect(existsSync(join(srcDir, file)), file).toBe(false);
    }
  });

  it('no __PAGE_DEBUG_SNAPSHOT__, executeScript or <a download> in src except standalone fallback', () => {
    // AC-5.4, D7: the extension saves only through downloads.download from the popup.
    const forbidden = [/__PAGE_DEBUG_SNAPSHOT__/, /executeScript/, /\.download\s*=/, /createElement\(\s*['"]a['"]\s*\)/];
    const files = listTextFiles(srcDir);
    expect(files).toContain('background.js');
    for (const file of files) {
      if (STANDALONE.includes(file)) continue;
      const text = readFileSync(join(srcDir, file), 'utf8');
      for (const pattern of forbidden) {
        expect(pattern.test(text), `${file}: ${pattern}`).toBe(false);
      }
    }
  });
});
