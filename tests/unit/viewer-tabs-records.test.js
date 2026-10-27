// @vitest-environment jsdom
// E4-T3c (AC-4.3, AC-4.4, AC-4.5): record tabs of the viewer — steps timeline, errors, network with filters, console.
// Each renderer takes a normalized (v4-shaped) snapshot and returns one element; package data is text only.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatClock, renderConsole, renderErrors, renderNetwork, renderSteps, NETWORK_PAGE } from '../../src/viewer/tabs-records.js';

// jsdom replaces the global URL, so build the path from the file name, not with new URL().
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const v4 = () => JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'snapshots', 'v4.json'), 'utf8'));

const TRAPS = [
  '<script>globalThis.__pwned = 1</script>',
  '<img src=x onerror="globalThis.__pwned = 1">',
  'javascript:globalThis.__pwned = 1',
  '<a href="javascript:alert(1)">klik</a>',
];

afterEach(() => {
  document.body.textContent = '';
  delete globalThis.__pwned;
});

function mount(node) {
  document.body.append(node);
  return node;
}

// Nothing from the data became markup: no executable or navigating element, no event or URL attribute.
function expectNoMarkupFromData(node) {
  expect(node.querySelectorAll('script, img, a, iframe, svg, style, link')).toHaveLength(0);
  for (const el of [node, ...node.querySelectorAll('*')]) {
    for (const attr of el.attributes) expect(attr.name).not.toMatch(/^(on|href|src|style)/);
  }
  expect(globalThis.__pwned).toBeUndefined();
}

function setControl(tab, filter, value) {
  const control = tab.querySelector(`[data-filter="${filter}"]`);
  control.value = value;
  control.dispatchEvent(new Event(control.tagName === 'INPUT' ? 'input' : 'change', { bubbles: true }));
}

describe('formatClock', () => {
  it('local HH:MM:SS.mmm; unknown time as a dash', () => {
    const at = new Date(2026, 0, 15, 9, 5, 7, 42).getTime();
    expect(formatClock(at)).toBe('09:05:07.042');
    expect(formatClock(null)).toBe('—');
  });
});

describe('renderSteps', () => {
  it('steps tab on v4.json: chronological items with a boundary between documents', () => {
    const s = v4();
    const tab = mount(renderSteps(s));
    const items = [...tab.querySelectorAll('li[data-kind]')];
    const kinds = items.map((li) => li.dataset.kind);
    expect(kinds).toContain('step');
    expect(kinds).toContain('error');
    expect(kinds).toContain('request');
    // chronological by absolute time
    const ats = items.map((li) => Number(li.dataset.at)).filter((n) => Number.isFinite(n));
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    // two document boundaries; every record between them belongs to doc 0, every one after to doc 1
    const bounds = kinds.flatMap((k, i) => (k === 'document' ? [i] : []));
    expect(bounds).toHaveLength(2);
    expect(bounds[0]).toBe(0);
    const between = items.slice(bounds[0] + 1, bounds[1]).map((li) => li.dataset.doc);
    const after = items.slice(bounds[1] + 1).map((li) => li.dataset.doc);
    expect(between.length).toBeGreaterThan(0);
    expect(new Set(between)).toEqual(new Set(['0']));
    expect(new Set(after)).toEqual(new Set(['1']));
    expect(items[bounds[1]].textContent).toContain('http://127.0.0.1:8080/result.html');
    // absolute local clock and relative seconds with a Polish decimal comma
    expect(items[1].textContent).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
    expect(tab.textContent).toMatch(/\d+,\d s/);
    expectNoMarkupFromData(tab);
  });

  it('empty or broken snapshot gives a Polish empty state, never throws', () => {
    for (const s of [{}, null, { steps: 'x', documents: 5 }]) {
      const tab = renderSteps(s);
      expect(tab).toBeInstanceOf(HTMLElement);
      expect(tab.textContent).toContain('Brak');
    }
  });
});

describe('renderErrors', () => {
  it('groups with count, frame and an expandable stack as text', () => {
    const s = v4();
    s.runtimeErrors.push({ ...s.runtimeErrors[0], t: 20, stack: `TypeError: x\n    at ${TRAPS[0]}` });
    const tab = mount(renderErrors(s));
    const groups = tab.querySelectorAll('details');
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups[0].querySelector('summary').textContent).toContain('2×');
    expect(groups[0].querySelector('pre').textContent).toContain('TypeError');
    expect(tab.textContent).toContain('result.html:3:9');
    expectNoMarkupFromData(tab);
  });

  it('no errors → Polish empty state', () => {
    expect(renderErrors({ runtimeErrors: [], consoleLogs: [] }).textContent).toContain('Brak błędów');
  });
});

function generated(n) {
  const types = ['fetch', 'xhr', 'img', 'script'];
  const statuses = [200, 301, 404, 500, null];
  const network = [];
  for (let i = 0; i < n; i++) {
    const status = statuses[i % statuses.length];
    network.push({
      t: i, doc: 0, type: types[i % types.length], method: i % 2 ? 'POST' : 'GET',
      url: `https://example.test/${i % 7 === 0 ? 'missing' : 'ok'}/${i}.png`,
      status, ok: status !== null && status < 400, durationMs: i % 50, sizeBytes: 100,
      requestHeaders: { accept: '*/*' }, responseHeaders: {}, requestBody: null,
      error: status === null && i % 10 === 4 ? 'net::ERR_FAILED' : null,
    });
  }
  return { schemaVersion: 4, documents: [{ id: 0, url: 'https://example.test/', timeOrigin: 1e12 }], network };
}

describe('renderNetwork', () => {
  it('network filter 4xx + type img + "missing" → count text and rows; 5000 entries filter ≤ 500 ms (jsdom)', () => {
    const s = generated(5000);
    const expected = s.network.filter((e) => e.status >= 400 && e.status < 500 && e.type === 'img' && e.url.includes('missing')).length;
    expect(expected).toBeGreaterThan(0);
    const tab = mount(renderNetwork(s));
    expect(tab.querySelector('[data-count]').textContent).toContain('5000 z 5000');
    expect(tab.querySelectorAll('.net-row')).toHaveLength(NETWORK_PAGE);
    const started = performance.now();
    setControl(tab, 'status', '4xx');
    setControl(tab, 'type', 'img');
    setControl(tab, 'url', 'MISSING');
    const elapsed = performance.now() - started;
    expect(tab.querySelector('[data-count]').textContent).toContain(`${expected} z 5000`);
    expect(tab.querySelectorAll('.net-row')).toHaveLength(Math.min(expected, NETWORK_PAGE));
    for (const row of tab.querySelectorAll('.net-row')) expect(row.querySelector('summary').textContent).toContain('404');
    expect(elapsed).toBeLessThan(500);
  });

  it('status class options include error and unknown; "Pokaż kolejne 200" pages, the count counts all', () => {
    const s = generated(450);
    const tab = mount(renderNetwork(s));
    const values = [...tab.querySelector('[data-filter="status"]').options].map((o) => o.value);
    expect(values).toEqual(['', '2xx', '3xx', '4xx', '5xx', 'error', 'unknown']);
    setControl(tab, 'status', 'error');
    expect(tab.querySelector('[data-count]').textContent).toContain(`${s.network.filter((e) => e.error).length} z 450`);
    setControl(tab, 'status', '');
    const more = tab.querySelector('[data-action="more"]');
    expect(more.hidden).toBe(false);
    more.click();
    expect(tab.querySelectorAll('.net-row')).toHaveLength(400);
    more.click();
    expect(tab.querySelectorAll('.net-row')).toHaveLength(450);
    expect(more.hidden).toBe(true);
  });

  it('row details on v4.json: headers, request body and response preview as text', () => {
    const tab = mount(renderNetwork(v4()));
    const row = [...tab.querySelectorAll('.net-row')].find((r) => r.textContent.includes('/api/fail'));
    expect(row.textContent).toContain('authorization');
    expect(row.textContent).toContain('[redacted:key-authorization]');
    expect(row.textContent).toContain('{"error":"expired"}');
    expect(row.querySelector('summary').textContent).toContain('500');
  });

  it('console args and network bodies with <script>, javascript:, onerror rendered as text', () => {
    const s = generated(3);
    s.network[0].url = TRAPS[2];
    s.network[0].responseBodyPreview = TRAPS[0];
    s.network[1].requestBody = TRAPS[1];
    s.network[1].responseHeaders = { [TRAPS[3]]: TRAPS[1] };
    s.network[2].type = TRAPS[1];
    const tab = mount(renderNetwork(s));
    for (const trap of TRAPS) expect(tab.textContent).toContain(trap);
    expectNoMarkupFromData(tab);
  });
});

describe('renderConsole', () => {
  it('level, time and arguments as JSON text', () => {
    const tab = mount(renderConsole(v4()));
    const rows = tab.querySelectorAll('[data-level]');
    expect(rows).toHaveLength(4);
    expect([...rows].map((r) => r.dataset.level)).toContain('error');
    expect(tab.textContent).toContain('"form ready"');
    expect(tab.textContent).toContain('"tagName":"BUTTON"');
    expect(tab.textContent).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  it('console args and network bodies with <script>, javascript:, onerror rendered as text', () => {
    const s = {
      documents: [{ id: 0, timeOrigin: 1e12 }],
      consoleLogs: [
        { t: 1, doc: 0, level: 'log', args: TRAPS.map((t) => JSON.stringify(t)) },
        { t: 2, doc: 0, level: 'error', args: [{ name: 'Error', message: TRAPS[1], stack: TRAPS[0] }], stack: TRAPS[3] },
        { t: 3, doc: 0, level: TRAPS[1], args: [{ truncated: true, preview: TRAPS[0] }] },
      ],
    };
    const tab = mount(renderConsole(s));
    expect(tab.textContent).toContain('javascript:globalThis.__pwned = 1');
    expect(tab.textContent).toContain('onerror');
    expect(tab.textContent).toContain('<script>');
    expectNoMarkupFromData(tab);
  });

  it('args {truncated, preview} (E4-FIX2): message and one <pre> with the preview, as text', () => {
    const s = { documents: [{ id: 0, timeOrigin: 1e12 }], consoleLogs: [{ t: 1, doc: 0, level: 'error', args: { truncated: true, preview: `["long ${TRAPS[0]}",` } }] };
    const tab = mount(renderConsole(s));
    expect(tab.querySelector('.message').textContent).toContain('long <script>');
    const pres = tab.querySelectorAll('pre.arg');
    expect(pres).toHaveLength(1);
    expect(pres[0].textContent).toBe(`["long ${TRAPS[0]}",`);
    expectNoMarkupFromData(tab);
  });

  it('empty console → Polish empty state', () => {
    expect(renderConsole({}).textContent).toContain('Brak wpisów konsoli');
  });
});
