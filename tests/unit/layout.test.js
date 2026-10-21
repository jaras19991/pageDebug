import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

// SHA-256 of console-snapshot.js as committed (LF line endings). The standalone
// fallback must stay byte-identical in E0 (decision 6, risk 5).
const CONSOLE_SNAPSHOT_SHA256 = 'bc8ee7c0f696b5d6c3f45f5145dbc15014390688110165b96c08270faf233505';

describe('repo layout', () => {
  it('extension sources live in src/', () => {
    const files = [
      'src/page/page-debug-snapshot.js',
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

  it('console-snapshot.js unchanged', () => {
    // Normalize CRLF so the hash does not depend on core.autocrlf of the checkout.
    const text = readFileSync(root + 'src/standalone/console-snapshot.js', 'utf8').replace(/\r\n/g, '\n');
    const hash = createHash('sha256').update(text, 'utf8').digest('hex');
    expect(hash).toBe(CONSOLE_SNAPSHOT_SHA256);
  });
});
