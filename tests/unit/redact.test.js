// @vitest-environment node
// E3-T2a: redaction engine and record sections (D1, D2; AC-3.2, 3.3, 3.6, 4.1, 4.2, 4.3, 4.5, 5.4).
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { redact, countMarkers, resolveDisabledRules } from '../../src/lib/redact.js';
import {
  JWT, TOKEN, EMAIL, PHONE, PASSWORD, CARD, COOKIE_SID, TRAPS, loadV3, leaks, countOccurrences, trapPackage,
} from './helpers/redaction-traps.js';

const json = (value) => JSON.stringify(value);
const noLeak = (value, secrets = TRAPS) => {
  const text = json(value);
  for (const secret of secrets) expect(leaks(secret, text), secret).toEqual([]);
};
const MARKER = /^\[redacted:[a-z0-9_*-]+\]$/;

// Every key path of a JSON value (array indices as `[]`), in order.
function keyPaths(value, prefix = '$', out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => keyPaths(v, `${prefix}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      out.push(`${prefix}.${key}`);
      keyPaths(value[key], `${prefix}.${key}`, out);
    }
  }
  return out;
}

const RECORD_ONLY = (pkg) => {
  // Page sections out of the way: these tests look at records; redact-page.test.js covers the rest.
  pkg.environment = null;
  pkg.performance = null;
  pkg.storage = null;
  pkg.dom = null;
  return pkg;
};

describe('redact: record sections with a trap value (AC-3.2)', () => {
  const { snapshot } = redact(trapPackage());
  const last = (list) => list[list.length - 1];

  it('network[].url', () => {
    const entry = last(snapshot.network);
    noLeak(entry.url);
    expect(entry.url).toContain('access_token=[redacted:key-token]');
    expect(entry.url).toContain('#[redacted:url-fragment]');
    expect(entry.url).toContain('page=2');
  });

  it('network[].requestHeaders', () => {
    const headers = last(snapshot.network).requestHeaders;
    noLeak(headers);
    expect(headers.authorization).toMatch(MARKER);
    expect(headers['x-api-key']).toMatch(MARKER);
    expect(headers.cookie).toMatch(MARKER);
    expect(headers.accept).toBe('application/json');
  });

  it('network[].responseHeaders', () => {
    const headers = last(snapshot.network).responseHeaders;
    noLeak(headers);
    expect(headers['set-cookie']).toBe('[redacted:key-cookie]');
    expect(headers['content-type']).toBe('application/json');
  });

  it('network[].requestBody (keys, numbers, e-mail, phone)', () => {
    const body = last(snapshot.network).requestBody;
    noLeak(body);
    const parsed = JSON.parse(body);
    expect(parsed).toEqual({
      email: '[redacted:email]', password: '[redacted:key-password]', phone: '[redacted:phone]', pin: '[redacted:key-pin]',
    });
  });

  it('network[].responseBodyPreview', () => {
    const preview = last(snapshot.network).responseBodyPreview;
    noLeak(preview);
    expect(JSON.parse(preview).error).toBe('bad token');
  });

  it('consoleLogs[].args: JSON strings, nested objects, Error.cause, numbers at secret keys', () => {
    const { args } = last(snapshot.consoleLogs);
    noLeak(args);
    expect(JSON.parse(args[0])).toBe('user [redacted:email] called [redacted:phone]');
    expect(JSON.parse(args[1])).toEqual({ user: { token: '[redacted:key-token]', pin: '[redacted:key-pin]', active: true }, card: '[redacted:card]' });
    expect(args[2].message).toBe('auth [redacted:jwt]');
    expect(args[2].cause.message).toBe('password=[redacted:key-password]');
    expect(args[3]).toEqual({
      password: '[redacted:key-password]', otp: '[redacted:key-otp]', remember: true, profile: { mail: '[redacted:email]' },
    });
  });

  it('consoleLogs[].stack and frame', () => {
    const entry = last(snapshot.consoleLogs);
    noLeak([entry.stack, entry.frame, entry.args[2].stack]);
    expect(entry.frame).toContain('#[redacted:url-fragment]');
  });

  it('runtimeErrors[].message/stack/reason/filename/frame', () => {
    const entry = last(snapshot.runtimeErrors);
    noLeak(entry);
    expect(entry.message).toBe('Uncaught Error: login failed for [redacted:email] with token=[redacted:key-token]');
    expect(entry.reason).toEqual({
      message: 'card [redacted:card]', password: '[redacted:key-password]', pin: '[redacted:key-pin]',
      nested: { apiKey: '[redacted:key-api_key]' },
    });
    expect(entry.filename).toContain('access_token=[redacted:key-token]');
  });

  it('steps[]: url, selector (without long-secret), text', () => {
    const [navigate, click] = snapshot.steps.slice(-2);
    noLeak([navigate, click]);
    expect(navigate.url).toContain('#[redacted:url-fragment]');
    expect(click.selector).toContain('[redacted:');
    expect(click.text).toBe('Wyślij do [redacted:email]');
  });

  it('steps[].selector keeps a long hashed class (long-secret is not applied to selectors)', () => {
    const pkg = RECORD_ONLY(loadV3());
    const selector = '.css-Zq8xK2vN9pLm4RtY7wB3cE6hJ1sD5fGa > button';
    pkg.steps.push({ t: 1, doc: 1, type: 'click', selector, text: 'OK' });
    expect(redact(pkg).snapshot.steps.at(-1).selector).toBe(selector);
  });

  it('documents[].url and notes', () => {
    noLeak(snapshot.documents);
    noLeak(snapshot.notes);
    expect(snapshot.notes.at(-1)).toContain('[redacted:email]');
    expect(snapshot.notes[0]).toBe(loadV3().notes[0]);
  });

  it('vitals: LCP url, long task script url and invoker', () => {
    noLeak(snapshot.vitals);
    expect(snapshot.vitals[1].longTasks.items[0].scripts[0].invoker).toBe('IMG#hero.onload?token=[redacted:key-token]');
  });

  it('nothing from the trap list survives anywhere in the package', () => {
    noLeak(snapshot);
  });
});

describe('redact: name/value pairs (re-review E3 N3)', () => {
  const pkg = () => RECORD_ONLY(trapPackage());

  it('{ name|key, value } and [name, value] with a sensitive name: the value is masked, the name stays', () => {
    const input = pkg();
    const args = [
      'form', [{ name: 'login', value: 'jan' }, { name: 'password', value: 'NameValPwd6' }],
      { key: 'api_key', value: 'ApiKeyVal7' }, [['user', 'jan'], ['password', 'FormDataPw8'], ['pin', 1234]],
      { name: 'csrf_token', value: { nested: 'NestedTok9' }, id: 'f1' },
    ];
    input.consoleLogs = [{ t: 1, doc: 0, level: 'log', args }];
    const { snapshot } = redact(input);
    const out = snapshot.consoleLogs[0].args;
    noLeak(out, ['NameValPwd6', 'ApiKeyVal7', 'FormDataPw8', 'NestedTok9']);
    expect(out[1]).toEqual([{ name: 'login', value: 'jan' }, { name: 'password', value: '[redacted:key-password]' }]);
    expect(out[2]).toEqual({ key: 'api_key', value: '[redacted:key-api_key]' });
    expect(out[3]).toEqual([['user', 'jan'], ['password', '[redacted:key-password]'], ['pin', '[redacted:key-pin]']]);
    expect(out[4]).toEqual({ name: 'csrf_token', value: { nested: '[redacted:key-token]' }, id: 'f1' });
    const again = redact(snapshot);
    expect(again.snapshot.consoleLogs).toEqual(snapshot.consoleLogs);
  });

  it('pairs with an ordinary name and other two-item arrays are unchanged', () => {
    const input = pkg();
    const args = [{ name: 'country', value: 'PL' }, ['lang', 'pl'], [1, 2]];
    input.consoleLogs = [{ t: 1, doc: 0, level: 'log', args }];
    expect(redact(input).snapshot.consoleLogs[0].args).toEqual(args);
  });
});

describe('redact: key/value pairs across console arguments (re-review E3 N9, N10)', () => {
  const run = (args) => {
    const input = RECORD_ONLY(trapPackage());
    input.consoleLogs = [{ t: 1, doc: 0, level: 'log', args }];
    const { snapshot } = redact(input);
    expect(redact(snapshot).applied).toBe(0); // idempotent
    return snapshot.consoleLogs[0].args;
  };

  it('N9: a key argument with `:`/`=` or anywhere in a longer list masks the next scalar', () => {
    expect(run(['password:', 'ArgPwd1x'])).toEqual(['password:', '[redacted:key-password]']);
    expect(run(['token=', 'ArgTok2xyz'])).toEqual(['token=', '[redacted:key-token]']);
    expect(run(['password: ', 'ArgPwd3x'])).toEqual(['password: ', '[redacted:key-password]']);
    expect(run(['login', 'jan', 'password', 'ArgPwd4x'])).toEqual(['login', 'jan', 'password', '[redacted:key-password]']);
    expect(run(['Enter password:', 'ArgPwd5x', 'pin', 1234, 'ok'])).toEqual(['Enter password:', '[redacted:key-password]', 'pin', '[redacted:key-pin]', 'ok']);
    // `password` as the value of an ordinary key is a key again.
    expect(run(['user', 'password', 'ArgPwd6x'])).toEqual(['user', 'password', '[redacted:key-password]']);
    // A container after the key is masked as a whole (E4-IN5, Q-4; was: its own keys decide).
    expect(run(['password:', { a: 1 }])).toEqual(['password:', { a: '[redacted:key-password]' }]);
  });

  it('N10: a key with white space and without a trailing `:`/`=` is ordinary text', () => {
    // `'Pressed key', 'Enter'` ends with a key word: a documented false positive since E4-IN5 (console-args.json).
    for (const args of [['token count', 5], ['auth ok', true], ['user', 'jan'], ['login', 'jan', 'theme', 'dark']]) {
      expect(run(args)).toEqual(args);
    }
  });

  it('N10: a single key word is still a key (fail-closed, intended): `key`, `session`', () => {
    expect(run(['key', 'Enter'])).toEqual(['key', '[redacted:key-key]']);
    expect(run(['session', 'started'])).toEqual(['session', '[redacted:key-session]']);
  });

  it('N9: the preview of a long entry `{ truncated, preview }` masks `"key:?", "value"`, also cut at the end', () => {
    const entry = (preview) => run({ truncated: true, preview }).preview;
    expect(entry('["login","jan","password:","PrevPwd1x","pin",1234,"ok"]'))
      .toBe('["login","jan","password:","[redacted:key-password]","pin","[redacted:key-pin]","ok"]');
    expect(entry('["user", "password", "PrevPwd2x"]')).toBe('["user", "password", "[redacted:key-password]"]');
    expect(entry('["a","b","password:","PrevPwd3')).toBe('["a","b","password:","[redacted:key-password]');
    // `token=","…` is also an attribute `key="…"` for the text pass (it eats the `,`); the value is masked either way.
    const cut = entry('["a","b","token=","PrevTok3');
    expect(cut).not.toContain('PrevTok3');
    expect(cut).toContain('[redacted:key-token]');
    expect(entry('["Pressed it","Enter","token count",5]')).toBe('["Pressed it","Enter","token count",5]');
    expect(entry('["say \\"password\\"","x"]')).toBe('["say \\"password\\"","x"]');
  });

  it('N13: a key right after a key is masked and names the next argument (a chain of any length)', () => {
    expect(run(['[Auth]', 'Token:', 'ChainTok1x'])).toEqual(['[Auth]', '[redacted:key-auth]', '[redacted:key-token]']);
    expect(run(['auth:', 'token', 'ChainTok2x'])).toEqual(['auth:', '[redacted:key-auth]', '[redacted:key-token]']);
    expect(run(['session', 'token=', 'ChainTok3x'])).toEqual(['session', '[redacted:key-session]', '[redacted:key-token]']);
    expect(run(['Session', 'Token', 'ChainTok4x'])).toEqual(['Session', '[redacted:key-session]', '[redacted:key-token]']);
    expect(run(['session:', 'refresh', 'token:', 'ChainTok5x', 'ok']))
      .toEqual(['session:', '[redacted:key-session]', 'token:', '[redacted:key-token]', 'ok']);
    expect(run(['auth', 'session', 'password', 'ChainPwd6x']))
      .toEqual(['auth', '[redacted:key-auth]', '[redacted:key-session]', '[redacted:key-password]']);
    // An ordinary value ends the chain.
    expect(run(['login', 'jan', 'password', 'ChainPwd7x', 'theme', 'dark']))
      .toEqual(['login', 'jan', 'password', '[redacted:key-password]', 'theme', 'dark']);
  });

  it('N10 after N13: benign arguments stay as they are', () => {
    for (const args of [['token count', 5], ['auth ok', true], ['login', 'jan', 'theme', 'dark']]) {
      expect(run(args)).toEqual(args);
    }
  });

  it('N13: the preview chains keys the same way', () => {
    const entry = (preview) => run({ truncated: true, preview }).preview;
    expect(entry('["[Auth]","Token:","PrevChain1x","more"'))
      .toBe('["[Auth]","[redacted:key-auth]","[redacted:key-token]","more"');
    expect(entry('["auth:","token","PrevChain2x"]')).toBe('["auth:","[redacted:key-auth]","[redacted:key-token]"]');
    expect(entry('["Session","Token",')).toBe('["Session","[redacted:key-session]",');
    const cut = entry('["session","token=","PrevChain3');
    expect(cut).not.toContain('PrevChain3');
    expect(cut).toContain('[redacted:key-token]');
    expect(entry('["login","jan","theme","dark"]')).toBe('["login","jan","theme","dark"]');
  });

  it('N14: arrays nested in console arguments get the same pairs as the arguments and the preview', () => {
    expect(run([['login', 'jan', 'password', 'NestPwd1x']])).toEqual([['login', 'jan', 'password', '[redacted:key-password]']]);
    expect(run([{ creds: ['user', 'jan', 'pin', 1234] }])).toEqual([{ creds: ['user', 'jan', 'pin', '[redacted:key-pin]'] }]);
    expect(run(['x', [['auth', 'token', 'NestTok2x']]])).toEqual(['x', [['auth', '[redacted:key-auth]', '[redacted:key-token]']]]);
    expect(run([['login', 'jan', 'theme', 'dark']])).toEqual([['login', 'jan', 'theme', 'dark']]);
    // The preview of the same value agrees.
    expect(run({ truncated: true, preview: '[["login","jan","password","NestPwd1x"]]' }).preview)
      .toBe('[["login","jan","password","[redacted:key-password]"]]');
  });

  it('N14: outside the console a nested array keeps the two-item rule only', () => {
    const input = RECORD_ONLY(trapPackage());
    input.network = [{ t: 1, doc: 0, url: '/a', requestBody: [['login', 'jan', 'theme', 'dark'], ['password', 'NetPwd1x']] }];
    const body = redact(input).snapshot.network[0].requestBody;
    expect(body).toEqual([['login', 'jan', 'theme', 'dark'], ['password', '[redacted:key-password]']]);
  });
});

describe('redact: URL fields (AC-3.3)', () => {
  it('same URL trap in every URL field → 0 hits', () => {
    const { snapshot } = redact(trapPackage());
    const fields = [
      snapshot.network.at(-1).url, snapshot.documents[0].url, snapshot.vitals[1].LCP.url,
      snapshot.vitals[1].longTasks.items[0].scripts[0].url, snapshot.performance.navigation.name, snapshot.performance.resources[0].name,
      snapshot.dom.images[0].src, snapshot.dom.scripts[0].src, snapshot.dom.stylesheets[0].href, snapshot.dom.iframes[0].src,
      snapshot.dom.forms[0].action, snapshot.dom.canonical, snapshot.dom.hreflangs[0].href, snapshot.runtimeErrors.at(-1).frame,
      snapshot.consoleLogs.at(-1).frame, snapshot.steps.at(-2).url, snapshot.environment.location.href, snapshot.environment.document.referrer,
    ];
    for (const field of fields) {
      noLeak(field, [TOKEN, JWT, 'JsTrapSess77']);
      expect(field).toBe('https://app.example.test/cb;jsessionid=[redacted:key-session]?access_token=[redacted:key-token]&page=2#[redacted:url-fragment]');
    }
  });

  it('a URL without secrets is unchanged', () => {
    const pkg = RECORD_ONLY(loadV3());
    const { snapshot } = redact(pkg);
    expect(snapshot.network.map((n) => n.url)).toEqual(pkg.network.map((n) => n.url));
    expect(snapshot.documents.map((d) => d.url)).toEqual(pkg.documents.map((d) => d.url));
  });
});

describe('redact: trace and shape (AC-4.1)', () => {
  it('masked value is "[redacted:<rule>]", never null/""/missing; key paths before == after', () => {
    const input = trapPackage();
    const { snapshot } = redact(input);
    // Allowed differences (spec "Dane"): cookies string → list, form value → valueLength, the filled `redaction` block.
    const skip = (p) => p.startsWith('$.storage.cookies') || p.startsWith('$.redaction.masked.');
    const before = keyPaths(input).filter((p) => !skip(p) && !/\.elements\[\d+\]\.value$/.test(p));
    const after = keyPaths(snapshot).filter((p) => !skip(p) && !/\.elements\[\d+\]\.valueLength$/.test(p));
    expect(after).toEqual(before);
    const text = json(snapshot);
    const markers = text.match(/\[redacted:[^\]]*\]/g);
    expect(markers.length).toBeGreaterThan(30);
    for (const marker of markers) expect(marker).toMatch(/^\[redacted:(key-[a-z_-]+|jwt|bearer|basic|card|iban|pesel|long-secret|url-credentials|url-fragment|form-value|email|phone)\]$/);
  });

  it('does not mutate its input', () => {
    const input = trapPackage();
    const copy = JSON.parse(json(input));
    redact(input);
    expect(input).toEqual(copy);
  });

  it('second pass changes nothing and reports 0 (AC-4.2)', () => {
    const first = redact(trapPackage());
    expect(first.applied).toBeGreaterThan(30);
    const second = redact(first.snapshot);
    expect(second.snapshot).toEqual(first.snapshot);
    expect(second.applied).toBe(0);
  });
});

describe('countMarkers (AC-4.3)', () => {
  it('total equals occurrences of "[redacted:" in JSON.stringify; keys are top-level sections', () => {
    const { snapshot } = redact(trapPackage());
    const { masked, total } = countMarkers(snapshot);
    expect(total).toBe(countOccurrences(JSON.stringify(snapshot, null, 2), '[redacted:'));
    expect(Object.values(masked).reduce((a, b) => a + b, 0)).toBe(total);
    for (const [key, n] of Object.entries(masked)) {
      expect(Object.keys(snapshot)).toContain(key);
      expect(n).toBeGreaterThan(0);
    }
    expect(masked).not.toHaveProperty('overview');
    expect(Object.keys(masked)).toEqual(expect.arrayContaining(['network', 'consoleLogs', 'storage', 'dom', 'environment']));
  });

  it('counts markers that came from MAIN and skips sections without any', () => {
    const pkg = RECORD_ONLY(loadV3());
    pkg.steps[0].url = 'http://127.0.0.1:8080/form.html?token=[redacted:key-token]';
    expect(countMarkers(pkg)).toEqual({ masked: { steps: 1 }, total: 1 });
    expect(countMarkers(RECORD_ONLY(loadV3()))).toEqual({ masked: {}, total: 0 });
  });

  it('redact fills an existing `redaction` block (no values, sum = markers)', () => {
    const { snapshot } = redact(trapPackage());
    expect(snapshot.redaction.rulesVersion).toBe(2);
    expect(snapshot.redaction.disabledRules).toEqual([]);
    expect(snapshot.redaction.masked).toEqual(countMarkers(snapshot).masked);
    const noBlock = RECORD_ONLY(loadV3());
    expect(redact(noBlock).snapshot).not.toHaveProperty('redaction');
  });
});

describe('levels (AC-4.5)', () => {
  it('resolveDisabledRules keeps Default rules only, in order, without duplicates', () => {
    expect(resolveDisabledRules(['jwt', 'phone', 'email', 'phone', 'key-*', 'html-structure', 7])).toEqual(['email', 'phone', 'html-structure']);
    expect(resolveDisabledRules(undefined)).toEqual([]);
    expect(resolveDisabledRules('email')).toEqual([]);
  });

  it('disabling email removes email masking and lists it; disabling jwt ignored and not listed', () => {
    const { snapshot } = redact(trapPackage(), { disabledRules: ['email', 'jwt', 'card'] });
    const text = json(snapshot);
    expect(text).toContain(EMAIL);
    expect(text).not.toContain('[redacted:email]');
    expect(text).not.toContain(JWT.slice(0, 20));
    expect(text).not.toContain(CARD);
    expect(snapshot.redaction.disabledRules).toEqual(['email']);
    // Secrets at a sensitive key stay masked even when e-mail masking is off.
    expect(JSON.parse(snapshot.network.at(-1).requestBody).password).toBe('[redacted:key-password]');
  });

  it('disabling phone keeps e-mails masked and shows phone numbers', () => {
    const { snapshot } = redact(trapPackage(), { disabledRules: ['phone'] });
    const text = json(snapshot);
    expect(text).toContain(PHONE);
    expect(text).not.toContain(EMAIL);
    expect(snapshot.redaction.disabledRules).toEqual(['phone']);
  });

  it('phone is applied only where spec allows: not to URLs, notes or step texts', () => {
    const pkg = RECORD_ONLY(loadV3());
    pkg.notes.push('Order 601 234 567 failed.');
    pkg.steps.push({ t: 1, doc: 1, type: 'click', selector: '#buy', text: 'Zamów 601 234 567' });
    const { snapshot } = redact(pkg);
    expect(snapshot.notes.at(-1)).toBe('Order 601 234 567 failed.');
    expect(snapshot.steps.at(-1).text).toBe('Zamów 601 234 567');
  });
});

describe('what stays (AC-5.4, D2)', () => {
  it('statuses, methods, t, durations, sizes, overview, vitals numbers, error messages without secrets unchanged', () => {
    const input = RECORD_ONLY(loadV3());
    const { snapshot, applied } = redact(input);
    expect(applied).toBe(0);
    for (const key of ['schemaVersion', 'extensionVersion', 'source', 'collectedAt', 'recordingStartedAt', 'recordingStoppedReason',
      'timeOrigin', 'overview', 'limits', 'truncated', 'screenshots', 'attachments', 'vitals', 'documents', 'notes', 'steps']) {
      expect(snapshot[key], key).toEqual(input[key]);
    }
    const pick = (n) => ({ t: n.t, method: n.method, status: n.status, statusText: n.statusText, ok: n.ok, durationMs: n.durationMs, sizeBytes: n.sizeBytes, type: n.type });
    expect(snapshot.network.map(pick)).toEqual(input.network.map(pick));
    expect(snapshot.runtimeErrors).toEqual(input.runtimeErrors);
    expect(snapshot.consoleLogs).toEqual(input.consoleLogs);
  });

  it('steps[].key "Enter" untouched (schema key, not user data)', () => {
    const { snapshot } = redact(trapPackage());
    const key = snapshot.steps.find((s) => s.type === 'key');
    expect(key).toEqual({ t: 1400, doc: 0, type: 'key', selector: '#pass', key: 'Enter' });
  });

  it('numbers at schema keys stay numbers; numbers at secret keys in user data become markers', () => {
    const pkg = RECORD_ONLY(loadV3());
    pkg.consoleLogs.push({ t: 1, doc: 1, level: 'log', args: [{ token: 42, sid: false, count: 3, pinned: true }] });
    const { snapshot } = redact(pkg);
    expect(snapshot.consoleLogs.at(-1)).toEqual({
      t: 1, doc: 1, level: 'log', args: [{ token: '[redacted:key-token]', sid: '[redacted:key-sid]', count: 3, pinned: true }],
    });
  });

  it('screenshots and the attachment are not text-scanned', () => {
    const pkg = RECORD_ONLY(loadV3());
    pkg.screenshots[0].file = `a${'Zq8xK2vN9pLm4RtY7wB3cE6hJ1sD5fGa'}.jpg?token=x`;
    expect(redact(pkg).snapshot.screenshots).toEqual(pkg.screenshots);
  });

  it('a new top-level section is protected by the text pass (fail-safe)', () => {
    const pkg = RECORD_ONLY(loadV3());
    pkg.futureSection = { items: [{ note: `token=${TOKEN} and ${JWT}`, n: 5 }] };
    const { snapshot } = redact(pkg);
    expect(snapshot.futureSection.items[0]).toEqual({ note: 'token=[redacted:key-token] and [redacted:jwt]', n: 5 });
  });
});

describe('hostile realm (AC-3.6, auxiliary)', () => {
  it('page-patched String.prototype.replace in test realm does not affect result', () => {
    const expected = redact(trapPackage()).snapshot;
    const context = vm.createContext({ source: JSON.stringify(trapPackage()) });
    const hostile = vm.runInContext(`
      String.prototype.replace = function () { return 'patched'; };
      String.prototype.slice = function () { return 'patched'; };
      RegExp.prototype[Symbol.replace] = function () { return 'patched'; };
      RegExp.prototype.test = function () { return false; };
      Array.prototype.map = function () { return []; };
      Array.prototype.forEach = function () {};
      Object.prototype.toJSON = function () { return 'patched'; };
      Object.keys = function () { return []; };
      JSON.stringify = function () { return '{}'; };
      JSON.parse(source);
    `, context);
    expect(Object.getPrototypeOf(hostile)).not.toBe(Object.prototype);
    const { snapshot } = redact(hostile);
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
    expect(snapshot).toEqual(expected);
    noLeak(snapshot, [JWT, TOKEN, 'jan.trap@exa', PASSWORD, COOKIE_SID]);
  });

  it('ignores inherited (prototype) properties of the input', () => {
    const pkg = RECORD_ONLY(loadV3());
    const proto = { injected: `token=${TOKEN}` };
    const entry = Object.assign(Object.create(proto), pkg.consoleLogs[0]);
    pkg.consoleLogs[0] = entry;
    const { snapshot } = redact(pkg);
    expect(snapshot.consoleLogs[0]).not.toHaveProperty('injected');
  });
});
