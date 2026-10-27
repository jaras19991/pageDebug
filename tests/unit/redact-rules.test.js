// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  RULES_VERSION, ALWAYS_RULES, DEFAULT_RULES, secretKeyRule, maskText, maskUrl, luhn, peselValid, ibanValid, shannon,
} from '../../src/lib/redact-rules.js';
import { maskSecrets } from '../../src/lib/mask-secrets.js';

const load = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/redaction/${name}`, import.meta.url)), 'utf8'));
const sensitive = load('sensitive.json').items;
const benign = load('benign.json').items;
const source = readFileSync(fileURLToPath(new URL('../../src/lib/redact-rules.js', import.meta.url)), 'utf8');

const ALL = { email: true, phone: true };
const run = (item, opts = ALL) => (item.via === 'url' ? maskUrl(item.text, opts) : maskText(item.text, opts));
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJGQUtFLXVzZXItNDIifQ.U2lnbmF0dXJlRmFrZTAxMjM0NTY3ODk';

const parses = (text) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

// Every 8-character fragment of a secret (or the whole secret when shorter) found in `text`.
function leaks(secret, text) {
  if (secret.length <= 8) return text.includes(secret) ? [secret] : [];
  const found = [];
  for (let i = 0; i + 8 <= secret.length; i++) if (text.includes(secret.slice(i, i + 8))) found.push(secret.slice(i, i + 8));
  return found;
}

describe('rule set (D2, D3)', () => {
  it('version and levels', () => {
    expect(RULES_VERSION).toBe(2);
    expect(DEFAULT_RULES).toEqual(['email', 'phone', 'html-structure']);
    for (const rule of ['jwt', 'bearer', 'basic', 'card', 'iban', 'pesel', 'long-secret', 'url-credentials', 'url-fragment', 'form-value']) {
      expect(ALWAYS_RULES).toContain(rule);
    }
    for (const rule of DEFAULT_RULES) expect(ALWAYS_RULES).not.toContain(rule);
    expect(Object.isFrozen(ALWAYS_RULES) && Object.isFrozen(DEFAULT_RULES)).toBe(true);
  });

  it('secretKeyRule: skill list as words, camelCase, session suffixes', () => {
    const table = [
      ['access_token', 'key-token'], ['accessToken', 'key-token'], ['X-Auth-Token', 'key-token'], ['API_KEY', 'key-api_key'],
      ['x-api-key', 'key-key'], ['Authorization', 'key-authorization'], ['Proxy-Authorization', 'key-authorization'],
      ['Set-Cookie', 'key-cookie'], ['X-CSRF-Header', 'key-csrf'], ['user[password]', 'key-password'], ['data-token', 'key-token'],
      ['JSESSIONID', 'key-session'], ['PHPSESSID', 'key-session'], ['ASP.NET_SessionId', 'key-session'], ['jsessionid', 'key-session'],
      ['csrf-token', 'key-token'], ['pin', 'key-pin'],
      ['tokenizer', null], ['keyboard', null], ['author', null], ['monkey', null], ['pinned', null], ['sidebar', null],
      ['description', null], ['', null], ['k'.repeat(300) + '_token', null],
      // F6 (review E3, user decision 2026-10-26): cvv, cvc, pass as words, pw as the whole key only.
      ['cvv', 'key-cvv'], ['card_cvv', 'key-cvv'], ['CVC', 'key-cvc'], ['pass', 'key-pass'], ['user_pass', 'key-pass'],
      ['passPhrase', 'key-pass'], ['pw', 'key-pw'], ['PW', 'key-pw'], ['password', 'key-password'],
      ['passenger', null], ['compass', null], ['bypass', null], ['passport', null], ['pwa', null], ['new_pw', null],
      // F5: code and ticket are URL-only keys (maskUrl), not text keys.
      ['code', null], ['ticket', null],
    ];
    for (const [name, rule] of table) expect([name, secretKeyRule(name)]).toEqual([name, rule]);
    expect(secretKeyRule(undefined)).toBe(null);
  });
});

describe('corpora (AC-3.1, AC-5.1, E3-TEST1)', () => {
  it('sensitive corpus: 0 leaks — no secret nor any 8-char fragment of it in output', () => {
    expect(sensitive.length).toBeGreaterThanOrEqual(50);
    const problems = [];
    for (const item of sensitive) {
      const { text, applied } = run(item);
      for (const secret of item.secrets) for (const f of leaks(secret, text)) problems.push(`${item.id}: leaks "${f}" in ${text}`);
      if (!text.includes(`[redacted:${item.rule}]`)) problems.push(`${item.id}: no [redacted:${item.rule}] in ${text}`);
      if (applied < 1) problems.push(`${item.id}: applied 0`);
      if (item.text.startsWith('{') && parses(item.text)) {
        try { JSON.parse(text); } catch { problems.push(`${item.id}: JSON broken: ${text}`); }
      }
    }
    expect(problems).toEqual([]);
  });

  it('sensitive corpus covers every Always pattern and every E3-IN2 case', () => {
    const rules = new Set(sensitive.map((i) => i.rule));
    for (const rule of ['jwt', 'bearer', 'basic', 'card', 'iban', 'pesel', 'long-secret', 'url-credentials', 'url-fragment', 'email', 'phone', 'key-session']) {
      expect(rules).toContain(rule);
    }
    for (const id of ['in2-jsessionid', 'in2-phpsessid', 'in2-basic-text', 'in2-xml-token', 'in2-colon-password', 'in2-json-pin-number']) {
      expect(sensitive.map((i) => i.id)).toContain(id);
    }
  });

  it('benign corpus: ≤ 2 false positives, each listed with reason', () => {
    expect(benign.length).toBeGreaterThanOrEqual(50);
    const changed = benign.filter((item) => run(item).text !== item.text);
    // Every changed item must carry a documented `falsePositive` reason; undocumented ones are listed with the output.
    expect(changed.filter((item) => !item.falsePositive).map((item) => `${item.id}: ${run(item).text}`)).toEqual([]);
    expect(changed.length).toBeLessThanOrEqual(2);
    // A documented false positive that no longer fires should lose its note.
    expect(benign.filter((item) => item.falsePositive && run(item).text === item.text).map((i) => i.id)).toEqual([]);
  });

  it('benign corpus with Always rules only (email/phone off): no change at all', () => {
    const changed = benign.filter((item) => run(item, {}).text !== item.text).map((i) => i.id);
    expect(changed).toEqual([]);
  });

  it('maskText is idempotent and second pass applies 0', () => {
    for (const item of [...sensitive, ...benign]) {
      const once = run(item);
      const twice = run({ ...item, text: once.text });
      expect([item.id, twice.text]).toEqual([item.id, once.text]);
      expect([item.id, twice.applied]).toEqual([item.id, 0]);
    }
  });
});

describe('maskText forms (E3-IN2)', () => {
  it('JSON stays valid after masking string, number and boolean values', () => {
    const body = JSON.stringify({ pin: 1234, otp: -12.5e3, session: true, private: false, token: null, password: 'a"b\\c', nested: { api_key: 'x' }, ok: 1 });
    const { text, applied } = maskText(body);
    expect(JSON.parse(text)).toEqual({
      pin: '[redacted:key-pin]', otp: '[redacted:key-otp]', session: '[redacted:key-session]', private: '[redacted:key-private]',
      token: null, password: '[redacted:key-password]', nested: { api_key: '[redacted:key-api_key]' }, ok: 1,
    });
    expect(applied).toBe(6);
    const pretty = JSON.stringify({ pin: 1234, list: [1, 2] }, null, 2);
    expect(JSON.parse(maskText(pretty).text)).toEqual({ pin: '[redacted:key-pin]', list: [1, 2] });
  });

  it('XML element and attribute forms masked', () => {
    expect(maskText('<r><token>abc123</token><name>Jan</name></r>').text).toBe('<r><token>[redacted:key-token]</token><name>Jan</name></r>');
    expect(maskText('<x:Password type="t">p</x:Password>').text).toBe('<x:Password type="t">[redacted:key-password]</x:Password>');
    expect(maskText('<input name="q" data-token="abc" data-x=\'1\'>').text).toBe('<input name="q" data-token="[redacted:key-token]" data-x=\'1\'>');
    expect(maskText("<a data-secret='s1'>").text).toBe("<a data-secret='[redacted:key-secret]'>");
    const escaped = JSON.stringify({ html: '<div data-csrf="Kq9z">' });
    expect(JSON.parse(maskText(escaped).text)).toEqual({ html: '<div data-csrf="[redacted:key-csrf]">' });
    expect(maskText('<token></token>').text).toBe('<token></token>');
  });

  it('colon form ends at line end, comma, semicolon or brace; cookie keys take the whole line', () => {
    expect(maskText('password: abc, user: jan').text).toBe('password: [redacted:key-password], user: jan');
    expect(maskText('{token: xyz}').text).toBe('{token: [redacted:key-token]}');
    expect(maskText('Cookie: a=1; sid=2; c=3\nHost: x').text).toBe('Cookie: [redacted:key-cookie]\nHost: x');
    expect(maskText('Retry-After: 120\nStatus: OK').text).toBe('Retry-After: 120\nStatus: OK');
    expect(maskText('see https://example.com/token: here').text).toBe('see https://example.com/token: [redacted:key-token]');
  });

  it('Basic, Bearer and JWT patterns', () => {
    expect(maskText('Basic dXNlcjpwYXNz').text).toBe('Basic [redacted:basic]');
    expect(maskText('Basic auth enabled').text).toBe('Basic auth enabled');
    expect(maskText('x Bearer FAKEtoken0123456789abcd y').text).toBe('x Bearer [redacted:bearer] y');
    expect(maskText(`<b>${JWT}</b>`).text).toBe('<b>[redacted:jwt]</b>');
  });

  it('card requires Luhn and IIN; 13-digit ms timestamps not masked', () => {
    expect(maskText('4111 1111 1111 1111').text).toBe('[redacted:card]');
    expect(maskText('4111 1111 1111 1112').text).toBe('4111 1111 1111 1112');
    expect(maskText('9111111111111111'.replace(/.$/, '7')).text).toBe('9111111111111117');
    for (const ts of ['1729936800123', '1700000000000', '1234567890123']) expect(maskText(`t=${ts}`.replace('t=', 't ')).text).toBe(`t ${ts}`);
    // A 13-digit ms timestamp that passes Luhn still has IIN prefix 1 → kept.
    const luhnTs = ['172993680012', '0'].join('');
    let ts = luhnTs;
    for (let d = 0; d < 10; d++) if (luhn(luhnTs.slice(0, 12) + d)) ts = luhnTs.slice(0, 12) + d;
    expect(luhn(ts)).toBe(true);
    expect(maskText(`at ${ts}`).text).toBe(`at ${ts}`);
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
  });

  it('pesel requires checksum and valid month', () => {
    expect(peselValid('85011501232')).toBe(true);
    expect(peselValid('02213012348')).toBe(true);
    expect(peselValid('85011501233')).toBe(false);
    // Month 13 with a correct checksum is still rejected.
    const base = '8513150123';
    const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
    const sum = [...base].reduce((s, c, i) => s + w[i] * Number(c), 0);
    const badMonth = base + ((10 - (sum % 10)) % 10);
    expect(peselValid(badMonth)).toBe(false);
    expect(maskText(`nr ${badMonth}`).text).toBe(`nr ${badMonth}`);
    expect(maskText('PESEL 85011501232').text).toBe('PESEL [redacted:pesel]');
    expect(maskText('PESEL 85011501233').text).toBe('PESEL 85011501233');
  });

  it('iban mod-97', () => {
    expect(ibanValid('PL61109010140000071219812874')).toBe(true);
    expect(ibanValid('PL61 1090 1014 0000 0712 1981 2874')).toBe(true);
    expect(ibanValid('PL62109010140000071219812874')).toBe(false);
    expect(maskText('PL62109010140000071219812874').text).toBe('PL62109010140000071219812874');
    expect(maskText('to PL61109010140000071219812874.').text).toBe('to [redacted:iban].');
  });

  it('long-secret: entropy, digits and letters; hex, paths, file names and data URIs kept', () => {
    expect(shannon('aaaa')).toBe(0);
    expect(shannon('abcd')).toBe(2);
    expect(maskText('k sk_live_4eC39HqLyjWDarjtT1zdp7dc').text).toBe('k [redacted:long-secret]');
    expect(maskText('9fceb02d0ae598e95dc970b74767f19372d61af8').text).toBe('9fceb02d0ae598e95dc970b74767f19372d61af8');
    expect(maskText('/assets/Ab3dEf9hIjK2mNoPqRsTuVwXyZ01234.js').text).toBe('/assets/Ab3dEf9hIjK2mNoPqRsTuVwXyZ01234.js');
    expect(maskText('/v1/files/Ab3dEf9hIjK2mNoPqRsTuVwXyZ01234567/raw').text).toBe('/v1/files/[redacted:long-secret]/raw');
    expect(maskText('k sk_live_4eC39HqLyjWDarjtT1zdp7dc', { longSecret: false }).text).toBe('k sk_live_4eC39HqLyjWDarjtT1zdp7dc');
  });

  it('url-credentials in text', () => {
    expect(maskText('redis://default:Pa55word@cache:6379').text).toBe('redis://[redacted:url-credentials]@cache:6379');
  });

  it('email/phone only when enabled', () => {
    const text = 'Jan jan@example.com tel +48 600 700 800';
    expect(maskText(text).text).toBe(text);
    expect(maskText(text, { email: true }).text).toBe('Jan [redacted:email] tel +48 600 700 800');
    expect(maskText(text, { phone: true }).text).toBe('Jan jan@example.com tel [redacted:phone]');
    expect(maskText(text, { email: true, phone: true }).applied).toBe(2);
    expect(maskText('react@18.2.0', { email: true }).text).toBe('react@18.2.0');
  });

  it('non-string input and fast path', () => {
    expect(maskText(undefined)).toEqual({ text: '', applied: 0 });
    expect(maskText(42)).toEqual({ text: '', applied: 0 });
    expect(maskText('ok')).toEqual({ text: 'ok', applied: 0 });
    expect(maskText('plain words only')).toEqual({ text: 'plain words only', applied: 0 });
  });
});

describe('review E3 F1–F3, F8: nested, encoded, unclosed and quoted forms', () => {
  it('F1: pairs inside JSON strings at any escape level and in HTML entities', () => {
    const level1 = JSON.stringify({ a: JSON.stringify({ token: 'T1x', n: 1 }) });
    expect(JSON.parse(JSON.parse(maskText(level1).text).a)).toEqual({ token: '[redacted:key-token]', n: 1 });
    const level3 = JSON.stringify({ a: JSON.stringify({ b: JSON.stringify({ c: JSON.stringify({ password: 'p"w', pin: 12 }) }) }) });
    const out = JSON.parse(JSON.parse(JSON.parse(JSON.parse(maskText(level3).text).a).b).c);
    expect(out).toEqual({ password: '[redacted:key-password]', pin: '[redacted:key-pin]' });
    expect(maskText('<i data-p="{&quot;apiKey&quot;:&quot;k1&quot;,&quot;n&quot;:&quot;x&quot;}">').text)
      .toBe('<i data-p="{&quot;apiKey&quot;:&quot;[redacted:key-api_key]&quot;,&quot;n&quot;:&quot;x&quot;}">');
    expect(maskText('{&#34;pin&#34;:1234,&#x22;sid&#x22;:&#x22;s9&#x22;}').text)
      .toBe('{&#34;pin&#34;:&#34;[redacted:key-pin]&#34;,&#x22;sid&#x22;:&#x22;[redacted:key-sid]&#x22;}');
    // An inner escaped quote does not end the value; the value of a non-secret key is still scanned.
    expect(maskText('{"msg":"x {\\"secret\\":\\"a\\\\\\"b\\"}"}').text).toBe('{"msg":"x {\\"secret\\":\\"[redacted:key-secret]\\"}"}');
  });

  it('F2: a value cut at the end of the text or before the truncation note is masked to the cut', () => {
    expect(maskText('{"a":1,"password":"abc').text).toBe('{"a":1,"password":"[redacted:key-password]');
    expect(maskText('{"pin":12').text).toBe('{"pin":"[redacted:key-pin]"');
    expect(maskText('{"token":"abc... [truncated 5 chars]').text).toBe('{"token":"[redacted:key-token]... [truncated 5 chars]');
    expect(maskText('["{\\"token\\":\\"abc').text).toBe('["{\\"token\\":\\"[redacted:key-token]');
    expect(maskText('<a><secret>abc... [truncated 9 chars]').text).toBe('<a><secret>[redacted:key-secret]... [truncated 9 chars]');
    expect(maskText('<a><secret>abc</sec').text).toBe('<a><secret>[redacted:key-secret]</sec');
    expect(maskText('<i data-token="abc').text).toBe('<i data-token="[redacted:key-token]');
    expect(maskText('<i data-p="{&quot;sid&quot;:&quot;abc"></i>').text).toBe('<i data-p="{&quot;sid&quot;:&quot;[redacted:key-sid]"></i>');
    // A raw line break ends an unclosed JSON value; the next line stays.
    expect(maskText('"token":"abc\nnext line').text).toBe('"token":"[redacted:key-token]\nnext line');
    expect(maskText('{"title":"cut text').text).toBe('{"title":"cut text');
  });

  it('F3: `key: "value"` with an unquoted or single-quoted key, also YAML and escaped quotes', () => {
    expect(maskText('config: {password: "Qu\\"oted", user: "jan"}').text).toBe('config: {password: "[redacted:key-password]", user: "jan"}');
    expect(maskText("{'token': \"abc\"}").text).toBe("{'token': \"[redacted:key-token]\"}");
    expect(maskText('db:\n  password: "x y"\n  host: "h"').text).toBe('db:\n  password: "[redacted:key-password]"\n  host: "h"');
    expect(maskText('["cfg: {secret: \\"s1\\"}"]').text).toBe('["cfg: {secret: \\"[redacted:key-secret]\\"}"]');
    expect(maskText('label: "Zapisz"').text).toBe('label: "Zapisz"');
  });

  it('F8: a `;key=value` path parameter in text ends at `?`', () => {
    expect(maskText('at https://a.pl/app;jsessionid=ABC123?x=1&y=2').text).toBe('at https://a.pl/app;jsessionid=[redacted:key-session]?x=1&y=2');
    expect(maskText('a=1;token=abc/def+==').text).toBe('a=1;token=[redacted:key-token]');
  });

  it('QA F-3: a digit run inside a UUID or a hex id is not a card', () => {
    for (const id of ['4e457417-4723-411c-80a8-8318a1d04aa0', '25daeac4-6434-4664-8787-c5574af969d3', '19afa557-7871-4736-8251-83d29347ab54']) {
      expect(maskText(`x-ms-request-id: ${id}`).text).toBe(`x-ms-request-id: ${id}`);
    }
    expect(maskText('karta 4111-1111-1111-1111, ok').text).toBe('karta [redacted:card], ok');
    expect(maskText('{"n":"4111111111111111"}').text).toBe('{"n":"[redacted:card]"}');
  });
});

describe('retest E3-PD2 and re-review N1, N2, N4', () => {
  it('E3-PD2: code/ticket in a URL inside text (stack frame) masked; the :line:col suffix is kept', () => {
    const stack = 'Error: boom\n    at http://127.0.0.1:5173/traps-e3.html?code=acf7b294aea5fb:44:15';
    expect(maskText(stack)).toEqual({ text: 'Error: boom\n    at http://127.0.0.1:5173/traps-e3.html?code=[redacted:key-code]:44:15', applied: 1 });
    expect(maskText('at f (https://a.example.test/x.js?token=abc&ticket=ST-1:2:3)').text)
      .toBe('at f (https://a.example.test/x.js?token=[redacted:key-token]&ticket=[redacted:key-ticket]:2:3)');
    expect(maskText('at https://a.example.test/cb?code=c0de#top:3:9').text).toBe('at https://a.example.test/cb?code=[redacted:key-code]#top:3:9');
    // Text keys stay as they were: `code` is sensitive only inside a URL.
    expect(maskText('code=PL, see https://a.example.test/?code=X1').text).toBe('code=PL, see https://a.example.test/?code=[redacted:key-code]');
    const benignStack = 'Error: boom\n    at f (https://cdn.example.test/main.js?v=3:2:31)\n    at http://127.0.0.1:5173/p.html?country_code=PL:44:15';
    expect(maskText(benignStack, ALL)).toEqual({ text: benignStack, applied: 0 });
    const once = maskText(stack).text;
    expect(maskText(once)).toEqual({ text: once, applied: 0 });
  });

  it('N1: a card after a word and a dash is masked; a digit run inside a UUID is not', () => {
    expect(maskText('order-id-5555555555554444').text).toBe('order-id-[redacted:card]');
    expect(maskText('4111111111111111-a').text).toBe('[redacted:card]-a');
    expect(maskText('card-4111111111111111').text).toBe('card-[redacted:card]');
    for (const id of ['19afa557-7871-4736-8251-83d29347ab54', 'req-25daeac4-6434-4664-8787-c5574af969d3']) expect(maskText(id).text).toBe(id);
  });

  it('N2: percent-encoded JSON in a form value masks the whole value', () => {
    expect(maskText('payload=%7B%22password%22%3A%22UrlEncPwd5%22%7D&remember=1').text).toBe('payload=[redacted:key-password]&remember=1');
    expect(maskText('next=%2Fcart%3Fpage%3D2&q=buty%20zimowe').text).toBe('next=%2Fcart%3Fpage%3D2&q=buty%20zimowe');
    expect(maskText('bad=%E0%A4%A&x=1').text).toBe('bad=%E0%A4%A&x=1'); // invalid encoding: kept, no throw
  });

  it('N4: XML with `<` as an entity (dom.structure attributes and text) is masked, also cut at the end', () => {
    expect(maskText('<div data-xml="&lt;password>Xml1&lt;/password>"></div>').text)
      .toBe('<div data-xml="&lt;password>[redacted:key-password]&lt;/password>"></div>');
    expect(maskText('&lt;token&gt;abc&amp;def&lt;/token&gt;').text).toBe('&lt;token&gt;[redacted:key-token]&lt;/token&gt;');
    expect(maskText('<pre>&lt;secret>CutS3c').text).toBe('<pre>&lt;secret>[redacted:key-secret]');
    expect(maskText('&lt;title>Raport&lt;/title>').text).toBe('&lt;title>Raport&lt;/title>');
  });
});

describe('E4-IN1, E4-IN3: key at the start of a JSON string, prose, code/ticket in text (D9, PB-2)', () => {
  it('sensitive corpus has the in1/in3 cases; benign has the prose and code cases', () => {
    const ids = sensitive.map((i) => i.id);
    for (const id of ['in1-json-start', 'in1-json-start-esc', 'in1-auth-code', 'in1-password-phrase', 'in3-relative', 'in3-amp',
      'in3-hash', 'in3-ticket', 'in3-json-escaped', 'in1b-error-prefix', 'in1b-uncaught-error', 'in1b-type-error', 'in1b-warning',
      'in1b-chain', 'in1b-chain-long', 'in1b-mid-sentence', 'in1b-json-prefix', 'in1b-json-prefix-esc']) expect(ids).toContain(id);
    const benignIds = benign.map((i) => i.id);
    for (const id of ['in1-prose-auth', 'in1-prose-session', 'in3-benign-json', 'in3-benign-country', 'in3-benign-error']) expect(benignIds).toContain(id);
  });

  it('key: value after another key-like token (Error:, TypeError:, chains, mid-sentence) masked (E4-IN1b)', () => {
    const table = [
      ['Error: password: Hunter2Secret!', 'Error: password: [redacted:key-password]'],
      ['Error: x-api-key: 9f8e7d6c5b4a', 'Error: x-api-key: [redacted:key-key]'],
      ['Uncaught Error: token: abc123def456', 'Uncaught Error: token: [redacted:key-token]'],
      ['TypeError: secret: s3cr3t', 'TypeError: secret: [redacted:key-secret]'],
      ['Warning: pin: 1234', 'Warning: pin: [redacted:key-pin]'],
      ['user: jan password: Pa55word!', 'user: jan password: [redacted:key-password]'],
      ['a: b: c: token: t0k3n, next: 1', 'a: b: c: token: [redacted:key-token], next: 1'],
      ['the server said: token: Zx9Yw8Vu7Ts6', 'the server said: token: [redacted:key-token]'],
      ['{"log":"Error: password: hunter2x"}', '{"log":"Error: password: [redacted:key-password]"}'],
    ];
    for (const [input, output] of table) {
      expect([input, maskText(input)]).toEqual([input, { text: output, applied: 1 }]);
      expect([input, maskText(output).applied]).toEqual([input, 0]);
    }
    // Prose (PB-2) and plain messages with a prefix stay as they are.
    for (const text of ['Error: auth: "Invalid credentials"', 'Error: Network request failed', 'Warning: session expired: log in again',
      'Error: Failed to load resource: the server responded with a status of 404', 'TypeError: Failed to fetch: https://a.example.com/x']) {
      expect(maskText(text, ALL)).toEqual({ text, applied: 0 });
    }
  });

  it('a long line of non-secret key: tokens stays linear (E4-IN1b)', () => {
    for (const input of ['a: '.repeat(40000), 'Error: '.repeat(20000), `${'k'.repeat(250)}: `.repeat(400), 'a: b'.repeat(30000)]) {
      const start = performance.now();
      maskText(input, ALL);
      expect([input.slice(0, 12), performance.now() - start < 300]).toEqual([input.slice(0, 12), true]);
    }
  });

  it('a secret value followed by a long run of blanks stays linear, same masking (E4-FIX3)', () => {
    for (const n of [40000, 200000]) {
      for (const [input, expected] of [
        [`'password: x${' '.repeat(n)}y'`, `'password: [redacted:key-password]'`],
        [`'password: x${' '.repeat(n)}'`, `'password: [redacted:key-password]${' '.repeat(n)}'`],
        [`password: x${' '.repeat(n)}y`, 'password: [redacted:key-password]'],
        [`password: x${' '.repeat(n)}`, `password: [redacted:key-password]${' '.repeat(n)}`],
        [`'password: x${' \t'.repeat(n / 2)}y'`, `'password: [redacted:key-password]'`],
        [`password: x${'\t'.repeat(n)}`, `password: [redacted:key-password]${'\t'.repeat(n)}`],
        [`Cookie: sid=1${' '.repeat(n)}y`, 'Cookie: [redacted:key-cookie]'],
        [`'password: ${' \t'.repeat(n / 2)}'`, `'password: ${' \t'.repeat(n / 2)}'`],
      ]) {
        const start = performance.now();
        const { text } = maskText(input, ALL);
        expect([input.slice(0, 14), n, performance.now() - start < 300]).toEqual([input.slice(0, 14), n, true]);
        expect(text).toBe(expected);
      }
    }
  });

  it('{"log":"password: x"} masked and stays valid JSON; the escaped form too (AC-2.3)', () => {
    const { text, applied } = maskText('{"log":"password: x"}');
    expect(text).toBe('{"log":"password: [redacted:key-password]"}');
    expect(applied).toBe(1);
    expect(JSON.parse(text)).toEqual({ log: 'password: [redacted:key-password]' });
    const escaped = JSON.stringify(JSON.stringify({ msg: 'token: abcd1234efgh' }));
    expect(JSON.parse(JSON.parse(maskText(escaped).text))).toEqual({ msg: 'token: [redacted:key-token]' });
    // A JSON key `"k":` is still a JSON key (BARE/QUOTED forms), not a colon pair.
    expect(maskText('{"password":"p1","n":"x"}').text).toBe('{"password":"[redacted:key-password]","n":"x"}');
  });

  it('auth: "Invalid credentials" unchanged; auth: "a1b2c3d4e5" masked; password: "correct horse battery" masked (PB-2)', () => {
    for (const text of ['auth: "Invalid credentials"', 'session: "Expired session"', 'key: "Not found."', 'Auth: "Zła sesja"']) {
      expect(maskText(text, ALL)).toEqual({ text, applied: 0 });
    }
    expect(maskText('auth: "a1b2c3d4e5"').text).toBe('auth: "[redacted:key-auth]"');
    expect(maskText('password: "correct horse battery"').text).toBe('password: "[redacted:key-password]"');
    // Only an unquoted key, only auth/session/key, only ≥ 2 words of letters.
    expect(maskText("'auth': \"Invalid credentials\"").text).toBe("'auth': \"[redacted:key-auth]\"");
    expect(maskText('token: "Invalid credentials"').text).toBe('token: "[redacted:key-token]"');
    expect(maskText('auth: "Invalid"').text).toBe('auth: "[redacted:key-auth]"');
    expect(maskText('session: "abc def-1"').text).toBe('session: "[redacted:key-session]"');
    expect(maskText('auth_token: "Invalid credentials"').text).toBe('auth_token: "[redacted:key-token]"');
  });

  it('/cb?code=, &code=, #code=, ticket, https:\\/\\/…?code= masked; {"code":"PL"}, country_code=PL unchanged (AC-2.4)', () => {
    expect(maskText('GET /cb?code=SplxlOBeZQQYbYS6 failed').text).toBe('GET /cb?code=[redacted:key-code] failed');
    expect(maskText('to /cb?state=xyz&code=abc123xyz failed').text).toBe('to /cb?state=xyz&code=[redacted:key-code] failed');
    expect(maskText('on /cb#code=abc123xyz&state=1').text).toBe('on /cb#code=[redacted:key-code]&state=1');
    expect(maskText('/cas/login?TICKET=ST-1234-abcd').text).toBe('/cas/login?TICKET=[redacted:key-ticket]');
    expect(maskText('<a href="/cb?a=1&amp;code=abc123xyz">').text).toBe('<a href="/cb?a=1&amp;code=[redacted:key-code]">');
    const escaped = JSON.stringify({ next: 'https://a.pl/cb?code=SplxlOBeZQQ' }).replace(/\//g, '\\/');
    expect(JSON.parse(maskText(escaped).text)).toEqual({ next: 'https://a.pl/cb?code=[redacted:key-code]' });
    for (const text of ['{"code":"PL"}', 'country_code=PL', 'error code=42', 'zip_code=00-950&ticket_type=vip']) {
      expect(maskText(text, ALL)).toEqual({ text, applied: 0 });
    }
    const once = maskText('GET /cb?code=SplxlOBeZQQYbYS6&ticket=ST-1 failed');
    expect(once.applied).toBe(2);
    expect(maskText(once.text)).toEqual({ text: once.text, applied: 0 });
  });
});

describe('maskUrl (AC-3.3, E3-IN3)', () => {
  it('F5: code and ticket are sensitive in the query and the fragment of a URL only', () => {
    expect(maskUrl('https://a.example.com/cb?code=c0de&state=1').text).toBe('https://a.example.com/cb?code=[redacted:key-code]&state=1');
    expect(maskUrl('https://a.example.com/cas?TICKET=ST-1').text).toBe('https://a.example.com/cas?TICKET=[redacted:key-ticket]');
    expect(maskUrl('https://a.example.com/cb#code=c0de&state=1').text).toBe('https://a.example.com/cb#[redacted:url-fragment]');
    expect(maskUrl('https://a.example.com/x?country_code=PL&promo=ticket').text).toBe('https://a.example.com/x?country_code=PL&promo=ticket');
    expect(maskText('{"code":"PL"} code=PL ticket: T-1').text).toBe('{"code":"PL"} code=PL ticket: T-1');
  });

  it('maskUrl: query by key, ;jsessionid, credentials, token fragment → whole fragment; benign query kept', () => {
    expect(maskUrl('https://a.example.com/p?x=1&access_token=abc&y=2').text).toBe('https://a.example.com/p?x=1&access_token=[redacted:key-token]&y=2');
    expect(maskUrl('https://a.example.com/c;jsessionid=AB12?x=1').text).toBe('https://a.example.com/c;jsessionid=[redacted:key-session]?x=1');
    expect(maskUrl('https://u:p4ss@a.example.com/').text).toBe('https://[redacted:url-credentials]@a.example.com/');
    expect(maskUrl('https://a.example.com/cb#access_token=t0k&state=s').text).toBe('https://a.example.com/cb#[redacted:url-fragment]');
    expect(maskUrl('https://a.example.com/cb?state=s#id_token=x').text).toBe('https://a.example.com/cb?state=s#[redacted:url-fragment]');
    expect(maskUrl('https://a.example.com/s?q=buty&page=2#top').text).toBe('https://a.example.com/s?q=buty&page=2#top');
    expect(maskUrl('/relative/path?sid=1').text).toBe('/relative/path?sid=[redacted:key-sid]');
    expect(maskUrl('https://a.example.com/p?token=&flag&a%5Ftoken=z').text).toBe('https://a.example.com/p?token=&flag&a%5Ftoken=[redacted:key-token]');
  });

  it('encoded nested URL in a query value: a secret inside masks the whole value', () => {
    expect(maskUrl('https://a.example.com/x?redirect=https%3A%2F%2Fb.example.com%2F%3Ftoken%3Dabc&lang=pl').text)
      .toBe('https://a.example.com/x?redirect=[redacted:key-token]&lang=pl');
    expect(maskUrl('https://a.example.com/x?next=%2Fcart%3Fpage%3D2').text).toBe('https://a.example.com/x?next=%2Fcart%3Fpage%3D2');
  });

  it('does not normalise the address', () => {
    for (const url of ['HTTPS://A.EXAMPLE.COM:443/./x/../y?b=2&a=1', 'about:blank', 'data:text/plain,hi', 'blob:https://a.example.com/550e8400-e29b-41d4-a716-446655440000', '']) {
      expect(maskUrl(url).text).toBe(url);
    }
    expect(maskUrl(undefined)).toEqual({ text: '', applied: 0 });
  });

  it('email in URL when enabled, phone never', () => {
    const url = 'https://a.example.com/u?e=jan@example.com&t=600700800';
    expect(maskUrl(url).text).toBe(url);
    expect(maskUrl(url, { email: true, phone: true }).text).toBe('https://a.example.com/u?e=[redacted:email]&t=600700800');
  });

  it('idempotent; second pass applies 0', () => {
    const url = `https://u:p@a.example.com/c;jsessionid=1?token=2&e=j@x.pl#access_token=${JWT}`;
    const once = maskUrl(url, ALL);
    expect(once.applied).toBe(5);
    expect(maskUrl(once.text, ALL)).toEqual({ text: once.text, applied: 0 });
  });
});

describe('maskSecrets compatibility (E2 contract)', () => {
  it('maskSecrets keeps E2 contract', () => {
    expect(maskSecrets('{"pin":1234}')).toEqual({ text: '{"pin":1234}', masked: 0 });
    expect(maskSecrets('{"token":"a"}')).toEqual({ text: '{"token":"[redacted:key-token]"}', masked: 1 });
    expect(maskSecrets('4111 1111 1111 1111').text).toBe('[redacted:card]');
    expect(maskSecrets('a@b.pl +48 600 700 800').text).toBe('a@b.pl +48 600 700 800');
  });
});

describe('performance and purity', () => {
  it('5 MB text masked in ≤ 700 ms', () => {
    const chunk = `{"t":1729936800123,"url":"https://api.example.com/v2/orders/550e8400-e29b-41d4-a716-446655440000?page=2&token=abc",`
      + `"msg":"Użytkownik jan@example.com zapłacił 19,99 zł kartą 4111 1111 1111 1111","stack":"at f (https://cdn.example.com/main.4f3a2b1c.js:2:31)"}\n`;
    const text = chunk.repeat(Math.ceil((5 * 1024 * 1024) / chunk.length));
    maskText(chunk, ALL);
    const start = performance.now();
    const { text: out } = maskText(text, ALL);
    const ms = performance.now() - start;
    expect(out).not.toContain('4111 1111');
    expect(ms).toBeLessThan(700);
  });

  it('adversarial input stays fast (no catastrophic backtracking)', () => {
    const inputs = [
      'a-'.repeat(32000), 'aaaaaaaaaaaa.'.repeat(5000), '"k":"'.repeat(13000), '"pin": '.repeat(10000), 'x='.repeat(32000),
      'Bearer '.repeat(9000), 'token: '.repeat(9000), '<token>'.repeat(9000), 'a@'.repeat(32000), 'a.b@'.repeat(16000),
      '1 '.repeat(32000), '1-'.repeat(32000), 'PL61 '.repeat(13000), 'A'.repeat(64000), 'aB3+'.repeat(16000),
      'k="'.repeat(20000), 'http://'.repeat(9000) + 'a@', `${'a'.repeat(300)}=v `.repeat(200),
    ];
    for (const input of inputs) {
      const start = performance.now();
      maskText(input, ALL);
      maskUrl(input, ALL);
      expect([input.slice(0, 12), performance.now() - start < 300]).toEqual([input.slice(0, 12), true]);
    }
  });

  it('module is pure: no imports, no DOM, generator-friendly syntax', () => {
    expect(source).not.toMatch(/^import /m);
    expect(source).not.toMatch(/\b(window|document|globalThis|self)\b/);
    expect(source).not.toMatch(/\bfetch\(|\bimport\(|\brequire\(|import\.meta|getURL\(|\Wurl\(|new URL/);
  });
});
