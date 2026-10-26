// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256Hex, shortHash } from '../../src/lib/sha256.js';

const source = readFileSync(fileURLToPath(new URL('../../src/lib/sha256.js', import.meta.url)), 'utf8');
const nodeHex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('sha256Hex (E3-D4, AC-4.4)', () => {
  it('NIST vectors: "", "abc", 448-bit message, 1e6 × "a"', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256Hex('a'.repeat(1e6))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('padding edges (55, 56, 63, 64, 65 bytes) equal node:crypto', () => {
    for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128]) expect(sha256Hex('x'.repeat(n))).toBe(nodeHex('x'.repeat(n)));
  });

  it('UTF-8 input (ą, emoji) equals node:crypto', () => {
    for (const s of ['ą', 'zażółć gęślą jaźń', '\u{1F600}', 'sid=ąę\u{1F680}x', 'é'.repeat(100)]) {
      expect(sha256Hex(s)).toBe(nodeHex(s));
    }
  });

  it('non-string input is hashed as its string form', () => {
    expect(sha256Hex(123)).toBe(nodeHex('123'));
    expect(sha256Hex(undefined)).toBe(nodeHex(''));
  });

  it('shortHash same value → same, different → different on 10 000 random values', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const seen = new Map();
    for (let i = 0; i < 10000; i++) {
      const value = `v${i}-${Math.floor(rnd() * 1e9).toString(36)}`;
      const h = shortHash(value);
      expect(h).toMatch(/^[0-9a-f]{8}$/);
      expect(shortHash(value)).toBe(h);
      expect(seen.has(h)).toBe(false);
      seen.set(h, value);
    }
    expect(shortHash('abc')).toBe('ba7816bf');
  });

  it('module is pure: no imports, no crypto.subtle, no DOM', () => {
    expect(source).not.toMatch(/^import /m);
    expect(source).not.toMatch(/\bcrypto\.|\bsubtle\.|\b(window|document|globalThis|self)\b/);
  });
});
