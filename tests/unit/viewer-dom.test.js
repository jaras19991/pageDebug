// @vitest-environment jsdom
// E4-T3d (D3, AC-4.5): the viewer builds DOM only through src/viewer/dom.js — page data becomes text
// nodes, attributes come from a closed list, images only from blob: URLs — and ESLint forbids the rest.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTRS_PATTERN, TAGS, h, revokeAll, setImageBytes, textBlock } from '../../src/viewer/dom.js';

// jsdom replaces the global URL, so build the path from the file name, not with new URL().
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ESLINT_TIMEOUT_MS = 120000; // loading ESLint on /mnt/c in WSL takes up to half a minute under load

const TRAPS = [
  '<img src=x onerror="globalThis.__pwned = 1">',
  '<script>globalThis.__pwned = 1</script>',
  'javascript:globalThis.__pwned = 1',
  '<a href="javascript:alert(1)">klik</a>',
  '<!-- --><svg onload=alert(1)>',
];

afterEach(() => {
  revokeAll();
  document.body.textContent = '';
  vi.restoreAllMocks();
});

// Every element and attribute under `node`, for "nothing from the data became markup" checks.
function inventory(node) {
  const elements = [node, ...node.querySelectorAll('*')];
  return {
    tags: elements.map((e) => e.tagName.toLowerCase()),
    attrs: elements.flatMap((e) => [...e.attributes].map((a) => a.name)),
  };
}

describe('h', () => {
  it('strings become text: "<img src=x onerror=…>" renders as text, no element, no attribute', () => {
    for (const trap of TRAPS) {
      const el = h('div', null, trap);
      document.body.append(el);
      expect(el.textContent).toBe(trap);
      expect(el.childNodes).toHaveLength(1);
      expect(el.firstChild.nodeType).toBe(Node.TEXT_NODE);
      expect(inventory(el)).toEqual({ tags: ['div'], attrs: [] });
    }
    expect(document.querySelectorAll('img, script, a, svg')).toHaveLength(0);
    expect(globalThis.__pwned).toBeUndefined();
  });

  it('javascript: string as child is text only, no anchor created', () => {
    const el = h('li', { class: 'url' }, 'javascript:alert(1)', ' ', h('code', null, 'javascript:void 0'));
    expect(el.querySelector('a')).toBeNull();
    expect(inventory(el)).toEqual({ tags: ['li', 'code'], attrs: ['class'] });
    expect(el.textContent).toBe('javascript:alert(1) javascript:void 0');
  });

  it('page data in allowed attribute values stays a value, never markup', () => {
    const el = h('div', { title: TRAPS[0], 'data-url': TRAPS[2], 'aria-label': TRAPS[1] });
    expect(el.title).toBe(TRAPS[0]);
    expect(el.dataset.url).toBe(TRAPS[2]);
    expect(el.getAttribute('aria-label')).toBe(TRAPS[1]);
    expect(el.children).toHaveLength(0);
  });

  it('on* / href / src / style attributes throw; unknown tag throws', () => {
    for (const name of ['onclick', 'onerror', 'ONLOAD', 'href', 'src', 'srcdoc', 'style', 'action', 'formaction', 'xlink:href', 'Class', 'data-', 'aria-']) {
      expect(() => h('div', { [name]: 'x' }), name).toThrow(TypeError);
    }
    for (const tag of ['script', 'a', 'iframe', 'object', 'embed', 'svg', 'math', 'style', 'link', 'meta', 'form', 'base', 'template', 'DIV', 'img onerror=x']) {
      expect(() => h(tag), tag).toThrow(TypeError);
    }
  });

  it('allows the documented tags and attributes', () => {
    expect(TAGS).toEqual(expect.arrayContaining(['div', 'pre', 'table', 'h1', 'h3', 'button', 'input', 'img', 'details', 'summary']));
    const attrs = { class: 'c', id: 'i', role: 'tab', 'aria-selected': 'true', 'data-tab': 'network', type: 'button', hidden: true, title: 't', value: 'v', for: 'x', placeholder: 'p' };
    const el = h('button', attrs);
    expect(Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]))).toEqual({ ...attrs, hidden: '' });
    for (const name of Object.keys(attrs)) expect(ATTRS_PATTERN.test(name), name).toBe(true);
  });

  it('children: strings and numbers as text, nodes, nested arrays; null/undefined/false skipped', () => {
    const el = h('ul', null, [h('li', null, 'a', 1), [null, undefined, false, h('li', null, 0)]], 'x');
    expect([...el.childNodes].map((n) => n.nodeName)).toEqual(['LI', 'LI', '#text']);
    expect(el.textContent).toBe('a10x');
  });

  it('boolean false / null attribute is omitted; objects and functions are rejected', () => {
    expect(h('div', { hidden: false, title: null }).attributes).toHaveLength(0);
    expect(() => h('div', { title: { toString: () => '<b>' } })).toThrow(TypeError);
    expect(() => h('div', null, { nodeType: 1 })).toThrow(TypeError);
    expect(() => h('div', null, () => 'x')).toThrow(TypeError);
    expect(() => h('div', null, true)).toThrow(TypeError);
  });
});

describe('setImageBytes', () => {
  it('setImageBytes uses blob: URL', () => {
    const created = [];
    URL.createObjectURL = vi.fn((blob) => { created.push(blob); return `blob:null/${created.length}`; });
    URL.revokeObjectURL = vi.fn();
    const img = h('img', { class: 'shot' });
    const url = setImageBytes(img, new Uint8Array([0xff, 0xd8, 0xff]));
    expect(url).toBe('blob:null/1');
    expect(img.getAttribute('src')).toBe('blob:null/1');
    expect(created[0]).toBeInstanceOf(Blob);
    expect(created[0].type).toBe('image/jpeg');
    expect(created[0].size).toBe(3);
    setImageBytes(h('img'), new Uint8Array([1]).buffer, 'image/png');
    expect(created[1].type).toBe('image/png');
    revokeAll();
    expect(URL.revokeObjectURL.mock.calls.map(([u]) => u)).toEqual(['blob:null/1', 'blob:null/2']);
    revokeAll();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-img target, non-byte data and non-raster types', () => {
    URL.createObjectURL = vi.fn(() => 'blob:null/x');
    expect(() => setImageBytes(h('div'), new Uint8Array(1))).toThrow(TypeError);
    expect(() => setImageBytes(h('img'), 'data:image/png;base64,AAAA')).toThrow(TypeError);
    expect(() => setImageBytes(h('img'), new Uint8Array(1), 'image/svg+xml')).toThrow(TypeError);
    expect(() => setImageBytes(h('img'), new Uint8Array(1), 'text/html')).toThrow(TypeError);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe('textBlock', () => {
  it('renders text as text inside <pre>', () => {
    const pre = textBlock('<script>alert(1)</script>\n<p>x</p>', 1000);
    expect(pre.tagName).toBe('PRE');
    expect(pre.textContent).toBe('<script>alert(1)</script>\n<p>x</p>');
    expect(pre.querySelector('*')).toBeNull();
    expect(pre.hasAttribute('data-truncated')).toBe(false);
  });

  it('cuts to maxChars and says so in Polish', () => {
    const pre = textBlock('a'.repeat(50), 10);
    expect(pre.dataset.truncated).toBe('40');
    expect(pre.firstChild.textContent).toBe('a'.repeat(10));
    expect(pre.textContent).toMatch(/pokazano 10 z 50 znaków/);
  });

  it('does not split a surrogate pair at the cut', () => {
    const pre = textBlock('ab😀cd', 3);
    expect(pre.firstChild.textContent).toBe('ab');
  });
});

describe('ESLint rules for src/viewer', () => {
  it('eslint rejects innerHTML in src/viewer (ESLint API on a temp source)', async () => {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: root });
    const lint = async (code) => {
      const [result] = await eslint.lintText(code, { filePath: join(root, 'src', 'viewer', '__lint-probe.js') });
      return result.messages.map((m) => m.ruleId);
    };
    const bad = {
      innerHTML: "export function f(el, s) { el.innerHTML = s; }\n",
      outerHTML: "export function f(el, s) { el.outerHTML = s; }\n",
      insertAdjacentHTML: "export function f(el, s) { el.insertAdjacentHTML('beforeend', s); }\n",
      setAttribute: "export function f(el, s) { el.setAttribute('href', s); }\n",
      srcdoc: "export function f(el, s) { el.srcdoc = s; }\n",
      documentWrite: "export function f(s) { document.write(s); }\n",
      documentWriteln: "export function f(s) { document.writeln(s); }\n",
      fetch: "export function f(u) { return fetch(u); }\n",
      xhr: 'export function f() { return new XMLHttpRequest(); }\n',
      webSocket: "export function f(u) { return new WebSocket(u); }\n",
      eventSource: "export function f(u) { return new EventSource(u); }\n",
      chrome: 'export function f() { return chrome.runtime.id; }\n',
      browser: 'export function f() { return browser.runtime.id; }\n',
      eval: "export function f(s) { return eval(s); }\n",
      newFunction: "export function f(s) { return new Function(s); }\n",
    };
    for (const [name, code] of Object.entries(bad)) {
      const rules = await lint(code);
      expect(rules.length, name).toBeGreaterThan(0);
      expect(rules.some((r) => ['no-restricted-properties', 'no-restricted-globals', 'no-eval', 'no-new-func'].includes(r)), `${name}: ${rules}`).toBe(true);
    }
    expect(await lint("export function f(el, s) { el.textContent = s; }\n")).toEqual([]);
  }, ESLINT_TIMEOUT_MS);

  it('src/viewer and mcp lint clean with the project config', async () => {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: root });
    const results = await eslint.lintFiles(['src/viewer/**/*.js', 'mcp/**/*.js']);
    expect(results.length).toBeGreaterThan(0);
    expect(results.flatMap((r) => r.messages.map((m) => `${r.filePath}:${m.line} ${m.ruleId} ${m.message}`))).toEqual([]);
  }, ESLINT_TIMEOUT_MS);
});
