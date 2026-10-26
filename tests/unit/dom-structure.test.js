// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  captureDomIntrinsics,
  serializeDom,
  elementStructure,
  DOM_STRUCTURE_MAX_CHARS,
} from '../../src/page/dom-structure.js';
import { createSelectorOf, captureSelectorIntrinsics } from '../../src/page/selector.js';

// E3-T3a (D5, AC-5.2, AC-5.3): DOM structure without texts, from a walker on intrinsics captured at document_start.

const { window, document, DOMParser, Element } = globalThis;

const FIXTURE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../fixtures/pages/structure.html'), 'utf8');

function loadFixture() {
  document.documentElement.innerHTML = new DOMParser().parseFromString(FIXTURE, 'text/html').documentElement.innerHTML;
  document.documentElement.setAttribute('lang', 'pl');
}

const structure = (root = document.documentElement, options = {}) =>
  serializeDom(root, { mode: 'structure', maxChars: DOM_STRUCTURE_MAX_CHARS, intrinsics: captureDomIntrinsics(window), ...options });

const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

// Every non-void open tag has its closing tag, in order.
function balanced(html) {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)[^>]*>/g)) {
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else if (!VOID.has(m[2])) stack.push(m[2]);
  }
  return stack.length === 0;
}

beforeEach(loadFixture);
afterEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('serializeDom (structure)', () => {
  it('limit constant is 300 000 characters', () => {
    expect(DOM_STRUCTURE_MAX_CHARS).toBe(300000);
  });

  it('structure has no text nodes, no comments, no script/style content, no value/placeholder/title/alt/aria-label (AC-5.2)', () => {
    const typed = document.getElementById('email');
    typed.value = 'typed-trap@example.com';
    const { html, truncated, omittedElements, elements } = structure();
    expect(truncated).toBe(false);
    expect(omittedElements).toBe(0);
    expect(elements).toBe(document.getElementsByTagName('*').length);
    for (const trap of [
      'trap', 'Pierwszy akapit', 'Zaloguj', 'jan.kowalski', 'anna.nowak', 'secret-style-rule', 'secretScriptValue',
      'PDS fixture', 'Menu główne', '<!--', 'href=', 'src=', 'value=', 'placeholder=', 'title=', 'alt=', 'aria-label=',
      'aria-valuetext=', 'aria-description=', 'aria-placeholder=', 'lang=', 'charset=', 'action=', 'for=',
    ]) {
      expect(html, trap).not.toContain(trap);
    }
    // Texts gone: nothing between a closing angle bracket and the next tag.
    expect(html).not.toMatch(/>[^<]+</);
    // Kept: tags (also script/style/template/noscript, empty), whitelisted attributes, type on input/button.
    expect(html).toContain('<script></script>');
    expect(html).toContain('<style></style>');
    expect(html).toContain('<template id="tpl"></template>');
    expect(html).toContain('<noscript></noscript>');
    expect(html).toContain('<header id="top" class="t" role="banner">');
    expect(html).toContain('<nav aria-expanded="false">');
    expect(html).toContain('<input type="email" id="email" class="t">');
    expect(html).toContain('<input type="text" class="t" aria-describedby="hint" data-testid="nick">');
    expect(html).toContain('<button type="submit" id="login" class="t">');
    expect(html).toContain('<select class="t" data-qa="country"><option></option></select>');
    expect(html).toContain('<div class="t" data-cy="third"></div>');
    expect(html).toContain('<img class="t">');
    expect(html).not.toContain('</img>');
    expect(html.startsWith('<html><head>')).toBe(true);
    expect(html.endsWith('</body></html>')).toBe(true);
    expect(balanced(html)).toBe(true);
  });

  it('attribute values are escaped (&, ", <)', () => {
    document.body.innerHTML = '<div id="x" class="a&quot;b<c&amp;d" data-v="1 &lt; 2"></div>';
    const { html } = structure(document.body);
    expect(html).toBe('<body><div id="x" class="a&quot;b&lt;c&amp;d" data-v="1 &lt; 2"></div></body>');
    expect(parse(html).querySelector('#x').className).toBe('a"b<c&d');
  });

  it('20 selectors from fixture (id, data-testid, nth-of-type paths from selector.js) match exactly 1 element in DOMParser(structure) (AC-5.3)', () => {
    const selectorOf = createSelectorOf({ doc: document, intrinsics: captureSelectorIntrinsics(window) });
    const targets = [...document.querySelectorAll('.t')];
    expect(targets.length).toBeGreaterThanOrEqual(20);
    const selectors = targets.map((el) => selectorOf(el));
    expect(selectors.some((s) => s.startsWith('#'))).toBe(true);
    expect(selectors.some((s) => s.includes('[data-testid='))).toBe(true);
    expect(selectors.some((s) => s.includes(':nth-of-type('))).toBe(true);
    const parsed = parse(structure().html);
    for (const sel of selectors) {
      expect(parsed.querySelectorAll(sel), sel).toHaveLength(1);
    }
  });

  it('10 000 elements → ≤ 300 000 chars, truncated true, omittedElements > 0, output parses and tags are balanced (AC-5.2)', () => {
    const rows = [];
    for (let i = 0; i < 10000; i++) {
      rows.push(`<div id="item-${i}" class="row row-${i % 7} long-class-name" data-testid="row-${i}"><span class="c"></span></div>`);
    }
    document.body.innerHTML = `<main id="list"><section>${rows.join('')}</section></main>`;
    const total = document.getElementsByTagName('*').length;
    const { html, truncated, omittedElements, elements } = structure();
    expect(html.length).toBeLessThanOrEqual(300000);
    expect(html.length).toBeGreaterThan(290000);
    expect(truncated).toBe(true);
    expect(omittedElements).toBeGreaterThan(0);
    expect(elements + omittedElements).toBe(total);
    expect(balanced(html)).toBe(true);
    expect(html.endsWith('</main></body></html>')).toBe(true);
    expect(parse(html).getElementsByTagName('*').length).toBe(elements);
  });

  it('small limit: output never exceeds maxChars and stays balanced', () => {
    for (const maxChars of [0, 5, 13, 40, 120, 333]) {
      const { html, truncated } = structure(document.documentElement, { maxChars });
      expect(html.length, String(maxChars)).toBeLessThanOrEqual(maxChars);
      expect(truncated).toBe(true);
      expect(balanced(html)).toBe(true);
    }
  });

  it('page patching Element.prototype.getAttribute after capture does not change output', () => {
    const intrinsics = captureDomIntrinsics(window);
    const before = serializeDom(document.documentElement, { mode: 'structure', maxChars: 300000, intrinsics }).html;
    const proto = Element.prototype;
    const saved = {
      getAttribute: proto.getAttribute,
      attributes: Object.getOwnPropertyDescriptor(proto, 'attributes'),
      firstElementChild: Object.getOwnPropertyDescriptor(proto, 'firstElementChild'),
      tagName: Object.getOwnPropertyDescriptor(proto, 'tagName'),
    };
    try {
      proto.getAttribute = () => 'patched-trap';
      Object.defineProperty(proto, 'attributes', { configurable: true, get: () => [] });
      Object.defineProperty(proto, 'firstElementChild', { configurable: true, get: () => null });
      Object.defineProperty(proto, 'tagName', { configurable: true, get: () => 'X-PATCHED' });
      const after = serializeDom(document.documentElement, { mode: 'structure', maxChars: 300000, intrinsics }).html;
      expect(after).toBe(before);
      expect(after).not.toContain('patched');
    } finally {
      proto.getAttribute = saved.getAttribute;
      Object.defineProperty(proto, 'attributes', saved.attributes);
      Object.defineProperty(proto, 'firstElementChild', saved.firstElementChild);
      Object.defineProperty(proto, 'tagName', saved.tagName);
    }
  });

  it('tag names outside [a-z][a-z0-9-]* skipped (with their subtree); custom elements kept', () => {
    document.body.innerHTML = '<my-widget id="w"><span></span></my-widget>';
    const odd = document.createElementNS('http://www.w3.org/1999/xhtml', 'x_odd');
    odd.appendChild(document.createElement('b'));
    document.body.appendChild(odd);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
    document.body.appendChild(svg);
    const { html, elements } = structure(document.body);
    expect(html).toBe('<body><my-widget id="w"><span></span></my-widget><svg><path></path></svg></body>');
    expect(elements).toBe(5);
  });

  it('shadow DOM and iframe content are not serialized (host/tag only)', () => {
    document.body.innerHTML = '<div id="host"></div><iframe id="f"></iframe>';
    const shadow = document.getElementById('host').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input id="inside-shadow">';
    const frameDoc = document.getElementById('f').contentDocument;
    if (frameDoc) frameDoc.body.innerHTML = '<input id="inside-frame">';
    const { html } = structure(document.body);
    expect(html).toBe('<body><div id="host"></div><iframe id="f"></iframe></body>');
  });

  it('document as root starts at documentElement; non-element root gives empty result', () => {
    expect(structure(document).html).toBe(structure(document.documentElement).html);
    expect(structure(null)).toEqual({ html: '', truncated: false, omittedElements: 0, elements: 0 });
    expect(structure(document.createTextNode('x')).html).toBe('');
  });

  it('never throws: a throwing intrinsic gives an empty result marked truncated', () => {
    const intrinsics = { ...captureDomIntrinsics(window), getLocalName: () => { throw new Error('boom'); } };
    const result = serializeDom(document.documentElement, { mode: 'structure', maxChars: 1000, intrinsics });
    expect(result.html).toBe('');
    expect(result.truncated).toBe(true);
  });

  it('10 000 elements serialized in ≤ 150 ms (jsdom)', () => {
    const rows = [];
    for (let i = 0; i < 10000; i++) rows.push(`<li id="i${i}" class="r" data-k="${i}"></li>`);
    document.body.innerHTML = `<ul>${rows.join('')}</ul>`;
    const intrinsics = captureDomIntrinsics(window);
    const run = () => serializeDom(document.documentElement, { mode: 'structure', maxChars: 1000000, intrinsics });
    run();
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const { elements } = run();
      best = Math.min(best, performance.now() - t0);
      expect(elements).toBe(document.getElementsByTagName('*').length);
    }
    expect(best, `best of 3: ${best.toFixed(1)} ms`).toBeLessThanOrEqual(150);
  });
});

describe('serializeDom (full)', () => {
  it('full mode keeps text, drops input value attribute', () => {
    const { html } = structure(document.documentElement, { mode: 'full', maxChars: 8000000 });
    expect(html).toContain('Pierwszy akapit z adresem anna.nowak@example.com');
    expect(html).toContain('title="title-trap"');
    expect(html).toContain('placeholder="placeholder-trap"');
    expect(html).toContain('lang="pl"');
    expect(html).not.toContain('value-trap');
    expect(html).not.toContain('password-trap');
    expect(html).toContain('<option value="pl">option-text-trap</option>');
    expect(html).not.toContain('<!--');
    expect(balanced(html)).toBe(true);
    const parsed = parse(html);
    expect(parsed.querySelector('#email').getAttribute('value')).toBe(null);
    expect(parsed.querySelector('header nav a').textContent).toBe('Start');
  });

  it('full mode escapes text and keeps script text parseable', () => {
    document.body.innerHTML = '<p id="p"></p><script id="s"></script>';
    document.getElementById('p').textContent = 'a < b & c > d';
    document.getElementById('s').textContent = 'var x = "</script><b>";';
    const { html } = structure(document.body, { mode: 'full' });
    const parsed = parse(html);
    expect(parsed.getElementById('p').textContent).toBe('a < b & c > d');
    expect(parsed.querySelectorAll('b')).toHaveLength(0);
    expect(balanced(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''))).toBe(true);
  });
});

describe('elementStructure', () => {
  it('element in console args: structure of the subtree, ≤ maxChars, without texts or values', () => {
    const form = document.getElementById('loginForm');
    const html = elementStructure(form, 2000);
    expect(html.startsWith('<form id="loginForm" class="t">')).toBe(true);
    expect(html.endsWith('</form>')).toBe(true);
    expect(html).not.toContain('trap');
    expect(html).not.toContain('Zaloguj');
    expect(elementStructure(form, 50).length).toBeLessThanOrEqual(50);
    expect(elementStructure(document.createTextNode('x'), 2000)).toBe('');
    expect(elementStructure(form).length).toBeLessThanOrEqual(2000);
  });
});
