import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  QUERY_LIMITS,
  recordingStartMs,
  absTime,
  relSeconds,
  consoleText,
  firstFrame,
  errorEvents,
  firstErrorAt,
  errorGroups,
  stepList,
  isFailedRequest,
  statusClass,
  failedRequests,
  filterNetwork,
  timeline,
} from '../../src/lib/snapshot-query.js';
import { recount } from '../../src/lib/budget.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/snapshots/${name}.json`, import.meta.url), 'utf8'));
const v4 = () => fixture('v4');

const DOC0 = 1768471200120.5;
const DOC1 = 1768471204200.25;
const REC_START = Date.parse('2026-01-15T10:00:00.000Z');

function median(fn, runs = 5) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

describe('time (snapshot-schema time convention)', () => {
  it('absTime uses the record\'s own document timeOrigin; null without it', () => {
    const s = v4();
    expect(absTime(s, { doc: 0, t: 812.4 })).toBe(DOC0 + 812.4);
    expect(absTime(s, { doc: 1, t: 8.7 })).toBe(DOC1 + 8.7);
    // Not the package-level timeOrigin (that is the last document's).
    expect(absTime(s, { doc: 0, t: 0 })).not.toBe(s.timeOrigin);
    expect(absTime(s, { doc: 7, t: 1 })).toBeNull();
    expect(absTime(s, { doc: 0 })).toBeNull();
    const noOrigin = { documents: [{ id: 0, url: 'x', timeOrigin: null }] };
    expect(absTime(noOrigin, { doc: 0, t: 5 })).toBeNull();
    // Documents found by id, not only by index.
    expect(absTime({ documents: [{ id: 3, timeOrigin: 1000 }] }, { doc: 3, t: 5 })).toBe(1005);
  });

  it('recordingStartMs from recordingStartedAt, fallback first document timeOrigin; relSeconds', () => {
    const s = v4();
    expect(recordingStartMs(s)).toBe(REC_START);
    delete s.recordingStartedAt;
    expect(recordingStartMs(s)).toBe(DOC0);
    expect(recordingStartMs({})).toBeNull();
    const s2 = v4();
    expect(relSeconds(s2, { doc: 1, t: 2050 })).toBeCloseTo((DOC1 + 2050 - REC_START) / 1000, 9);
    expect(relSeconds(s2, { doc: 9, t: 1 })).toBeNull();
    expect(relSeconds({}, { doc: 0, t: 1 })).toBeNull();
  });
});

describe('consoleText / firstFrame', () => {
  it('first argument: string, unwrapped JSON string, error {name,message}, {truncated, preview}', () => {
    expect(consoleText({ args: ['plain text', 'x'] })).toBe('plain text');
    expect(consoleText({ args: ['"save failed"', '{"code":500}'] })).toBe('save failed');
    expect(consoleText({ args: [{ name: 'TypeError', message: 'x is undefined', stack: '…' }] })).toBe('TypeError: x is undefined');
    expect(consoleText({ args: [{ message: 'no name' }] })).toBe('no name');
    expect(consoleText({ args: [{ truncated: true, preview: '"abc' }] })).toBe('"abc');
    // A long entry is `{ truncated, preview }` in place of the arguments list (E4-FIX2): its preview is the text.
    expect(consoleText({ args: { truncated: true, preview: '["save failed","x"' } })).toBe('["save failed","x"');
    expect(consoleText({ args: { truncated: true } })).toBe('');
    expect(consoleText({ args: [{ a: 1 }] })).toBe('{"a":1}');
    expect(consoleText({ args: [42] })).toBe('42');
    expect(consoleText({ args: [] })).toBe('');
    expect(consoleText({})).toBe('');
    expect(consoleText(null)).toBe('');
    // JSON-string of an error object (v2 shape)
    expect(consoleText({ args: ['{"name":"Error","message":"boom"}'] })).toBe('Error: boom');
  });

  it('consoleText is capped', () => {
    const long = 'a'.repeat(50000);
    expect(consoleText({ args: [long] }).length).toBeLessThanOrEqual(QUERY_LIMITS.messageChars);
    expect(consoleText({ args: [JSON.stringify(long)] }).length).toBeLessThanOrEqual(QUERY_LIMITS.messageChars);
    expect(consoleText({ args: [JSON.stringify(long)] })).toMatch(/^a+$/);
  });

  it('first frame file:line:col for V8 and Firefox stacks, fallback filename:lineno:colno', () => {
    expect(firstFrame('TypeError: x is undefined\n    at onSave (http://127.0.0.1:8080/result.js:12:9)\n    at b (http://x/y.js:1:1)')).toBe('result.js:12:9');
    expect(firstFrame('TypeError: x\n    at http://127.0.0.1:8080/result.html:3:9')).toBe('result.html:3:9');
    expect(firstFrame('at onSave (http://127.0.0.1:8080/app/main.js?v=3#x:7:2)')).toBe('main.js:7:2');
    expect(firstFrame('onSave@http://127.0.0.1:8080/result.js:12:9\n@http://x/y.js:1:1')).toBe('result.js:12:9');
    expect(firstFrame('@debugger eval code:1:5')).toBe('debugger eval code:1:5');
    expect(firstFrame('Error: frame failed', { filename: 'http://127.0.0.1:8080/inner.html', lineno: 1, colno: 1 })).toBe('inner.html:1:1');
    expect(firstFrame('Error: no frames')).toBeNull();
    expect(firstFrame(undefined, { filename: '', lineno: 0 })).toBeNull();
    expect(firstFrame(null)).toBeNull();
  });
});

describe('errors (AC-3.3)', () => {
  it('errorEvents: runtime + console errors with at/rel/message/frame/stack, chronological', () => {
    const ev = errorEvents(v4());
    expect(ev).toHaveLength(3);
    expect(ev.map((e) => e.at)).toEqual([DOC1 + 8.7, DOC1 + 9.5, DOC1 + 15.2]);
    expect(ev[0]).toMatchObject({ kind: 'runtime', message: 'Uncaught TypeError: x is undefined', frame: 'result.html:3:9', doc: 1, t: 8.7 });
    expect(ev[1]).toMatchObject({ frame: 'inner.html:1:1' });
    expect(ev[2]).toMatchObject({ kind: 'console', message: 'TypeError: x is undefined', frame: 'result.js:12:9' });
    expect(ev[2].stack).toContain('onSave');
    expect(ev[0].rel).toBeCloseTo((DOC1 + 8.7 - REC_START) / 1000, 9);
    expect(firstErrorAt(v4())).toBe(DOC1 + 8.7);
    expect(firstErrorAt({})).toBeNull();
  });

  it('errorGroups: console errors with args {truncated, preview} keep their preview as message, not one "" group (E4-FIX2)', () => {
    const s = { documents: [{ id: 0, timeOrigin: REC_START }], runtimeErrors: [], consoleLogs: [
      { t: 1, doc: 0, level: 'error', args: { truncated: true, preview: '["first long failure",' } },
      { t: 2, doc: 0, level: 'error', args: { truncated: true, preview: '["second long failure",' } },
    ] };
    const { groups } = errorGroups(s);
    expect(groups.map((g) => g.message)).toEqual(['["first long failure",', '["second long failure",']);
  });

  it('errorGroups: runtime + console errors grouped by message with count, ≤ 10 groups + more, first frame file:line:col for V8 and Firefox stacks', () => {
    const s = { recordingStartedAt: '2026-01-15T10:00:00.000Z', documents: [{ id: 0, timeOrigin: REC_START }], runtimeErrors: [], consoleLogs: [] };
    for (let i = 0; i < 12; i++) {
      s.runtimeErrors.push({ t: 1000 + i, doc: 0, type: 'error', message: `E${i}`, stack: `E${i}\n    at f (http://h/a${i}.js:${i + 1}:2)` });
    }
    // Same message again later, from the console, with a Firefox stack.
    s.consoleLogs.push({ t: 5000, doc: 0, level: 'error', args: ['"E0"'], stack: 'g@http://h/ff.js:9:3' });
    s.consoleLogs.push({ t: 6000, doc: 0, level: 'warn', args: ['"E0"'] });
    s.steps = [{ t: 500, doc: 0, type: 'click', selector: '#a', text: 'A' }, { t: 1005.5, doc: 0, type: 'click', selector: '#b' }];
    const { groups, more } = errorGroups(s);
    expect(groups).toHaveLength(10);
    expect(more).toBe(2);
    expect(groups[0]).toMatchObject({ message: 'E0', count: 2, frame: 'a0.js:1:2', firstRel: 1 });
    expect(groups[0].stack).toContain('a0.js');
    expect(groups[0].stepBefore).toMatchObject({ type: 'click', label: 'A' });
    expect(groups[6].stepBefore).toMatchObject({ label: '#b' });
    expect(groups.map((g) => g.message)).toEqual(['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9']);
    const ff = errorGroups({ consoleLogs: [{ t: 1, doc: 0, level: 'error', args: ['x'], stack: 'g@http://h/ff.js:9:3' }] });
    expect(ff.groups[0]).toMatchObject({ frame: 'ff.js:9:3', firstRel: null, stepBefore: null });
    expect(errorGroups(s, { limit: 3 })).toMatchObject({ more: 9 });

    const real = errorGroups(v4());
    expect(real.more).toBe(0);
    expect(real.groups.map((g) => [g.message, g.count, g.frame])).toEqual([
      ['Uncaught TypeError: x is undefined', 1, 'result.html:3:9'],
      ['Uncaught Error: frame failed', 1, 'inner.html:1:1'],
      ['TypeError: x is undefined', 1, 'result.js:12:9'],
    ]);
    expect(real.groups[0].stepBefore).toMatchObject({ type: 'navigate', url: 'http://127.0.0.1:8080/result.html' });
  });
});

describe('steps (AC-3.2)', () => {
  it('stepList: last 20 of 25, relative seconds, step before first error marked once (2 documents in v4.json)', () => {
    const real = stepList(v4());
    expect(real.total).toBe(10);
    expect(real.items).toHaveLength(10);
    expect(real.items[1]).toMatchObject({ type: 'click', label: 'Zacznij', at: DOC0 + 812.4 });
    expect(real.items[1].rel).toBeCloseTo((DOC0 + 812.4 - REC_START) / 1000, 9);
    expect(real.items[2].label).toBe('form > input:nth-of-type(1)');
    expect(real.items[8]).toMatchObject({ type: 'navigate', url: 'http://127.0.0.1:8080/result.html', at: DOC1 });
    const marked = real.items.filter((x) => x.beforeFirstError);
    expect(marked).toHaveLength(1);
    // The first error (doc 1, t 8.7) comes after doc 1's navigate (t 0) and before the click at 2050.
    expect(marked[0]).toBe(real.items[8]);

    const s = { recordingStartedAt: new Date(REC_START).toISOString(), documents: [{ id: 0, timeOrigin: REC_START }], steps: [] };
    for (let i = 0; i < 25; i++) s.steps.push({ t: i * 1000, doc: 0, type: 'click', selector: `#s${i}`, text: `S${i}` });
    s.runtimeErrors = [{ t: 21500, doc: 0, message: 'boom' }];
    const out = stepList(s);
    expect(out.total).toBe(25);
    expect(out.items).toHaveLength(20);
    expect(out.items[0].label).toBe('S5');
    expect(out.items[19].rel).toBe(24);
    expect(out.items.filter((x) => x.beforeFirstError).map((x) => x.label)).toEqual(['S21']);
    expect(stepList(s, { last: 3 }).items.map((x) => x.label)).toEqual(['S22', 'S23', 'S24']);
    // No error → nothing marked.
    delete s.runtimeErrors;
    expect(stepList(s).items.some((x) => x.beforeFirstError)).toBe(false);
  });
});

describe('network (AC-3.4, AC-4.4, AC-5.5)', () => {
  it('isFailedRequest and statusClass', () => {
    expect(isFailedRequest({ status: 404 })).toBe(true);
    expect(isFailedRequest({ status: 399, error: null })).toBe(false);
    expect(isFailedRequest({ status: null, error: 'net::ERR_FAILED' })).toBe(true);
    expect(isFailedRequest({ status: 200, error: '' })).toBe(true);
    expect(isFailedRequest({ status: null })).toBe(false);
    expect(isFailedRequest(null)).toBe(false);
    expect(statusClass({ status: 204 })).toBe('2xx');
    expect(statusClass({ status: 301 })).toBe('3xx');
    expect(statusClass({ status: 404 })).toBe('4xx');
    expect(statusClass({ status: 503, error: 'x' })).toBe('5xx');
    expect(statusClass({ status: 0, error: 'net::ERR_FAILED' })).toBe('error');
    expect(statusClass({ status: null, error: null })).toBe('unknown');
    expect(statusClass({ status: 101 })).toBe('unknown');
    expect(statusClass(undefined)).toBe('unknown');
  });

  it('failedRequests total equals overview.failedRequests on v4.json and on 200 generated packages (recount from budget.js)', () => {
    const s = v4();
    const res = failedRequests(s);
    expect(res.total).toBe(s.overview.failedRequests);
    expect(res.total).toBe(3);
    expect(res.more).toBe(0);
    expect(res.items.map((x) => [x.entry.method, x.entry.url, x.entry.status])).toEqual([
      ['GET', 'http://127.0.0.1:8080/img/missing.png', 404],
      ['POST', 'http://127.0.0.1:8080/api/fail', 500],
      ['GET', 'http://127.0.0.1:8080/missing.js', 404],
    ]);
    expect(res.items[1].index).toBe(2);

    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const statuses = [200, 204, 301, 399, 400, 404, 500, 503, null, 0, undefined, '500'];
    const errors = [null, null, null, undefined, 'net::ERR_FAILED', '', 'aborted'];
    for (let p = 0; p < 200; p++) {
      const network = [];
      const n = Math.floor(rand() * 60);
      for (let i = 0; i < n; i++) {
        const e = { t: i, doc: 0, type: 'fetch', method: 'GET', url: `http://h/${i}` };
        const st = statuses[Math.floor(rand() * statuses.length)];
        const er = errors[Math.floor(rand() * errors.length)];
        if (st !== undefined) e.status = st;
        if (er !== undefined) e.error = er;
        network.push(e);
      }
      const pkg = recount({ network, documents: [] });
      const got = failedRequests(pkg, { limit: 20 });
      expect(got.total).toBe(pkg.overview.failedRequests);
      expect(got.items.length).toBe(Math.min(20, got.total));
      expect(got.more).toBe(got.total - got.items.length);
    }
  });

  it('filterNetwork by status class, range, type, method, url fragment; 5000 entries ≤ 50 ms', () => {
    const list = v4().network;
    const idx = (r) => r.items.map((x) => x.index);
    expect(filterNetwork(list, {}).items).toHaveLength(5);
    expect(filterNetwork(list, {}).total).toBe(5);
    expect(idx(filterNetwork(list, { statusClass: '4xx' }))).toEqual([0, 3]);
    expect(idx(filterNetwork(list, { statusClass: 'unknown' }))).toEqual([1]);
    expect(idx(filterNetwork(list, { statusRange: [500, 599] }))).toEqual([2]);
    expect(idx(filterNetwork(list, { statusRange: { min: 400, max: 404 } }))).toEqual([0, 3]);
    expect(idx(filterNetwork(list, { failedOnly: true }))).toEqual([0, 2, 3]);
    expect(idx(filterNetwork(list, { type: 'img' }))).toEqual([0, 1]);
    expect(idx(filterNetwork(list, { method: 'post' }))).toEqual([2]);
    expect(idx(filterNetwork(list, { urlContains: 'MISSING' }))).toEqual([0, 3]);
    expect(idx(filterNetwork(list, { statusClass: '4xx', type: 'img', urlContains: 'missing' }))).toEqual([0]);
    expect(filterNetwork(list, { statusClass: '4xx', type: 'img' }).total).toBe(5);
    expect(filterNetwork(undefined, { failedOnly: true })).toEqual({ items: [], total: 0 });

    const big = [];
    for (let i = 0; i < 5000; i++) {
      big.push({ t: i, doc: 0, type: i % 3 ? 'fetch' : 'img', method: i % 2 ? 'GET' : 'POST', url: `https://example.com/api/item/${i}?q=${i % 7}`, status: [200, 404, 500, null][i % 4], error: i % 11 ? null : 'x' });
    }
    const opts = { statusClass: '4xx', type: 'img', method: 'GET', urlContains: 'Q=3' };
    const expected = big.filter((e, i) => statusClass(e) === '4xx' && e.type === 'img' && e.method === 'GET' && e.url.includes('q=3') && i >= 0).length;
    expect(filterNetwork(big, opts).items).toHaveLength(expected);
    filterNetwork(big, opts);
    expect(median(() => filterNetwork(big, opts))).toBeLessThanOrEqual(50);
    expect(median(() => filterNetwork(big, { failedOnly: true, statusRange: [400, 599] }))).toBeLessThanOrEqual(50);
  });
});

describe('timeline (AC-4.3)', () => {
  it('timeline on v4.json: chronological across 2 documents with a document boundary between them', () => {
    const items = timeline(v4());
    const ats = items.map((x) => x.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    const kinds = items.map((x) => x.kind);
    expect(kinds.filter((k) => k === 'document')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'step')).toHaveLength(10);
    expect(kinds.filter((k) => k === 'error')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'request')).toHaveLength(3);
    expect(items[0]).toMatchObject({ kind: 'document', doc: 0, url: 'http://127.0.0.1:8080/form.html', at: DOC0 });
    const boundary = items.findIndex((x) => x.kind === 'document' && x.doc === 1);
    expect(items[boundary]).toMatchObject({ url: 'http://127.0.0.1:8080/result.html', at: DOC1 });
    expect(items.slice(0, boundary).every((x) => x.doc === 0)).toBe(true);
    expect(items.slice(boundary).every((x) => x.doc === 1)).toBe(true);
    // The boundary comes before doc 1's navigate step at the same instant.
    expect(items[boundary + 1]).toMatchObject({ kind: 'step', type: 'navigate', doc: 1 });
    expect(items.find((x) => x.kind === 'request' && x.entry.status === 500).at).toBe(DOC1 + 12.5);
  });
});

describe('defensive reading', () => {
  it('missing fields never throw (empty object, v2 shape)', () => {
    for (const s of [{}, null, undefined, 'x', { documents: 'x', steps: {}, network: [null, 1], runtimeErrors: [null], consoleLogs: [null, { level: 'error' }] }]) {
      expect(() => {
        recordingStartMs(s);
        errorEvents(s);
        errorGroups(s);
        stepList(s);
        failedRequests(s);
        timeline(s);
        firstErrorAt(s);
        relSeconds(s, null);
        absTime(s, undefined);
      }).not.toThrow();
    }
    expect(stepList({})).toEqual({ items: [], total: 0 });
    expect(errorGroups({})).toEqual({ groups: [], more: 0 });
    expect(failedRequests({})).toEqual({ items: [], total: 0, more: 0 });
    expect(timeline({})).toEqual([]);

    const v2 = fixture('v2');
    expect(stepList(v2)).toEqual({ items: [], total: 0 });
    const g = errorGroups(v2);
    expect(g.groups.length).toBeGreaterThan(0);
    expect(g.groups.find((x) => x.message === 'save failed')).toMatchObject({ frame: 'result.js:12:9', count: 1 });
    expect(timeline(v2).filter((x) => x.kind === 'document')).toHaveLength(2);
    expect(failedRequests(v2).total).toBe(v2.network.filter(isFailedRequest).length);
    const v3 = fixture('v3');
    expect(stepList(v3).total).toBe(v3.steps.length);
  });
});
