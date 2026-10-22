import { describe, it, expect } from 'vitest';
import { originPatternFor, originOf, isSameOrigin } from '../../src/lib/origin.js';
import { createStore, KEYS, TEST_LIMIT_RANGE } from '../../src/lib/session-store.js';
import { createFakeChrome } from './helpers/fake-chrome.js';

describe('originPatternFor', () => {
  it.each([
    ['http://127.0.0.1:8080/a?b', 'http://127.0.0.1:8080', 'http://127.0.0.1/*'],
    ['https://example.com/', 'https://example.com', 'https://example.com/*'],
    ['https://example.com:443/x', 'https://example.com', 'https://example.com/*'],
    ['http://localhost:3000/#h', 'http://localhost:3000', 'http://localhost/*'],
    ['http://user:pw@example.com/', 'http://example.com', 'http://example.com/*'],
    ['http://[::1]:3000/', 'http://[::1]:3000', 'http://[::1]/*'],
    ['https://zażółć.pl/a', 'https://xn--za-6ja4f8n1l.pl', 'https://xn--za-6ja4f8n1l.pl/*'],
    ['file:///C:/a.html', 'file://', 'file:///*'],
    ['file:///home/u/a.html', 'file://', 'file:///*'],
  ])('%s → origin %s, pattern %s', (url, origin, pattern) => {
    expect(originPatternFor(url)).toEqual({ origin, pattern });
    expect(originOf(url)).toBe(origin);
  });

  it.each(['chrome://version', 'about:blank', 'chrome-extension://abc/popup.html', 'data:text/html,x', '', 'nope', undefined, null, 42])(
    '%s → null (AC-3.2)',
    (url) => {
      expect(originPatternFor(url)).toBeNull();
      expect(originOf(url)).toBeNull();
    },
  );

  it('pattern is exactly one <scheme>://<host>/* string (AC-3.2)', () => {
    const urls = ['http://127.0.0.1:8080/a?b', 'https://a.b.example.com/x/y', 'http://[::1]:3000/', 'file:///C:/a.html'];
    for (const url of urls) {
      const { pattern } = originPatternFor(url);
      expect(typeof pattern).toBe('string');
      expect(pattern).toMatch(/^(https?:\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)\/\*|file:\/\/\/\*)$/);
    }
  });

  it('rejects overlong input without parsing', () => {
    expect(originPatternFor(`https://example.com/${'a'.repeat(100_000)}`)).toBeNull();
  });
});

describe('isSameOrigin (exact, port counts)', () => {
  it.each([
    ['http://127.0.0.1:8080/x', 'http://127.0.0.1:8080', true],
    ['http://127.0.0.1:8081/x', 'http://127.0.0.1:8080', false],
    ['http://127.0.0.1/x', 'http://127.0.0.1:8080', false],
    ['https://example.com/x', 'http://example.com', false],
    ['https://example.com:443/x', 'https://example.com', true],
    ['https://sub.example.com/', 'https://example.com', false],
    ['file:///C:/b.html', 'file://', true],
    ['chrome://version', 'chrome://version', false],
    [undefined, 'http://a', false],
  ])('%s vs %s → %s', (url, origin, expected) => {
    expect(isSameOrigin(url, origin)).toBe(expected);
  });
});

const REC = {
  v: 1,
  requestId: 'r-1',
  tabId: 7,
  origin: 'http://127.0.0.1:8080',
  pattern: 'http://127.0.0.1/*',
  startedAt: 1_000,
  limitMs: 600_000,
  deadline: 601_000,
  status: 'recording',
  stopReason: null,
  docSeq: 0,
  docs: [],
  save: null,
  lastError: null,
};

describe('session store: recording state', () => {
  it('writes, reads and clears pds:rec in storage.session', async () => {
    const { chrome, fake } = createFakeChrome();
    const store = createStore(chrome.storage.session);
    expect(await store.getRec()).toBeNull();
    await store.updateRec(() => REC);
    expect(fake.sessionData.get(KEYS.rec)).toEqual(REC);
    expect(await store.getRec()).toEqual(REC);
    await store.clearRec();
    expect(fake.sessionData.has(KEYS.rec)).toBe(false);
    expect(await store.getRec()).toBeNull();
  });

  it('keeps tabId, requestId and deadline across an SW restart (fresh store instance)', async () => {
    const { chrome } = createFakeChrome();
    await createStore(chrome.storage.session).updateRec(() => REC);
    const fresh = createStore(chrome.storage.session);
    const rec = await fresh.getRec();
    expect(rec).toMatchObject({ tabId: 7, requestId: 'r-1', deadline: 601_000, status: 'recording' });
  });

  it('updateRec returning undefined leaves state untouched; null removes it', async () => {
    const { chrome, calls } = createFakeChrome();
    const store = createStore(chrome.storage.session);
    await store.updateRec(() => REC);
    const setsBefore = calls.filter((c) => c.name === 'storage.session.set').length;
    expect(await store.updateRec(() => undefined)).toEqual(REC);
    expect(calls.filter((c) => c.name === 'storage.session.set').length).toBe(setsBefore);
    expect(await store.updateRec(() => null)).toBeNull();
    expect(await store.getRec()).toBeNull();
  });

  it('updateRec serializes concurrent updates (no lost write)', async () => {
    const { chrome } = createFakeChrome();
    const store = createStore(chrome.storage.session);
    await store.updateRec(() => REC);
    const bump = (rec) => ({ ...rec, docSeq: rec.docSeq + 1 });
    await Promise.all(Array.from({ length: 10 }, () => store.updateRec(bump)));
    expect((await store.getRec()).docSeq).toBe(10);
  });

  it('updateRec with the same requestId applied concurrently creates state once (idempotent start)', async () => {
    const { chrome, calls } = createFakeChrome();
    const store = createStore(chrome.storage.session);
    let created = 0;
    const startOnce = (requestId) => (rec) => {
      if (rec?.requestId === requestId) return undefined;
      created += 1;
      return { ...REC, requestId };
    };
    await Promise.all([store.updateRec(startOnce('r-9')), store.updateRec(startOnce('r-9'))]);
    expect(created).toBe(1);
    expect(calls.filter((c) => c.name === 'storage.session.set')).toHaveLength(1);
    expect((await store.getRec()).requestId).toBe('r-9');
  });

  it('a failing update does not block the queue', async () => {
    const { chrome } = createFakeChrome();
    const store = createStore(chrome.storage.session);
    await expect(
      store.updateRec(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await store.updateRec(() => REC);
    expect(await store.getRec()).toEqual(REC);
  });

  it('async updater functions are awaited', async () => {
    const { chrome } = createFakeChrome();
    const store = createStore(chrome.storage.session);
    await store.updateRec(async () => REC);
    expect(await store.getRec()).toEqual(REC);
  });
});

describe('session store: pending, last saved, test limit', () => {
  it('pending round trip and clear', async () => {
    const { chrome, fake } = createFakeChrome();
    const store = createStore(chrome.storage.session);
    const pending = { requestId: 'r-2', tabId: 3, origin: 'https://a.pl', pattern: 'https://a.pl/*', at: 5 };
    await store.setPending(pending);
    expect(fake.sessionData.get(KEYS.pending)).toEqual(pending);
    expect(await createStore(chrome.storage.session).getPending()).toEqual(pending);
    await store.clearPending();
    expect(await store.getPending()).toBeNull();
  });

  it('last saved is kept per tabId', async () => {
    const { chrome, fake } = createFakeChrome();
    const store = createStore(chrome.storage.session);
    await store.setLast(3, { fileName: 'a.json', at: 1 });
    await store.setLast(4, { fileName: 'b.json', at: 2 });
    expect(fake.sessionData.has('pds:last:3')).toBe(true);
    expect(await store.getLast(3)).toEqual({ fileName: 'a.json', at: 1 });
    expect(await store.getLast(4)).toEqual({ fileName: 'b.json', at: 2 });
    expect(await store.getLast(5)).toBeNull();
    await store.clearLast(3);
    expect(await store.getLast(3)).toBeNull();
    expect(await store.getLast(4)).not.toBeNull();
  });

  it('getTestLimit is null without the key and clamps it to [1000, 600000]', async () => {
    const { chrome } = createFakeChrome();
    const store = createStore(chrome.storage.session);
    expect(TEST_LIMIT_RANGE).toEqual({ min: 1000, max: 600_000 });
    expect(await store.getTestLimit()).toBeNull();
    const cases = [
      [3000, 3000],
      [1, 1000],
      [0, 1000],
      [-5, 1000],
      [10_000_000, 600_000],
      [1500.7, 1500],
      ['3000', null],
      [Number.NaN, null],
      [null, null],
    ];
    for (const [raw, expected] of cases) {
      await chrome.storage.session.set({ [KEYS.testLimit]: raw });
      expect(await store.getTestLimit()).toBe(expected);
    }
  });
});

const entry = (t, chars = 50) => ({ t, level: 'log', args: ['x'.repeat(chars)] });
const docData = (n, { chars = 50, docId = 0 } = {}) => ({
  docId,
  url: 'http://127.0.0.1:8080/',
  timeOrigin: 1,
  consoleLogs: Array.from({ length: n }, (_, i) => entry(i, chars)),
  runtimeErrors: [],
  network: [],
  truncated: { consoleLogs: false, runtimeErrors: false, network: false },
  counts: { consoleLogs: n, runtimeErrors: 0, network: 0 },
});

describe('session store: documents', () => {
  it('putDoc / listDocs / clearDocs', async () => {
    const { chrome, fake } = createFakeChrome();
    const store = createStore(chrome.storage.session);
    expect(await store.putDoc(1, docData(2, { docId: 1 }))).toEqual({ stored: 'full' });
    await store.putDoc(0, docData(1));
    expect(fake.sessionData.has('pds:doc:1')).toBe(true);
    const docs = await store.listDocs();
    expect(docs.map((d) => d.id)).toEqual([0, 1]);
    expect(docs[1].data.consoleLogs).toHaveLength(2);
    await store.updateRec(() => REC);
    await store.clearDocs();
    expect(await store.listDocs()).toEqual([]);
    expect(await store.getRec()).toEqual(REC);
  });

  it('putDoc with the same id overwrites (bfcache re-flush)', async () => {
    const { chrome } = createFakeChrome();
    const store = createStore(chrome.storage.session);
    await store.putDoc(2, docData(1));
    await store.putDoc(2, docData(3));
    const docs = await store.listDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0].data.consoleLogs).toHaveLength(3);
  });

  it('putDoc over per-document budget keeps newest entries and marks truncated', async () => {
    const { chrome } = createFakeChrome();
    const store = createStore(chrome.storage.session, { docBudgetBytes: 2_000, totalBudgetBytes: 100_000 });
    const data = docData(100);
    data.runtimeErrors = [{ t: 99.5, type: 'error', message: 'late' }];
    data.counts.runtimeErrors = 1;
    expect(await store.putDoc(0, data)).toEqual({ stored: 'truncated' });
    const [{ data: saved }] = await store.listDocs();
    expect(JSON.stringify(saved).length).toBeLessThanOrEqual(2_000);
    const kept = saved.consoleLogs.map((e) => e.t);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(100);
    expect(kept.at(-1)).toBe(99);
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
    expect(saved.runtimeErrors).toHaveLength(1);
    expect(saved.truncated).toEqual({ consoleLogs: true, runtimeErrors: false, network: false });
    expect(saved.counts).toEqual({ consoleLogs: 100, runtimeErrors: 1, network: 0 });
  });

  it('putDoc over total budget drops oldest documents to counts only', async () => {
    const { chrome } = createFakeChrome();
    const store = createStore(chrome.storage.session, { docBudgetBytes: 5_000, totalBudgetBytes: 6_000 });
    await store.putDoc(0, docData(30, { docId: 0 }));
    await store.putDoc(1, docData(30, { docId: 1 }));
    await store.putDoc(2, docData(30, { docId: 2 }));
    const docs = await store.listDocs();
    expect(docs.map((d) => d.id)).toEqual([0, 1, 2]);
    expect(docs[0].data).toEqual({ counts: { consoleLogs: 30, runtimeErrors: 0, network: 0 }, dropped: true });
    expect(docs[1].data.consoleLogs).toHaveLength(30);
    expect(docs[2].data.consoleLogs).toHaveLength(30);
    const total = docs.reduce((sum, d) => sum + JSON.stringify(d.data).length, 0);
    expect(total).toBeLessThanOrEqual(6_000);
  });

  it('putDoc on quota error stores counts only', async () => {
    const { chrome, fake } = createFakeChrome();
    const store = createStore(chrome.storage.session);
    fake.failNextSet = new Error('Session storage quota bytes exceeded. Values were not stored.');
    expect(await store.putDoc(4, docData(5))).toEqual({ stored: 'dropped' });
    const [{ id, data }] = await store.listDocs();
    expect(id).toBe(4);
    expect(data).toEqual({ counts: { consoleLogs: 5, runtimeErrors: 0, network: 0 }, dropped: true });
  });

  it('putDoc against the real fake quota falls back to counts only', async () => {
    const { chrome } = createFakeChrome({ quotaBytes: 1_000 });
    const store = createStore(chrome.storage.session);
    expect(await store.putDoc(0, docData(50))).toEqual({ stored: 'dropped' });
    expect((await store.listDocs())[0].data.dropped).toBe(true);
  });

  it('putDoc derives counts from list lengths when the document has none', async () => {
    const { chrome, fake } = createFakeChrome();
    const store = createStore(chrome.storage.session);
    const data = docData(3);
    delete data.counts;
    fake.failNextSet = new Error('quota');
    await store.putDoc(0, data);
    expect((await store.listDocs())[0].data.counts).toEqual({ consoleLogs: 3, runtimeErrors: 0, network: 0 });
  });
});

describe('session store: privacy', () => {
  it('store never touches storage.local', async () => {
    const { chrome, calls } = createFakeChrome();
    expect(() => chrome.storage.local).toThrow();
    calls.length = 0;
    const store = createStore(chrome.storage.session);
    await store.updateRec(() => REC);
    await store.getRec();
    await store.putDoc(0, docData(2));
    await store.listDocs();
    await store.setPending({ requestId: 'x' });
    await store.setLast(1, { fileName: 'a', at: 1 });
    await store.getTestLimit();
    await store.clearDocs();
    await store.clearRec();
    expect(calls.some((c) => c.name.startsWith('storage.local'))).toBe(false);
    expect(calls.every((c) => c.name.startsWith('storage.session.'))).toBe(true);
  });
});

describe('fake-chrome', () => {
  it('logs calls and emits storage.session.onChanged', async () => {
    const { chrome, calls } = createFakeChrome({ tabs: [{ id: 1, url: 'https://a.pl/' }] });
    const changes = [];
    chrome.storage.session.onChanged.addListener((c) => changes.push(c));
    await chrome.storage.session.set({ k: 1 });
    await chrome.tabs.reload(1);
    expect(changes).toEqual([{ k: { oldValue: undefined, newValue: 1 } }]);
    expect(calls.map((c) => c.name)).toEqual(['storage.session.set', 'tabs.reload']);
  });

  it('scripting rejects duplicate and nonexistent ids like Chrome', async () => {
    const { chrome } = createFakeChrome();
    await chrome.scripting.registerContentScripts([{ id: 'a', matches: ['https://a.pl/*'], js: ['x.js'] }]);
    await expect(chrome.scripting.registerContentScripts([{ id: 'a' }])).rejects.toThrow(/Duplicate/);
    await expect(chrome.scripting.unregisterContentScripts({ ids: ['b'] })).rejects.toThrow(/Nonexistent/);
    expect(await chrome.scripting.getRegisteredContentScripts()).toHaveLength(1);
    await chrome.scripting.unregisterContentScripts();
    expect(await chrome.scripting.getRegisteredContentScripts()).toEqual([]);
  });

  it('permissions.request grants exact patterns and fires onAdded; download lifecycle', async () => {
    const { chrome, fake } = createFakeChrome();
    const added = [];
    chrome.permissions.onAdded.addListener((p) => added.push(p));
    expect(await chrome.permissions.contains({ origins: ['https://a.pl/*'] })).toBe(false);
    expect(await chrome.permissions.request({ origins: ['https://a.pl/*'] })).toBe(true);
    expect(await chrome.permissions.contains({ origins: ['https://a.pl/*'] })).toBe(true);
    expect(added).toEqual([{ origins: ['https://a.pl/*'], permissions: [] }]);

    const deltas = [];
    chrome.downloads.onChanged.addListener((d) => deltas.push(d));
    const id = await chrome.downloads.download({ url: 'blob:x', filename: 'f.json' });
    fake.completeDownload(id, 'C:\\Downloads\\f (1).json');
    expect(deltas[0].state.current).toBe('complete');
    expect((await chrome.downloads.search({ id }))[0].filename).toBe('C:\\Downloads\\f (1).json');
  });
});
