// @vitest-environment jsdom
/* global document -- jsdom globals (vitest-environment jsdom) */
// Review E3 F1, F2: secrets in JSON nested in strings or in HTML entities, and values cut by the MAIN limits before the
// background redaction. Each cut is made by the real MAIN code (safeSlice, serializeCapped, serializeDom) at the limit,
// with the secret split by the cut; the redacted package must not keep the kept part of the secret.
import { describe, it, expect } from 'vitest';
import { redact } from '../../src/lib/redact.js';
import { safeSlice, serializeCapped } from '../../src/page/serialize.js';
import { serializeDom, DOM_STRUCTURE_MAX_CHARS } from '../../src/page/dom-structure.js';
import { COLLECTOR_LIMITS } from '../../src/page/collector.js';
import { NETWORK_LIMITS } from '../../src/page/hooks-network.js';
import { LIMITS as RECORDER_LIMITS } from '../../src/page/constants.js';

const SECRET = 'CutBoundaryPwd123';
const KEPT = SECRET.slice(0, 6); // the part of the secret left before each cut
const json = (value) => JSON.stringify(value);

// `{"x":"aaa…","password":"CutBoundaryPwd123"}` with the filler sized so that `render(text)` puts the cut 6 characters
// into the secret.
function trapAt(limit, render = (s) => s) {
  const make = (n) => `{"x":"${'a'.repeat(n)}","password":"${SECRET}"}`;
  const offset = render(make(0)).indexOf(SECRET);
  return make(limit - offset - KEPT.length);
}

describe('F2: a secret split by a MAIN cut is masked (all four limits)', () => {
  it('network[].requestBody: 5000 characters + "... [truncated N chars]"', () => {
    const limit = NETWORK_LIMITS.bodyChars;
    expect(limit).toBe(5000);
    const body = safeSlice(trapAt(limit), limit);
    expect(body).toContain(`"password":"${KEPT}... [truncated`);
    const { snapshot } = redact({ network: [{ url: 'https://a.example.test/login', requestBody: body }] });
    expect(json(snapshot)).not.toContain(KEPT);
    expect(snapshot.network[0].requestBody).toMatch(/"password":"\[redacted:key-password\]\.\.\. \[truncated \d+ chars\]$/);
  });

  it('storage values: 5000 characters + "... [truncated N chars]"', () => {
    const limit = COLLECTOR_LIMITS.storageValue;
    expect(limit).toBe(5000);
    const value = safeSlice(trapAt(limit), limit);
    const { snapshot } = redact({ storage: { cookies: '', localStorage: { form: value }, sessionStorage: { form: value } } });
    expect(json(snapshot)).not.toContain(KEPT);
    expect(snapshot.storage.localStorage.form).toContain('"password":"[redacted:key-password]... [truncated');
  });

  it('consoleLogs[].args: preview of the first 40 000 characters of the JSON', () => {
    const limit = RECORDER_LIMITS.entryChars;
    expect(limit).toBe(40000);
    const arg = trapAt(limit, (s) => json(['big', s]));
    const { value, truncated } = serializeCapped(['big', arg], limit);
    expect(truncated).toBe(true);
    expect(value.preview.endsWith(`\\"password\\":\\"${KEPT}`)).toBe(true);
    const { snapshot } = redact({ consoleLogs: [{ level: 'log', args: value }] });
    expect(json(snapshot)).not.toContain(KEPT);
    expect(snapshot.consoleLogs[0].args.preview.endsWith('\\"password\\":\\"[redacted:key-password]')).toBe(true);
  });

  it('dom.structure: data-* attribute value cut to 2000 characters, then escaped as &quot;', () => {
    const div = document.createElement('div');
    const limit = 2000;
    div.setAttribute('data-props', trapAt(limit));
    document.body.replaceChildren(div);
    const { html } = serializeDom(document, { mode: 'structure', maxChars: DOM_STRUCTURE_MAX_CHARS });
    expect(html).toContain(`&quot;password&quot;:&quot;${KEPT}"`);
    const { snapshot } = redact({ dom: { structure: html } });
    expect(json(snapshot)).not.toContain(KEPT);
    expect(snapshot.dom.structure).toContain('&quot;password&quot;:&quot;[redacted:key-password]"');
  });
});

describe('F1: JSON nested in strings and in HTML entities, in every section', () => {
  const persist = json({ account: json({ currentUser: { accessToken: '9f86d081884c7d659a2feaa0c55ad015', refreshToken: 'rf8Kq2Lm7Np', password: 'Pers1stPwd!x' } }) });
  const secrets = ['9f86d081884c7d659a2feaa0c55ad015', 'rf8Kq2Lm7Np', 'Pers1stPwd!x', 'dataApiK3y77'];

  it('redux-persist in storage, data-props in dom.structure, double-serialized JSON in console and requestBody', () => {
    const pkg = {
      storage: { cookies: '', localStorage: { 'persist:root': persist }, sessionStorage: {} },
      dom: { structure: '<div id="app" data-props="{&quot;user&quot;:{&quot;apiKey&quot;:&quot;dataApiK3y77&quot;}}"></div>' },
      consoleLogs: [{ level: 'log', args: ['state', persist, { raw: json(persist) }] }],
      network: [{ url: 'https://a.example.test/sync', requestBody: json({ payload: persist }) }],
    };
    const { snapshot } = redact(pkg);
    const text = json(snapshot);
    for (const secret of secrets) expect(text).not.toContain(secret);
    // Shape kept: the stored value still parses down to the masked object.
    const user = JSON.parse(JSON.parse(snapshot.storage.localStorage['persist:root']).account).currentUser;
    expect(user).toEqual({ accessToken: '[redacted:key-token]', refreshToken: '[redacted:key-token]', password: '[redacted:key-password]' });
    expect(snapshot.dom.structure).toBe('<div id="app" data-props="{&quot;user&quot;:{&quot;apiKey&quot;:&quot;[redacted:key-api_key]&quot;}}"></div>');
    expect(redact(snapshot)).toEqual({ snapshot, applied: 0 });
  });
});
