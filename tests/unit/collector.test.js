// @vitest-environment jsdom
/* global window, document */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  collectPageState,
  collectEnvironment,
  collectDomSnapshot,
  getPerformanceSummary,
  getStorageSnapshot,
} from '../../src/page/collector.js';

// Minimal local copy of v1 safeSlice (the real one lives in src/page/serialize.js, E1-T3a).
// The collector receives it through `deps`, so the test does not depend on T3a.
function safeSlice(value, max) {
  if (typeof value !== 'string') return value;
  return value.length > max ? value.slice(0, max) + `... [truncated ${value.length - max} chars]` : value;
}

const deps = { safeSlice };

// v1 key lists (snapshot.json without schemaVersion): v2 keeps these sections unchanged.
const ENV_KEYS = ['document', 'location', 'navigator', 'screen', 'timestamp', 'viewport'];
const DOM_KEYS = [
  'canonical',
  'counts',
  'forms',
  'hreflangs',
  'html',
  'iframes',
  'images',
  'meta',
  'rootMarkers',
  'scripts',
  'stylesheets',
];
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

  it('dom keeps v1 keys', () => {
    const dom = collectDomSnapshot(window, document, deps);
    expect(sorted(dom)).toEqual(DOM_KEYS);
    expect(sorted(dom.counts)).toEqual(
      ['forms', 'iframes', 'images', 'links', 'scripts', 'stylesheets', 'totalElements'],
    );
    expect(sorted(dom.html)).toEqual(['charset', 'compatMode', 'doctype', 'lang', 'outerHTML']);
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
    expect(sorted(dom.images[0])).toEqual(
      ['alt', 'height', 'loading', 'naturalHeight', 'naturalWidth', 'src', 'width'],
    );
    expect(sorted(dom.iframes[0])).toEqual(['attributes', 'id', 'name', 'src', 'title']);
    expect(sorted(dom.forms[0])).toEqual(['action', 'elements', 'enctype', 'id', 'method', 'name']);
    expect(dom.rootMarkers.htmlClassName).toBe('html-root');
    expect(dom.rootMarkers.dataAttributesOnHtml['data-app']).toBe('test');
    expect(dom.rootMarkers.bodyClassName).toBe('page');
  });

  it('dom html.outerHTML is cut by limits.html via injected safeSlice', () => {
    const dom = collectDomSnapshot(window, document, { safeSlice, limits: { html: 50 } });
    expect(dom.html.outerHTML).toMatch(/^.{50}\.\.\. \[truncated \d+ chars\]$/s);
  });

  it('dom forms redact password and hidden as in v1', () => {
    const elements = collectDomSnapshot(window, document, deps).forms[0].elements;
    const byName = Object.fromEntries(elements.map((e) => [e.name, e]));
    expect(byName.user.value).toBe('jan');
    expect(byName.pass.value).toBe('[redacted]');
    expect(byName.csrf.value).toBe('[redacted]');
    expect(byName.remember.checked).toBe(true);
    expect(sorted(byName.user)).toEqual(['checked', 'id', 'name', 'tagName', 'type', 'value']);
    expect(JSON.stringify(elements)).not.toContain('sekret');
    expect(JSON.stringify(elements)).not.toContain('tok123');
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
