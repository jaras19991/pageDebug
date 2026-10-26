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
