// @vitest-environment jsdom
// E4-T3e (AC-3.5, AC-4.1, AC-4.5): page tabs of the viewer — CWV per document, DOM, storage.
// Each renderer takes a normalized (v4-shaped) snapshot and returns one element; package data is text only.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDom, renderStorage, renderVitals } from '../../src/viewer/tabs-page.js';
import { normalizeSnapshot } from '../../src/lib/migrate.js';

// jsdom replaces the global URL, so build the path from the file name, not with new URL().
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = (name) => JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'snapshots', name), 'utf8'));

const TRAPS = [
  '<script>globalThis.__pwned = 1</script>',
  '<img src=x onerror="globalThis.__pwned = 1">',
  'javascript:globalThis.__pwned = 1',
];

afterEach(() => {
  document.body.textContent = '';
  delete globalThis.__pwned;
});

function mount(node) {
  document.body.append(node);
  return node;
}

function expectNoMarkupFromData(node) {
  expect(node.querySelectorAll('script, img, a, iframe, svg, style, link, main, form, input[type="email"]')).toHaveLength(0);
  for (const el of [node, ...node.querySelectorAll('*')]) {
    for (const attr of el.attributes) expect(attr.name).not.toMatch(/^(on|href|src|style)/);
  }
  expect(globalThis.__pwned).toBeUndefined();
}

// Cell texts of the metric row `name` in the document table `index`.
function metricRow(tab, index, name) {
  const table = tab.querySelectorAll('table[data-doc]')[index];
  const row = [...table.querySelectorAll('tbody tr')].find((tr) => tr.cells[0].textContent === name);
  return [...row.cells].map((c) => c.textContent);
}

describe('renderVitals', () => {
  it('CWV unavailable shows reason, never 0', () => {
    const tab = mount(renderVitals(fixture('v4.json')));
    expect(tab.querySelectorAll('table[data-doc]')).toHaveLength(2);
    const cls0 = metricRow(tab, 0, 'CLS');
    expect(cls0.join(' ')).toContain('niedostępne');
    expect(cls0.join(' ')).toContain('przeglądarka tego nie mierzy');
    expect(cls0[1]).not.toMatch(/\b0\b/);
    const lcp1 = metricRow(tab, 1, 'LCP');
    expect(lcp1[1]).toContain('4300 ms');
    expect(lcp1[2]).toBe('słabo');
    expect(lcp1[3]).toContain('#hero');
    expect(metricRow(tab, 1, 'CLS')[1]).toContain('0,183');
    expect(metricRow(tab, 1, 'CLS')[3]).toContain('main > h1');
    expect(metricRow(tab, 1, 'INP')[3]).toContain('#slow');
    expect(metricRow(tab, 1, 'INP')[3]).toContain('click');
    // long tasks: unavailable with reason for doc 0, listed for doc 1
    expect(tab.textContent).toContain('heavyWork');
    expect(tab.textContent).toContain('212 ms');
  });

  it('missing value or unknown reason code: unavailable with the code as text, never 0', () => {
    const s = { documents: [{ id: 0, url: 'https://x.test/' }], vitals: [{ doc: 0, LCP: { available: true, value: 'x' }, INP: { available: false, reason: TRAPS[1] } }] };
    const tab = mount(renderVitals(s));
    expect(metricRow(tab, 0, 'LCP')[1]).toContain('nieznany powód');
    expect(metricRow(tab, 0, 'INP')[1]).toContain(TRAPS[1]);
    for (const name of ['TTFB', 'FCP', 'LCP', 'CLS', 'INP']) expect(metricRow(tab, 0, name)[1]).not.toMatch(/^0/);
    expectNoMarkupFromData(tab);
  });

  it('no vitals → Polish empty state', () => {
    expect(renderVitals({}).textContent).toContain('Brak pomiarów');
  });
});

describe('renderDom', () => {
  it('dom.structure with <script> shown as text, no element created', () => {
    const s = fixture('v4.json');
    s.dom.structure = `${s.dom.structure}${TRAPS[0]}${TRAPS[1]}`;
    s.dom.scripts = [{ src: TRAPS[2], async: false, type: TRAPS[1] }];
    s.dom.images = [{ src: TRAPS[1], width: 10, altLength: 0 }];
    const tab = mount(renderDom(s));
    expect(tab.textContent).toContain('<main id="app" data-section="result">');
    expect(tab.textContent).toContain(TRAPS[0]);
    expect(tab.textContent).toContain(TRAPS[2]);
    expect(tab.textContent).toContain('totalElements');
    expect(tab.textContent).toContain('profile'); // forms table
    expect(tab.textContent).toContain('valueLength');
    expectNoMarkupFromData(tab);
  });

  it('fullHtml is shown as text cut to 1 MB with a note', () => {
    const s = { dom: { counts: {}, structure: null, fullHtml: `${TRAPS[0]}${'x'.repeat(1_200_000)}` } };
    const tab = mount(renderDom(s));
    const pre = [...tab.querySelectorAll('pre')].find((p) => p.textContent.startsWith(TRAPS[0]));
    expect(pre.dataset.truncated).toBeDefined();
    expect(pre.textContent).toContain('ucięto');
    expectNoMarkupFromData(tab);
  });

  it('v3 outerHTML rendered as text', () => {
    const { snapshot: s } = normalizeSnapshot(fixture('v3.json'));
    s.dom.html.outerHTML = `<html><body><p>Wynik</p>${TRAPS[1]}</body></html>`;
    const tab = mount(renderDom(s));
    expect(tab.textContent).toContain('<p>Wynik</p>');
    expect(tab.textContent).toContain(TRAPS[1]);
    expectNoMarkupFromData(tab);
  });

  it('no dom → Polish empty state', () => {
    expect(renderDom({}).textContent).toContain('Brak danych o DOM');
  });
});

describe('renderStorage', () => {
  it('cookies (name, size, hash) and both storages as key–value text', () => {
    const tab = mount(renderStorage(fixture('v4.json')));
    expect(tab.textContent).toContain('93d70a40');
    expect(tab.textContent).toContain('45');
    expect(tab.textContent).toContain('[redacted:key-token]');
    expect(tab.textContent).toContain('cart');
  });

  it('storage keys with <img onerror> as text', () => {
    const s = {
      storage: {
        cookies: [{ name: TRAPS[1], sizeBytes: 3, valueHash: TRAPS[0] }],
        localStorage: { [TRAPS[1]]: TRAPS[0] },
        sessionStorage: { [TRAPS[2]]: TRAPS[2] },
      },
    };
    const tab = mount(renderStorage(s));
    for (const trap of TRAPS) expect(tab.textContent).toContain(trap);
    expectNoMarkupFromData(tab);
  });

  it('no storage → Polish empty state; never throws on odd shapes', () => {
    expect(renderStorage({}).textContent).toContain('Brak danych');
    expect(() => renderStorage({ storage: { cookies: 'a=b', localStorage: null, sessionStorage: 5 } })).not.toThrow();
  });
});
