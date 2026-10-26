// @vitest-environment jsdom
/* global window, document, Element */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  COLLECTOR_LIMITS,
  collectPageState,
  collectEnvironment,
  collectDomSnapshot,
  getPerformanceSummary,
  getStorageSnapshot,
} from '../../src/page/collector.js';
import { DOM_STRUCTURE_MAX_CHARS, DOM_FULL_MAX_CHARS } from '../../src/page/dom-structure.js';

// Minimal local copy of v1 safeSlice (the real one lives in src/page/serialize.js, E1-T3a).
// The collector receives it through `deps`, so the test does not depend on T3a.
function safeSlice(value, max) {
  if (typeof value !== 'string') return value;
  return value.length > max ? value.slice(0, max) + `... [truncated ${value.length - max} chars]` : value;
}

const deps = { safeSlice };

// v1 key lists (snapshot.json without schemaVersion); v4 changes only dom (E3-T3b, D5).
const ENV_KEYS = ['document', 'location', 'navigator', 'screen', 'timestamp', 'viewport'];
const DOM_KEYS = [
  'canonical',
  'counts',
  'forms',
  'fullHtml',
  'hreflangs',
  'html',
  'iframes',
  'images',
  'meta',
  'omittedElements',
  'rootMarkers',
  'scripts',
  'structure',
  'structureTruncated',
  'stylesheets',
];
// v4: structure and fullHtml close the dom object (design D5, "Schema paczki").
const DOM_TAIL = ['structure', 'structureTruncated', 'omittedElements', 'fullHtml'];
const NAV_KEYS = [
  'connectEnd', 'connectStart', 'decodedBodySize', 'domComplete', 'domContentLoadedEventEnd',
  'domContentLoadedEventStart', 'domInteractive', 'domainLookupEnd', 'domainLookupStart', 'duration',
  'encodedBodySize', 'entryType', 'fetchStart', 'initiatorType', 'loadEventEnd', 'loadEventStart', 'name',
  'nextHopProtocol', 'redirectEnd', 'redirectStart', 'renderBlockingStatus', 'requestStart', 'responseEnd',
  'responseStart', 'secureConnectionStart', 'startTime', 'transferSize', 'type', 'workerStart',
];
const RESOURCE_KEYS = [
  'decodedBodySize', 'duration', 'encodedBodySize', 'entryType', 'initiatorType', 'name', 'nextHopProtocol',
  'renderBlockingStatus', 'responseEnd', 'startTime', 'transferSize',
];

const sorted = (obj) => Object.keys(obj).sort();

function buildPage() {
  document.documentElement.lang = 'pl';
  document.documentElement.className = 'html-root';
  document.documentElement.setAttribute('data-app', 'test');
  document.head.innerHTML = `
    <meta name="description" content="Opis testowy">
    <link rel="canonical" href="http://example.test/canonical">
    <link rel="alternate" hreflang="en" href="http://example.test/en">
    <link rel="stylesheet" href="/s.css" media="screen">
    <style>body { color: red; }</style>
    <script>var inline = 1;</script>`;
  document.body.className = 'page';
  document.body.innerHTML = `
    <img src="http://example.test/a.png" alt="A" loading="lazy">
    <iframe src="about:blank" id="f1" name="frame" title="Ramka"></iframe>
    <form id="login" name="login" method="post" action="/login">
      <input type="text" name="user" value="jan">
      <input type="password" name="pass" value="sekret">
      <input type="hidden" name="csrf" value="tok123">
      <input type="checkbox" name="remember" checked>
    </form>`;
}

beforeEach(() => {
  buildPage();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function fakePerformance() {
  const nav = Object.fromEntries(NAV_KEYS.map((k) => [k, k === 'name' ? 'http://example.test/' : 1]));
  nav.entryType = 'navigation';
  nav.type = 'reload';
  nav.extraField = 'not copied';
  const res = { name: 'http://example.test/a.png', entryType: 'resource', initiatorType: 'img', startTime: 5,
    duration: 2, transferSize: 10, encodedBodySize: 8, decodedBodySize: 8, nextHopProtocol: 'h2', responseEnd: 7 };
  return {
    timeOrigin: 1768471200000.5,
    getEntriesByType: (type) => (type === 'navigation' ? [nav] : type === 'resource' ? [res] : []),
  };
}

describe('collector (E1-T3b)', () => {
  it('environment keeps v1 keys', () => {
    const env = collectEnvironment(window, document, deps);
    expect(sorted(env)).toEqual(ENV_KEYS);
    expect(sorted(env.location)).toEqual(
      ['hash', 'host', 'hostname', 'href', 'origin', 'pathname', 'port', 'protocol', 'search'],
    );
    expect(sorted(env.document)).toEqual(['lastModified', 'readyState', 'referrer', 'title', 'visibilityState']);
    expect(sorted(env.navigator)).toEqual([
      'cookieEnabled', 'deviceMemory', 'hardwareConcurrency', 'language', 'languages', 'onLine', 'platform',
      'userAgent',
    ]);
    expect(sorted(env.screen)).toEqual(['availHeight', 'availWidth', 'colorDepth', 'height', 'pixelDepth', 'width']);
    expect(sorted(env.viewport)).toEqual(
      ['devicePixelRatio', 'innerHeight', 'innerWidth', 'outerHeight', 'outerWidth', 'scrollX', 'scrollY'],
    );
    expect(env.location.href).toBe(window.location.href);
    expect(env.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('dom keeps v1 keys plus the v4 structure tail', () => {
    const dom = collectDomSnapshot(window, document, deps);
    expect(sorted(dom)).toEqual(DOM_KEYS);
    expect(Object.keys(dom).slice(-DOM_TAIL.length)).toEqual(DOM_TAIL);
    expect(sorted(dom.counts)).toEqual(
      ['forms', 'iframes', 'images', 'links', 'scripts', 'stylesheets', 'totalElements'],
    );
    expect(sorted(dom.html)).toEqual(['charset', 'compatMode', 'doctype', 'lang']);
    expect(sorted(dom.rootMarkers)).toEqual(
      ['bodyClassName', 'dataAttributesOnBody', 'dataAttributesOnHtml', 'htmlClassName'],
    );
    expect(dom.html.lang).toBe('pl');
    expect(dom.counts.forms).toBe(1);
    expect(dom.counts.iframes).toBe(1);
    expect(dom.canonical).toBe('http://example.test/canonical');
    expect(dom.hreflangs).toEqual([{ hreflang: 'en', href: 'http://example.test/en' }]);
    expect(sorted(dom.meta[0])).toEqual(
      ['attributes', 'className', 'href', 'id', 'name', 'src', 'tagName', 'text', 'type'],
    );
    expect(dom.meta[0].name).toBe('description');
    expect(sorted(dom.scripts[0])).toEqual(['async', 'attributes', 'defer', 'id', 'src', 'textLength', 'type']);
    expect(dom.scripts[0].textLength).toBe('var inline = 1;'.length);
    expect(dom.stylesheets.map((s) => s.tagName)).toEqual(['LINK', 'STYLE']);
    expect(sorted(dom.stylesheets[0])).toEqual(['attributes', 'disabled', 'href', 'media', 'tagName', 'textLength']);
    // Review F7: alt and title texts may name a person; only their lengths go to the package.
    expect(sorted(dom.images[0])).toEqual(
      ['altLength', 'height', 'loading', 'naturalHeight', 'naturalWidth', 'src', 'width'],
    );
    expect(dom.images[0].altLength).toBe(1);
    expect(sorted(dom.iframes[0])).toEqual(['attributes', 'id', 'name', 'src', 'titleLength']);
    expect(dom.iframes[0].titleLength).toBe('Ramka'.length);
    expect(dom.iframes[0].attributes).not.toHaveProperty('title');
    expect(dom.iframes[0].attributes).toMatchObject({ id: 'f1', name: 'frame' });
    expect(JSON.stringify([dom.images, dom.iframes])).not.toContain('Ramka');
    expect(sorted(dom.forms[0])).toEqual(['action', 'elements', 'enctype', 'id', 'method', 'name']);
    expect(dom.rootMarkers.htmlClassName).toBe('html-root');
    expect(dom.rootMarkers.dataAttributesOnHtml['data-app']).toBe('test');
    expect(dom.rootMarkers.bodyClassName).toBe('page');
  });

  it('dom has structure ≤ limit and no outerHTML anywhere (AC-5.2)', () => {
    document.body.insertAdjacentHTML('beforeend', '<p id="msg" data-testid="m" title="tytuł">Tekst akapitu</p><!-- komentarz -->');
    const dom = collectDomSnapshot(window, document, deps);
    expect(COLLECTOR_LIMITS.html).toBe(DOM_STRUCTURE_MAX_CHARS);
    expect(typeof dom.structure).toBe('string');
    expect(dom.structure.length).toBeLessThanOrEqual(DOM_STRUCTURE_MAX_CHARS);
    expect(dom.structure.startsWith('<html')).toBe(true);
    expect(dom.structure).toContain('<p id="msg" data-testid="m"></p>');
    expect(dom.structure).toContain('<script></script>');
    for (const absent of ['Tekst akapitu', 'komentarz', 'var inline', 'color: red', 'tytuł', 'Opis testowy', 'jan', 'sekret', 'tok123']) {
      expect(dom.structure).not.toContain(absent);
    }
    expect(dom.structureTruncated).toBe(false);
    expect(dom.omittedElements).toBe(0);
    expect(JSON.stringify(dom)).not.toContain('outerHTML');
    expect(JSON.stringify(collectPageState({ win: window, doc: document, safeSlice }))).not.toContain('outerHTML');
  });

  it('dom structure is cut at limits.html with structureTruncated and omittedElements', () => {
    document.body.insertAdjacentHTML('beforeend', '<div class="row"></div>'.repeat(500));
    const dom = collectDomSnapshot(window, document, { safeSlice, limits: { html: 2000 } });
    expect(dom.structure.length).toBeLessThanOrEqual(2000);
    expect(dom.structureTruncated).toBe(true);
    expect(dom.omittedElements).toBeGreaterThan(0);
    expect(dom.structure.endsWith('</body></html>')).toBe(true);
  });

  it('dom structure ignores page patches of Element getters made after module load (D5)', () => {
    // Getters only the walker reads (the v1 sections still use the live DOM).
    const names = ['localName', 'firstElementChild'];
    const saved = names.map((name) => Object.getOwnPropertyDescriptor(Element.prototype, name));
    const clean = collectDomSnapshot(window, document, deps).structure;
    try {
      Object.defineProperty(Element.prototype, 'localName', { configurable: true, get() { return 'evil'; } });
      Object.defineProperty(Element.prototype, 'firstElementChild', { configurable: true, get() { return null; } });
      expect(collectDomSnapshot(window, document, deps).structure).toBe(clean);
    } finally {
      names.forEach((name, i) => Object.defineProperty(Element.prototype, name, saved[i]));
    }
  });

  it('fullHtml null by default; string with option (AC-6.3)', () => {
    expect(collectDomSnapshot(window, document, deps).fullHtml).toBeNull();
    expect(collectPageState({ win: window, doc: document, safeSlice }).dom.fullHtml).toBeNull();
    expect(collectPageState({ win: window, doc: document, safeSlice, fullHtml: false }).dom.fullHtml).toBeNull();
    const state = collectPageState({ win: window, doc: document, safeSlice, fullHtml: true });
    expect(state.errors).toEqual([]);
    const full = state.dom.fullHtml;
    expect(typeof full).toBe('string');
    expect(full).toContain('var inline = 1;');
    expect(full).toContain('name="user"');
    expect(full).not.toContain('value=');
    expect(full).not.toContain('sekret');
    expect(full).not.toContain('tok123');
    expect(state.dom.structure).not.toContain('var inline');
  });

  it('fullHtml is cut at limits.fullHtml (8 000 000 by default)', () => {
    expect(COLLECTOR_LIMITS.fullHtml).toBe(DOM_FULL_MAX_CHARS);
    const dom = collectDomSnapshot(window, document, { safeSlice, limits: { fullHtml: 300 }, fullHtml: true });
    expect(dom.fullHtml.length).toBeLessThanOrEqual(300);
    expect(dom.fullHtml.endsWith('</html>')).toBe(true);
  });

  it('forms elements carry valueLength, password without, no value key (AC-3.2 dom)', () => {
    document.querySelector('[name="user"]').value = 'jan.kowalski';
    const elements = collectDomSnapshot(window, document, deps).forms[0].elements;
    const byName = Object.fromEntries(elements.map((e) => [e.name, e]));
    expect(byName.user.valueLength).toBe('jan.kowalski'.length);
    expect(byName.csrf.valueLength).toBe('tok123'.length);
    expect(byName.remember.checked).toBe(true);
    expect(sorted(byName.user)).toEqual(['checked', 'id', 'name', 'tagName', 'type', 'valueLength']);
    expect(sorted(byName.pass)).toEqual(['checked', 'id', 'name', 'tagName', 'type']);
    for (const el of elements) expect(el).not.toHaveProperty('value');
    const json = JSON.stringify(elements);
    for (const secret of ['jan.kowalski', 'sekret', 'tok123']) expect(json).not.toContain(secret);
  });

  it('password value is never read', () => {
    const pass = document.querySelector('[name="pass"]');
    let reads = 0;
    Object.defineProperty(pass, 'value', { configurable: true, get() { reads++; return 'sekret'; } });
    collectDomSnapshot(window, document, deps);
    expect(reads).toBe(0);
  });

  it('file input: fileCount instead of valueLength, value never read (C:\\fakepath leak, IN4)', () => {
    document.body.insertAdjacentHTML('beforeend', '<form id="upload"><input type="file" name="doc" multiple></form>');
    const input = document.querySelector('[name="doc"]');
    let reads = 0;
    Object.defineProperty(input, 'value', { configurable: true, get() { reads++; return 'C:\\fakepath\\umowa-jan.pdf'; } });
    Object.defineProperty(input, 'files', { configurable: true, get: () => ({ length: 2, 0: { name: 'umowa-jan.pdf' }, 1: { name: 'b.pdf' } }) });
    const form = collectDomSnapshot(window, document, deps).forms.find((f) => f.id === 'upload');
    const [el] = form.elements;
    expect(el.fileCount).toBe(2);
    expect(el).not.toHaveProperty('valueLength');
    expect(reads).toBe(0);
    expect(JSON.stringify(form)).not.toMatch(/fakepath|umowa/);
  });

  it('typed email in input not present in dom section (JSON.stringify grep)', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<form id="contact"><input type="email" name="mail"><textarea name="msg"></textarea></form>',
    );
    document.querySelector('[name="mail"]').value = 'jan.kowalski@example.com';
    document.querySelector('[name="msg"]').value = 'pisz na anna@example.com';
    for (const fullHtml of [false, true]) {
      const json = JSON.stringify(collectPageState({ win: window, doc: document, safeSlice, fullHtml }).dom);
      expect(json).not.toContain('jan.kowalski@example.com');
      expect(json).not.toContain('anna@example.com');
    }
  });

  it('storage keeps cookies string and local/session maps', () => {
    document.cookie = 'theme=dark';
    localStorage.setItem('k1', 'v1');
    localStorage.setItem('long', 'x'.repeat(6000));
    sessionStorage.setItem('s1', 'sv');
    const storage = getStorageSnapshot(window, document, deps);
    expect(sorted(storage)).toEqual(['cookies', 'localStorage', 'sessionStorage']);
    expect(typeof storage.cookies).toBe('string');
    expect(storage.cookies).toContain('theme=dark');
    expect(storage.localStorage.k1).toBe('v1');
    expect(storage.localStorage.long).toBe('x'.repeat(5000) + '... [truncated 1000 chars]');
    expect(storage.sessionStorage).toEqual({ s1: 'sv' });
  });

  it('storage reports __error when a storage getter throws', () => {
    const win = {
      get localStorage() { throw new Error('denied'); },
      sessionStorage: window.sessionStorage,
    };
    const storage = getStorageSnapshot(win, document, deps);
    expect(storage.localStorage).toEqual({ __error: 'denied' });
  });

  it('performance returns timeOrigin and navigation shape', () => {
    const perf = getPerformanceSummary({ performance: fakePerformance() }, document, deps);
    expect(sorted(perf)).toEqual(['navigation', 'resources', 'timeOrigin']);
    expect(perf.timeOrigin).toBe(1768471200000.5);
    expect(sorted(perf.navigation)).toEqual([...NAV_KEYS].sort());
    expect(perf.navigation.type).toBe('reload');
    expect(sorted(perf.resources[0])).toEqual(RESOURCE_KEYS);
    expect(perf.resources[0].renderBlockingStatus).toBeNull();
  });

  it('performance navigation is null without a navigation entry', () => {
    const perf = getPerformanceSummary(
      { performance: { timeOrigin: 1, getEntriesByType: () => [] } }, document, deps,
    );
    expect(perf).toEqual({ timeOrigin: 1, navigation: null, resources: [] });
  });

  it('collectPageState returns all four sections and no errors', () => {
    const state = collectPageState({ win: window, doc: document, safeSlice });
    expect(sorted(state)).toEqual(['dom', 'environment', 'errors', 'performance', 'storage']);
    expect(state.errors).toEqual([]);
    expect(sorted(state.environment)).toEqual(ENV_KEYS);
    expect(sorted(state.dom)).toEqual(DOM_KEYS);
  });

  it('a throwing section yields null and an error entry, other sections intact', () => {
    const win = new Proxy(window, {
      get(target, prop) {
        if (prop === 'performance') throw new TypeError('boom');
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const state = collectPageState({ win, doc: document, safeSlice });
    expect(state.performance).toBeNull();
    expect(state.errors).toEqual([{ section: 'performance', error: 'TypeError' }]);
    expect(sorted(state.environment)).toEqual(ENV_KEYS);
    expect(sorted(state.dom)).toEqual(DOM_KEYS);
    expect(sorted(state.storage)).toEqual(['cookies', 'localStorage', 'sessionStorage']);
  });
});
