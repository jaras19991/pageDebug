import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { maskSecrets, cutPreview, MASK_LIMITS } from '../../src/lib/mask-secrets.js';

const corpus = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/redaction/e2-bodies.json', import.meta.url)), 'utf8'));
const source = readFileSync(fileURLToPath(new URL('../../src/lib/mask-secrets.js', import.meta.url)), 'utf8');

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJGQUtFLXVzZXItMSJ9.ZmFrZS1zaWduYXR1cmUtZm9yLXRlc3Rz';

describe('maskSecrets (AC-4.7)', () => {
  it('{"error":"expired","access_token":"eyJ…"} → access_token value replaced by [redacted:key-token]; JSON still parses', () => {
    const { text, masked } = maskSecrets(`{"error":"expired","access_token":"${JWT}"}`);
    expect(JSON.parse(text)).toEqual({ error: 'expired', access_token: '[redacted:key-token]' });
    expect(text).not.toContain('eyJ');
    expect(masked).toBe(1);
  });

  it('Bearer token in plain text replaced by [redacted:bearer]', () => {
    const { text, masked } = maskSecrets('Authorization: Bearer FAKEtoken0123456789abcdefXYZ was rejected');
    expect(text).toBe('Authorization: Bearer [redacted:bearer] was rejected');
    expect(masked).toBe(1);
  });

  it('bare JWT anywhere → [redacted:jwt]', () => {
    expect(maskSecrets(`x ${JWT} y`).text).toBe('x [redacted:jwt] y');
    expect(maskSecrets(`<b>${JWT}</b>`).text).toBe('<b>[redacted:jwt]</b>');
    expect(maskSecrets(`{"note":"${JWT}"}`).text).toBe('{"note":"[redacted:jwt]"}');
  });

  it('key rules: JSON string values, form values, word boundaries, camelCase', () => {
    const table = [
      ['{"password" : "p4ss"}', '{"password" : "[redacted:key-password]"}'],
      ['{"user_token":"abc"}', '{"user_token":"[redacted:key-token]"}'],
      ['{"accessToken":"abc"}', '{"accessToken":"[redacted:key-token]"}'],
      ['{"API_KEY":"abc"}', '{"API_KEY":"[redacted:key-api_key]"}'],
      ['{"tokenizer":"abc"}', '{"tokenizer":"abc"}'],
      ['{"author":"abc"}', '{"author":"abc"}'],
      ['{"pin":1234,"session":true,"token":null}', '{"pin":1234,"session":true,"token":null}'],
      ['{"token":""}', '{"token":""}'],
      ['a=1&sid=xyz&b=2', 'a=1&sid=[redacted:key-sid]&b=2'],
      ['?access_token=abc#frag', '?access_token=[redacted:key-token]#frag'],
      ['cookie=v1; Path=/', 'cookie=[redacted:key-cookie]; Path=/'],
      ['{"m":"bad pwd=x1 here"}', '{"m":"bad pwd=[redacted:key-pwd] here"}'],
      ['page=2&sort=name', 'page=2&sort=name'],
      ['token=', 'token='],
    ];
    for (const [input, expected] of table) expect([input, maskSecrets(input).text]).toEqual([input, expected]);
  });

  it('JSON with escaped quotes keeps parsing after masking', () => {
    const body = JSON.stringify({ pwd: 'a"b\\"c', ok: false });
    const out = maskSecrets(body).text;
    expect(JSON.parse(out)).toEqual({ pwd: '[redacted:key-pwd]', ok: false });
  });

  it('corpus e2-bodies.json: 0 leaks of sensitive values', () => {
    expect(corpus.sensitive.length).toBeGreaterThanOrEqual(15);
    const leaks = [];
    for (const item of corpus.sensitive) {
      const { text, masked } = maskSecrets(item.body);
      for (const secret of item.secrets) if (text.includes(secret)) leaks.push(`${item.name}: ${secret}`);
      if (!text.includes(item.rule) || masked < 1) leaks.push(`${item.name}: no ${item.rule}`);
      if (item.body.startsWith('{')) expect(() => JSON.parse(text)).not.toThrow();
    }
    expect(leaks).toEqual([]);
  });

  it('benign corpus: ≤ 2 false positives (documented)', () => {
    expect(corpus.benign.length).toBeGreaterThanOrEqual(10);
    const changed = corpus.benign.filter((item) => maskSecrets(item.body).text !== item.body);
    // Every false positive must be documented in the corpus with a `falsePositive` note.
    expect(changed.filter((item) => !item.falsePositive).map((item) => item.name)).toEqual([]);
    expect(changed.length).toBeLessThanOrEqual(2);
  });

  it('idempotent: mask(mask(x)) === mask(x)', () => {
    const all = [...corpus.sensitive, ...corpus.benign].map((i) => i.body);
    for (const body of all) {
      const once = maskSecrets(body);
      const twice = maskSecrets(once.text);
      expect(twice.text).toBe(once.text);
      expect(twice.masked).toBe(0);
    }
  });

  it('masked count reported', () => {
    expect(maskSecrets('nothing here').masked).toBe(0);
    expect(maskSecrets(`{"token":"a","secret":"b"} Bearer FAKEtoken0123456789abcd ${JWT}`).masked).toBe(4);
  });

  it('non-string and oversize input', () => {
    expect(maskSecrets(undefined)).toEqual({ text: '', masked: 0 });
    expect(maskSecrets(42)).toEqual({ text: '', masked: 0 });
    const big = 'a'.repeat(MASK_LIMITS.inputChars) + ` token=${'s'.repeat(10)}`;
    const out = maskSecrets(big);
    expect(out.text.length).toBe(MASK_LIMITS.inputChars);
    expect(out.text).not.toContain('sssss');
  });

  it('adversarial input stays fast (no catastrophic backtracking)', () => {
    const inputs = [
      'a-'.repeat(32000),
      'aaaaaaaaaaaa.'.repeat(5000),
      '"k":"'.repeat(13000),
      'x='.repeat(32000),
      'Bearer '.repeat(9000),
      `${'a'.repeat(300)}=v `.repeat(200),
    ];
    for (const input of inputs) {
      const start = performance.now();
      maskSecrets(input);
      expect(performance.now() - start).toBeLessThan(250);
    }
  });

  it('module is pure: no DOM, no globals captured, generator-friendly syntax', () => {
    expect(source).not.toMatch(/\b(window|document|globalThis|self)\b/);
    expect(source).not.toMatch(/\bfetch\(|\bimport\(|\brequire\(|import\.meta|getURL\(|\Wurl\(/);
    expect(source).not.toMatch(/^import /m);
  });
});

describe('cutPreview (D3)', () => {
  it('short text is kept whole', () => {
    expect(cutPreview('abc def', 10)).toEqual({ preview: 'abc def', truncated: false });
    expect(cutPreview('abc def', 7)).toEqual({ preview: 'abc def', truncated: false });
  });

  it('cut at a word boundary keeps the whole last word', () => {
    expect(cutPreview('abc def ghi', 7)).toEqual({ preview: 'abc def', truncated: true });
  });

  it('cutPreview never ends with a partial token', () => {
    const words = ['{"a":', 'token_part-one.two', ' ', 'X+/=~', ',', 'zzzzzzzz', ' end'];
    const text = words.join('').repeat(5);
    const WORD = /[A-Za-z0-9._~+/=-]/;
    for (let max = 0; max < text.length; max++) {
      const { preview, truncated } = cutPreview(text, max);
      expect(truncated).toBe(true);
      expect(preview.length).toBeLessThanOrEqual(max);
      expect(text.startsWith(preview)).toBe(true);
      // The character after the preview must not continue a word the preview ends with.
      const last = preview.at(-1);
      if (last !== undefined && WORD.test(last)) expect(WORD.test(text[preview.length])).toBe(false);
    }
  });

  it('a single long token is dropped entirely, never half-kept', () => {
    expect(cutPreview('x'.repeat(5000), 4096)).toEqual({ preview: '', truncated: true });
  });

  it('does not split a surrogate pair', () => {
    const { preview } = cutPreview('ab \u{1F600}\u{1F600}', 4);
    expect(preview).toBe('ab ');
  });
});
