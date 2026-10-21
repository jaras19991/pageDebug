import { describe, expect, it } from 'vitest';
import { MESSAGES, messageFor } from '../../src/popup/messages.js';

const FORBIDDEN = ['executeScript', 'inject', 'undefined', 'Error:', 'stack', 'PageDebugSnapshot'];
const SAMPLE_FILE = 'page-debug-snapshot-1700000000000.json';

function allTexts() {
  return Object.entries(MESSAGES).map(([key, value]) => [
    key,
    typeof value === 'function' ? value(SAMPLE_FILE) : value,
  ]);
}

describe('MESSAGES', () => {
  it('covers the closed set of outcomes plus working', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual(
      ['failed', 'fileAccess', 'noTab', 'restricted', 'success', 'working'].sort(),
    );
  });

  it('messages contain no forbidden words', () => {
    for (const [key, text] of allTexts()) {
      expect(typeof text, key).toBe('string');
      expect(text.length, key).toBeGreaterThan(0);
      for (const word of FORBIDDEN) {
        expect(text.toLowerCase(), `${key} contains ${word}`).not.toContain(word.toLowerCase());
      }
    }
  });

  it('success message contains the file name', () => {
    expect(MESSAGES.success(SAMPLE_FILE)).toContain(SAMPLE_FILE);
  });

  it('restricted message starts with "Na tej stronie nie da się zapisać paczki."', () => {
    expect(MESSAGES.restricted.startsWith('Na tej stronie nie da się zapisać paczki.')).toBe(true);
  });

  it('fileAccess message names the Chrome setting', () => {
    expect(MESSAGES.fileAccess).toContain('chrome://extensions');
    expect(MESSAGES.fileAccess).toContain('Zezwalaj na dostęp do adresów URL plików');
  });
});

describe('messageFor', () => {
  it('maps success with fileName', () => {
    expect(messageFor({ kind: 'success', fileName: SAMPLE_FILE })).toBe(MESSAGES.success(SAMPLE_FILE));
  });

  it('maps every non-success kind to its text', () => {
    for (const kind of ['restricted', 'fileAccess', 'noTab', 'failed']) {
      expect(messageFor({ kind })).toBe(MESSAGES[kind]);
    }
  });

  it('falls back to failed for unknown or missing outcome', () => {
    expect(messageFor({ kind: 'nonsense' })).toBe(MESSAGES.failed);
    expect(messageFor({ kind: 'working' })).toBe(MESSAGES.failed);
    expect(messageFor(undefined)).toBe(MESSAGES.failed);
    expect(messageFor({ kind: 'success' })).toBe(MESSAGES.failed);
  });
});
