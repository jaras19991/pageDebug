// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSelectorOf, captureSelectorIntrinsics, SELECTOR_MAX_CHARS } from '../../src/page/selector.js';

// E2-T5a (D4, AC-3.2): selector of an element — unique id > test attribute > nth-of-type path.

const { window, document, DOMParser, Element, Document } = globalThis;

const FIXTURE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../fixtures/pages/selectors.html'), 'utf8');

function loadFixture() {
  document.documentElement.innerHTML = new DOMParser().parseFromString(FIXTURE, 'text/html').documentElement.innerHTML;
}

const make = () => createSelectorOf({ doc: document, intrinsics: captureSelectorIntrinsics(window) });

beforeEach(loadFixture);
afterEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('selectorOf', () => {
  it('selector is unique for all 20 fixture elements (with id, with data-testid, with neither)', () => {
    const selectorOf = make();
    const targets = [...document.querySelectorAll('.t')];
    expect(targets).toHaveLength(20);
    const seen = new Set();
    for (const el of targets) {
      const sel = selectorOf(el);
      expect(typeof sel).toBe('string');
      const matches = document.querySelectorAll(sel);
      expect(matches, sel).toHaveLength(1);
      expect(matches[0]).toBe(el);
      seen.add(sel);
    }
    expect(seen.size).toBe(20);
  });

  it('prefers id over data-testid over path', () => {
    const selectorOf = make();
    expect(selectorOf(document.querySelector('#login'))).toBe('#login');
    const both = document.createElement('i');
    both.id = 'both';
    both.setAttribute('data-testid', 'both-t');
    document.body.appendChild(both);
    expect(selectorOf(both)).toBe('#both');
    expect(selectorOf(document.querySelector('[data-testid="terms"]'))).toBe('input[data-testid="terms"]');
    expect(selectorOf(document.querySelector('[data-qa="country"]'))).toBe('select[data-qa="country"]');
    expect(selectorOf(document.querySelector('form input[type=email]'))).toBe('#loginForm > input:nth-of-type(1)');
  });

  it('duplicate id falls back to data-testid then path', () => {
    const selectorOf = make();
    const dups = document.querySelectorAll('[id="dup"]');
    expect(selectorOf(dups[1])).toBe('div[data-cy="dup-second"]');
    expect(selectorOf(dups[0])).toMatch(/div:nth-of-type\(1\)$/);
    expect(selectorOf(dups[0])).not.toContain('#dup');
    // test attribute shared by two buttons is not unique either → path
    const same = document.querySelectorAll('[data-test="same"]');
    expect(selectorOf(same[1])).toMatch(/button:nth-of-type\(2\)$/);
  });

  it('escapes ids with special chars (":" , space, leading digit)', () => {
    const selectorOf = make();
    for (const id of ['a:b', 'with space', '1st']) {
      const el = document.getElementById(id);
      const sel = selectorOf(el);
      expect(sel.startsWith('#')).toBe(true);
      expect(document.querySelector(sel)).toBe(el);
    }
  });

  it('works without CSS.escape (fallback escaping)', () => {
    const intrinsics = { ...captureSelectorIntrinsics(window), cssEscape: undefined };
    const selectorOf = createSelectorOf({ doc: document, intrinsics });
    for (const id of ['a:b', 'with space', '1st']) {
      const el = document.getElementById(id);
      expect(document.querySelector(selectorOf(el))).toBe(el);
    }
    const quoted = document.createElement('b');
    quoted.setAttribute('data-testid', 'say "hi" \\ there');
    document.body.appendChild(quoted);
    expect(document.querySelector(selectorOf(quoted))).toBe(quoted);
  });

  it('page patching Element.prototype.getAttribute after capture does not change result', () => {
    const selectorOf = make();
    const el = document.querySelector('[data-testid="terms"]');
    const before = selectorOf(el);
    const origGetAttribute = Element.prototype.getAttribute;
    const origQsa = Document.prototype.querySelectorAll;
    const idDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'id');
    // jsdom's own selector engine (@asamuzakjp/dom-selector) calls the public getAttribute/id, which a browser's native engine
    // never does, so the patches answer it truthfully and lie to everyone else (that is: to our module).
    const fromJsdom = () => (new Error().stack || '').includes('dom-selector');
    try {
      Element.prototype.getAttribute = function (...args) {
        return fromJsdom() ? Reflect.apply(origGetAttribute, this, args) : 'patched';
      };
      Document.prototype.querySelectorAll = () => [];
      Object.defineProperty(Element.prototype, 'id', {
        configurable: true,
        get() {
          return fromJsdom() ? Reflect.apply(idDesc.get, this, []) : 'evil';
        },
      });
      expect(selectorOf(el)).toBe(before);
      expect(selectorOf(document.getElementById('login'))).toBe('#login');
    } finally {
      Element.prototype.getAttribute = origGetAttribute;
      Document.prototype.querySelectorAll = origQsa;
      Object.defineProperty(Element.prototype, 'id', idDesc);
    }
  });

  it('detached element returns null', () => {
    const selectorOf = make();
    const el = document.querySelector('#login');
    el.remove();
    expect(selectorOf(el)).toBeNull();
    expect(selectorOf(document.createElement('div'))).toBeNull();
    expect(selectorOf(null)).toBeNull();
    expect(selectorOf(document.createTextNode('x'))).toBeNull();
  });

  it('element in a shadow root gets the selector of its host', () => {
    const selectorOf = make();
    const host = document.createElement('my-widget');
    host.id = 'widget';
    document.body.appendChild(host);
    const inner = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('button'));
    expect(selectorOf(inner)).toBe('#widget');
  });

  it('selector length capped', () => {
    const selectorOf = make();
    let parent = document.body;
    for (let i = 0; i < 200; i++) parent = parent.appendChild(document.createElement('section'));
    const deep = parent.appendChild(document.createElement('span'));
    const sel = selectorOf(deep);
    expect(SELECTOR_MAX_CHARS).toBe(1000);
    expect(sel.length).toBeLessThanOrEqual(1000);
    expect(sel.endsWith('section > span')).toBe(true);
    const longId = document.createElement('i');
    longId.id = 'x'.repeat(2000);
    document.body.appendChild(longId);
    expect(selectorOf(longId).length).toBeLessThanOrEqual(1000);
  });

  it('above 5000 elements the test-attribute step is skipped', () => {
    const selectorOf = make();
    const box = document.body.appendChild(document.createElement('div'));
    box.id = 'big';
    for (let i = 0; i < 5000; i++) box.appendChild(document.createElement('i'));
    const el = box.appendChild(document.createElement('b'));
    el.setAttribute('data-testid', 'tagged');
    expect(selectorOf(el)).toBe('#big > b');
    box.remove();
    expect(selectorOf(document.querySelector('[data-testid="terms"]'))).toBe('input[data-testid="terms"]');
  });
});
