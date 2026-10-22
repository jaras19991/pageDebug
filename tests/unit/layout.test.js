import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '../../scripts/gen-content.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('repo layout', () => {
  it('extension sources live in src/', () => {
    const files = [
      'src/background.js',
      'src/content/main-world.js',
      'src/popup/controller.js',
      'src/page/console-entry.js',
      'src/popup/popup.html',
      'src/icons/icon16.png',
      'src/icons/icon48.png',
      'src/icons/icon128.png',
    ];
    for (const file of files) {
      expect(existsSync(root + file), file).toBe(true);
    }
  });

  it('no tracked files under page-debug-extension/', () => {
    // AC-5.3: the old extension directory is gone from the index.
    const out = execFileSync('git', ['ls-files', 'page-debug-extension'], { cwd: root, encoding: 'utf8' });
    expect(out.trim()).toBe('');
  });

  it('console-snapshot.js is generated from src/page/console-entry.js and up to date', () => {
    // Replaces the E0 hash check (E1 D6, US-7): the fallback now comes from the shared recorder modules.
    // Normalize CRLF so the comparison does not depend on core.autocrlf of the checkout.
    const text = readFileSync(root + 'src/standalone/console-snapshot.js', 'utf8').replace(/\r\n/g, '\n');
    expect(text).toBe(bundle({ entry: 'page/console-entry.js', srcDir: join(root, 'src') }));
  });
});
