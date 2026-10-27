import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { bundle } from '../../scripts/gen-content.mjs';
import { maskText, maskUrl, maskSecrets, cutPreview, secretKeyRule } from '../../src/lib/mask-secrets.js';

// E3 AC-3.6 (TEST3 fix): the MAIN code runs in the page realm, so it must not depend on built-ins the page replaces
// after document_start. The recorder and masking are bundled like main-world.js and loaded into a node:vm realm;
// that realm's built-ins are replaced afterwards, as tests/fixtures/pages/privacy-hostile.html does.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const load = (name) => JSON.parse(readFileSync(new URL(`../fixtures/redaction/${name}`, import.meta.url), 'utf8')).items;
const TOKEN = 'tk0123456789abcdef0123456789';

let code;
beforeAll(() => {
  code = bundle({ entry: 'tests/fixtures/modules/hostile-realm/entry.js', srcDir: ROOT });
});

// Fresh realm with the bundle loaded, then `patch` (page code) run in it. Host timers and fetch/stream types are
// passed in (a 401 response, because bodies are previewed for errors only).
function hostileRealm(patch) {
  const ctx = vm.createContext({
    hostSetTimeout: setTimeout, hostClearTimeout: clearTimeout, setTimeout, clearTimeout, Response, Headers, EventTarget, URL,
    ReadableStream, ReadableStreamDefaultReader, TextDecoder,
  });
  new vm.Script(code).runInContext(ctx);
  vm.runInContext(patch, ctx);
  return ctx;
}

const FIXTURE_PATCH = `
  JSON.stringify = function stringify() { return '{"hostile":true}'; };
  JSON.parse = function parse() { return { hostile: true }; };
  String.prototype.replace = function replace() { return 'hostile'; };
  RegExp.prototype[Symbol.replace] = function hostileReplace() { return 'hostile'; };
  Array.prototype.map = function map() { return []; };
`;
const REGEXP_PATCH = `${FIXTURE_PATCH}
  String.prototype.split = function split() { return ['hostile']; };
  RegExp.prototype.exec = function exec() { return null; };
  RegExp.prototype.test = function test() { return false; };
  RegExp.prototype[Symbol.split] = function hostileSplit() { return ['hostile']; };
  RegExp.prototype[Symbol.match] = function hostileMatch() { return null; };
`;

// Review E3 F9: key names and URL fields must not depend on String.prototype.toLowerCase/slice of the page.
const STRING_PATCH = `
  String.prototype.toLowerCase = function toLowerCase() { return 'x'; };
  String.prototype.slice = function slice() { return ''; };
`;

describe('hostile page realm (AC-3.6)', () => {
  it('F9: secretKeyRule, maskText and maskUrl after the page replaces toLowerCase and slice', () => {
    const ctx = hostileRealm(`${REGEXP_PATCH}${STRING_PATCH}`);
    const api = ctx.__pdsHostile;
    for (const name of ['Authorization', 'X-Api-Key', 'JSESSIONID', 'accessToken', 'pw', 'cvv', 'description']) {
      expect([name, api.secretKeyRule(name)]).toEqual([name, secretKeyRule(name)]);
    }
    for (const item of [...load('sensitive.json'), ...load('benign.json')]) {
      const opts = { email: true, phone: true };
      const expected = item.via === 'url' ? maskUrl(item.text, opts) : maskText(item.text, opts);
      const actual = item.via === 'url' ? api.maskUrl(item.text, opts) : api.maskText(item.text, opts);
      expect({ id: item.id, ...actual }).toEqual({ id: item.id, ...expected });
    }
  });

  it('F9: the recorder stores the masked header and URL after the page replaces toLowerCase and slice', async () => {
    const ctx = hostileRealm('');
    vm.runInContext(`
      var win = new EventTarget();
      win.EventTarget = EventTarget;
      win.console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
      win.fetch = async () => new Response('ok', { status: 200 });
      win.performance = { timeOrigin: 1768471200000, now: () => 1 };
      win.setTimeout = (fn, ms) => hostSetTimeout(fn, ms);
      win.clearTimeout = (id) => hostClearTimeout(id);
      win.location = { href: 'http://127.0.0.1:8080/privacy-hostile.html' };
      var rec = __pdsHostile.createRecorder({ win });
      rec.install();
      rec.setConfig({ docId: 'd1' });
    `, ctx);
    vm.runInContext(STRING_PATCH, ctx);
    // Longer than NETWORK_LIMITS.urlChars, so the stored URL is cut too.
    await vm.runInContext(`win.fetch('http://127.0.0.1:8080/api?access_token=${TOKEN}&pad=${'a'.repeat(5000)}', { headers: { Authorization: 'Bearer ${TOKEN}' } })`, ctx);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
    const snap = vm.runInContext('rec.snapshot()', ctx);
    expect(snap.network).toHaveLength(1);
    expect(snap.network[0].url.startsWith('http://127.0.0.1:8080/api?access_token=[redacted:key-token]&pad=aaaa')).toBe(true);
    expect(snap.network[0].url).toMatch(/a\.\.\. \[truncated \d+ chars\]$/);
    expect(snap.network[0].requestHeaders).toMatchObject({ Authorization: '[redacted:key-authorization]' });
    expect(JSON.stringify(snap.network[0])).not.toContain(TOKEN);
  });

  it('maskText/maskUrl/maskSecrets/cutPreview give the same results after the page replaces replace/exec/split/map', () => {
    const ctx = hostileRealm(REGEXP_PATCH);
    const api = ctx.__pdsHostile;
    const items = [...load('sensitive.json'), ...load('benign.json')];
    expect(items.length).toBeGreaterThan(20);
    for (const item of items) {
      const opts = { email: true, phone: true };
      const expected = item.via === 'url' ? maskUrl(item.text, opts) : maskText(item.text, opts);
      const actual = item.via === 'url' ? api.maskUrl(item.text, opts) : api.maskText(item.text, opts);
      expect({ id: item.id, ...actual }).toEqual({ id: item.id, ...expected });
    }
    const url = `http://127.0.0.1:8080/api/login?access_token=${TOKEN}#id_token=${TOKEN}`;
    expect(api.maskUrl(url)).toEqual(maskUrl(url));
    expect(api.maskUrl(url).text).not.toContain(TOKEN);
    const body = `{"token":"${TOKEN}","user":"jan"}`;
    expect(api.maskSecrets(body)).toEqual(maskSecrets(body));
    expect(api.cutPreview(`abc ${TOKEN}`, 10)).toEqual(cutPreview(`abc ${TOKEN}`, 10));
  });

  it('recorder keeps console and network entries, masked, after the page replaces map/replace/JSON', async () => {
    const ctx = hostileRealm('');
    const response = () => new Response(`{"token":"${TOKEN}","ok":true}`, { status: 401, headers: { 'content-type': 'application/json' } });
    vm.runInContext(`
      var win = new EventTarget();
      win.EventTarget = EventTarget;
      win.console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
      win.fetch = async () => hostResponse();
      win.performance = { timeOrigin: 1768471200000, now: () => 1 };
      win.setTimeout = (fn, ms) => hostSetTimeout(fn, ms);
      win.clearTimeout = (id) => hostClearTimeout(id);
      win.location = { href: 'http://127.0.0.1:8080/privacy-hostile.html' };
      var rec = __pdsHostile.createRecorder({ win });
      rec.install();
      rec.setConfig({ docId: 'd1' });
    `, Object.assign(ctx, { hostResponse: response }));
    vm.runInContext(FIXTURE_PATCH, ctx);
    await vm.runInContext(`
      win.console.log({ token: '${TOKEN}' }, 'tekst  z   odstępami');
      win.fetch('http://127.0.0.1:8080/api/login?access_token=${TOKEN}', { method: 'POST' });
    `, ctx);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));

    const snap = vm.runInContext('rec.snapshot()', ctx);
    expect(snap.consoleLogs).toHaveLength(1);
    expect(snap.network).toHaveLength(1);
    expect(snap.consoleLogs[0].doc).toBe('d1');
    expect(snap.network[0].doc).toBe('d1');
    expect(snap.network[0].url).toBe('http://127.0.0.1:8080/api/login?access_token=[redacted:key-token]');
    expect(snap.network[0].responseBodyPreview).toBe('{"token":"[redacted:key-token]","ok":true}');
    const raw = vm.runInContext('rec.exportBuffers()', ctx);
    expect(raw.network).toHaveLength(1);
    expect(raw.consoleLogs).toHaveLength(1);
  });
});

// E4-IN2 (AC-2.5): a page may replace Array.prototype[Symbol.iterator] (or String's) after the bundle loaded; the masking
// path in MAIN uses index loops only, so neither a throwing nor an empty iterator turns masking off or drops the entry.
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const ITERATOR_PATCHES = {
  throwing: (proto) => `${proto}.prototype[Symbol.iterator] = function hostileIterator() { throw new Error('hostile'); };`,
  empty: (proto) => `${proto}.prototype[Symbol.iterator] = function* hostileIterator() {};`,
};

describe('hostile realm: replaced iterators (E4-IN2, AC-2.5)', () => {
  for (const variant of Object.keys(ITERATOR_PATCHES)) {
    it(`hostile realm: Array.prototype[Symbol.iterator] replaced (${variant}) after load → JWT in 500 body preview, Authorization header, step URL token still masked`, async () => {
      const ctx = hostileRealm('');
      const response = () => new Response(`{"error":"expired","detail":"${JWT}"}`, { status: 500, headers: { 'content-type': 'application/json' } });
      Object.assign(ctx, { hostResponse: response });
      vm.runInContext(`
        var saveIterator = Array.prototype[Symbol.iterator];
        function History() {}
        History.prototype.pushState = function pushState() {};
        History.prototype.replaceState = function replaceState() {};
        var win = new EventTarget();
        win.EventTarget = EventTarget;
        win.History = History;
        win.history = new History();
        win.console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
        win.fetch = async () => hostResponse();
        win.performance = { timeOrigin: 1768471200000, now: () => 1 };
        win.setTimeout = (fn, ms) => hostSetTimeout(fn, ms);
        win.clearTimeout = (id) => hostClearTimeout(id);
        win.location = { href: 'http://127.0.0.1:8080/privacy-hostile.html' };
        var rec = __pdsHostile.createRecorder({ win });
        rec.install();
        rec.setConfig({ docId: 'd1' });
      `, ctx);
      vm.runInContext(ITERATOR_PATCHES[variant]('Array'), ctx);
      await vm.runInContext(`
        win.location.href = 'http://127.0.0.1:8080/cb?access_token=${TOKEN}';
        win.history.pushState(null, '', win.location.href);
        win.fetch('http://127.0.0.1:8080/api/data', { headers: { Authorization: 'Bearer ${JWT}', 'X-Trace': 'abc' } });
      `, ctx);
      for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
      // Reading the buffers is not part of the masking path: the iterator is put back first.
      vm.runInContext('Array.prototype[Symbol.iterator] = saveIterator;', ctx);
      const snap = vm.runInContext('rec.snapshot()', ctx);
      expect(snap.network).toHaveLength(1);
      expect(snap.network[0].url).toBe('http://127.0.0.1:8080/api/data');
      expect(snap.network[0].requestHeaders).toEqual({ Authorization: '[redacted:key-authorization]', 'X-Trace': 'abc' });
      expect(snap.network[0].responseBodyPreview).toBe('{"error":"expired","detail":"[redacted:jwt]"}');
      const pushed = snap.steps.filter((s) => s.type === 'navigate' && s.via === 'pushState');
      expect(pushed).toEqual([expect.objectContaining({ url: 'http://127.0.0.1:8080/cb?access_token=[redacted:key-token]' })]);
      // The document URL (top-level `url`) is masked by the background pass, not at the source; entries are checked here.
      const all = JSON.stringify({ network: snap.network, steps: snap.steps });
      expect(all).not.toContain(JWT);
      expect(all).not.toContain(TOKEN);
    });
  }

  // E4-IN2b: the page replaces the iterator before the recording starts and leaves it so; install, the hooks (console with
  // serialize, network, steps), snapshot, exportBuffers, stop and destroy all run under it, so nothing is lost on the way.
  for (const variant of Object.keys(ITERATOR_PATCHES)) {
    it(`E4-IN2b: Array.prototype[Symbol.iterator] replaced (${variant}) before install → recorder, console hook and serialize keep the entries, network and steps masked (AC-2.5)`, async () => {
      const ctx = hostileRealm(ITERATOR_PATCHES[variant]('Array'));
      const response = () => new Response(`{"error":"expired","detail":"${JWT}"}`, { status: 500, headers: { 'content-type': 'application/json' } });
      Object.assign(ctx, { hostResponse: response });
      vm.runInContext(`
        function History() {}
        History.prototype.pushState = function pushState() {};
        History.prototype.replaceState = function replaceState() {};
        var logged = [];
        var win = new EventTarget();
        win.EventTarget = EventTarget;
        win.History = History;
        win.history = new History();
        win.console = { log(...a) { logged.push(a.length); }, info() {}, warn() {}, error() {}, debug() {} };
        win.fetch = async () => hostResponse();
        win.performance = { timeOrigin: 1768471200000, now: () => 1 };
        win.setTimeout = (fn, ms) => hostSetTimeout(fn, ms);
        win.clearTimeout = (id) => hostClearTimeout(id);
        win.location = { href: 'http://127.0.0.1:8080/privacy-iterator.html' };
        var rec = __pdsHostile.createRecorder({ win });
        var installed = rec.install();
        rec.setConfig({ record: true, docId: 'd1' });
      `, ctx);
      expect(vm.runInContext('installed', ctx)).toBe(true);
      await vm.runInContext(`
        win.console.log('dane', ['a', { token: '${TOKEN}' }, ['${JWT}']], { list: [1, 2, 3] });
        win.location.href = 'http://127.0.0.1:8080/cb?access_token=${TOKEN}';
        win.history.pushState(null, '', win.location.href);
        win.fetch('http://127.0.0.1:8080/api/data', { headers: { Authorization: 'Bearer ${JWT}' } });
      `, ctx);
      for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
      // The page's console still got the call with all its arguments.
      expect(vm.runInContext('logged', ctx)).toEqual([3]);

      // snapshot() and exportBuffers() run with the hostile iterator still in place; JSON copies leave the realm.
      const snap = JSON.parse(vm.runInContext('__pdsJson(rec.snapshot())', Object.assign(ctx, { __pdsJson: JSON.stringify })));
      expect(snap.consoleLogs).toHaveLength(1);
      // Console arguments are masked by the background pass (redact.js), not at the source: here only their shape counts.
      const args = JSON.stringify(snap.consoleLogs[0].args);
      expect(args).toContain('"dane"');
      expect(args).toContain('"list":[1,2,3]');
      expect(snap.network).toHaveLength(1);
      expect(snap.network[0].status).toBe(500);
      expect(snap.network[0].requestHeaders).toEqual({ Authorization: '[redacted:key-authorization]' });
      expect(snap.network[0].responseBodyPreview).toBe('{"error":"expired","detail":"[redacted:jwt]"}');
      expect(snap.steps.filter((s) => s.type === 'navigate' && s.via === 'pushState')).toHaveLength(1);
      for (const section of ['consoleLogs', 'network', 'steps', 'runtimeErrors']) expect([section, Array.isArray(snap[section])]).toEqual([section, true]);
      expect(snap.counts).toMatchObject({ consoleLogs: 1, network: 1 });
      const all = JSON.stringify({ network: snap.network, steps: snap.steps });
      expect(all).not.toContain(JWT);
      expect(all).not.toContain(TOKEN);
      const raw = JSON.parse(vm.runInContext('__pdsJson(rec.exportBuffers())', ctx));
      expect(raw.network).toHaveLength(1);
      expect(raw.consoleLogs).toHaveLength(1);

      // stop() restores the page's functions, destroy() empties the buffers; both under the hostile iterator.
      vm.runInContext('rec.stop("user");', ctx);
      expect(vm.runInContext('rec.isActive', ctx)).toBe(false);
      expect(vm.runInContext('win.fetch.toString().includes("hostResponse")', ctx)).toBe(true);
      vm.runInContext('rec.destroy();', ctx);
      const cleared = JSON.parse(vm.runInContext('__pdsJson(rec.snapshot())', ctx));
      expect(cleared.consoleLogs).toEqual([]);
      expect(cleared.network).toEqual([]);
    });
  }

  it('String.prototype[Symbol.iterator] replaced → ibanValid/shannon unchanged', () => {
    // ibanValid (IBAN rule) and shannon (long-secret rule) are reached through maskText, as in MAIN.
    const texts = [
      'konto PL61109010140000071219812874 w banku',
      'konto PL61 1090 1014 0000 0712 1981 2874 OK',
      'klucz aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gI3kM5 tutaj',
      'nazwa snake_case_identifier_with_many_words_123 zostaje',
    ];
    for (const variant of Object.keys(ITERATOR_PATCHES)) {
      const ctx = hostileRealm(ITERATOR_PATCHES[variant]('String'));
      for (const text of texts) expect([variant, ctx.__pdsHostile.maskText(text)]).toEqual([variant, maskText(text)]);
    }
    expect(maskText(texts[0]).text).toBe('konto [redacted:iban] w banku');
    expect(maskText(texts[2]).text).toBe('klucz [redacted:long-secret] tutaj');
  });

  it('eslint: for…of in hooks-network.js is an error (ESLint API on a temp copy)', async () => {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: ROOT });
    const source = readFileSync(new URL('../../src/page/hooks-network.js', import.meta.url), 'utf8');
    const clean = await eslint.lintText(source, { filePath: `${ROOT}src/page/hooks-network.js` });
    expect(clean[0].messages).toEqual([]);
    const hostile = `${source}\nexport function iterate(list) {\n  for (const item of list) return item;\n  const [a] = list;\n  return [...list, a, Array.from(list)];\n}\n`;
    const [result] = await eslint.lintText(hostile, { filePath: `${ROOT}src/page/hooks-network.js` });
    const restricted = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    const fn = hostile.split('\n').indexOf('export function iterate(list) {') + 1;
    expect(restricted.map((m) => m.line)).toEqual([1, 2, 3, 3].map((d) => fn + d));
    // E4-IN2b: every MAIN module the recording passes through; ISOLATED-only modules are not covered.
    const forOf = 'export function f(list) {\n  for (const x of list) return x;\n}\n';
    for (const file of ['src/lib/redact-rules.js', 'src/lib/mask-secrets.js', 'src/page/hooks-steps.js', 'src/page/recorder.js',
      'src/page/hooks-console.js', 'src/page/serialize.js', 'src/page/collector.js', 'src/page/channel.js', 'src/page/main-entry.js',
      'src/page/vitals.js', 'src/page/hooks-resources.js']) {
      const [other] = await eslint.lintText(forOf, { filePath: `${ROOT}${file}` });
      expect([file, other.messages.map((m) => m.ruleId)]).toEqual([file, ['no-restricted-syntax']]);
    }
    for (const file of ['src/page/isolated-entry.js', 'src/page/field-rects.js']) {
      const [isolated] = await eslint.lintText(forOf, { filePath: `${ROOT}${file}` });
      expect([file, isolated.messages]).toEqual([file, []]);
    }
  }, 60000);
});
