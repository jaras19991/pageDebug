import { describe, it, expect, beforeEach } from 'vitest';
import { createRecordingHandlers, resolveLimitMs, RECORDING_LIMIT_MS, PENDING_TTL_MS } from '../../src/lib/recording.js';
import { SCRIPT_IDS } from '../../src/lib/content-scripts.js';
import { createStore, KEYS } from '../../src/lib/session-store.js';
import { createFakeChrome } from './helpers/fake-chrome.js';

const TAB = 5;
const OTHER_TAB = 9;
const URL_A = 'http://127.0.0.1:8080/app?x=1';
const ORIGIN = 'http://127.0.0.1:8080';
const PATTERN = 'http://127.0.0.1/*';
const URL_B = 'https://example.com/b';

let env;
let clock;

function setup({ granted = [PATTERN, 'https://example.com/*'] } = {}) {
  const fc = createFakeChrome({
    tabs: [
      { id: TAB, url: URL_A },
      { id: OTHER_TAB, url: URL_B },
    ],
    granted,
  });
  clock = { t: 1_000_000 };
  const handlers = () => createRecordingHandlers({ chrome: fc.chrome, now: () => clock.t });
  return { ...fc, h: handlers(), fresh: handlers, store: createStore(fc.chrome.storage.session) };
}

const bridge = (tabId, url, extra = {}) => ({ tab: { id: tabId, url }, frameId: 0, url, id: 'pds-test-id', ...extra });
const named = (calls, name) => calls.filter((c) => c.name === name);
const rec = (e) => e.fake.sessionData.get(KEYS.rec);
const TOKEN = expect.stringMatching(/^[0-9a-f]{32}$/);
// The token the background gave a document in its `hello` answer (I2, F-2).
const tokenOf = (e, docId) => rec(e).docs.find((d) => d.id === docId)?.token;

async function startRecording(e, { requestId = 'r1', tabId = TAB, origin = ORIGIN, pattern = PATTERN } = {}) {
  await e.h.armStart({ requestId, tabId, origin, pattern });
  return e.h.start({ requestId });
}

beforeEach(() => {
  env = setup();
});

describe('start', () => {
  it('start registers both scripts, stores state, sets badge, then reloads tab exactly once (AC-1.3)', async () => {
    const res = await startRecording(env);
    expect(res).toEqual({ ok: true, startedAt: clock.t });

    const reg = named(env.calls, 'scripting.registerContentScripts');
    expect(reg).toHaveLength(1);
    const scripts = reg[0].args[0];
    expect(scripts.map((s) => [s.id, s.world, s.js[0], s.matches[0]]).sort()).toEqual(
      [
        [SCRIPT_IDS.bridge, 'ISOLATED', '/content/isolated-world.js', PATTERN],
        [SCRIPT_IDS.recorder, 'MAIN', '/content/main-world.js', PATTERN],
      ].sort(),
    );

    expect(rec(env)).toMatchObject({
      v: 1,
      requestId: 'r1',
      tabId: TAB,
      origin: ORIGIN,
      pattern: PATTERN,
      startedAt: clock.t,
      limitMs: RECORDING_LIMIT_MS,
      deadline: clock.t + RECORDING_LIMIT_MS,
      status: 'recording',
      stopReason: null,
      docSeq: 0,
      docs: [],
      save: null,
      lastError: null,
    });
    expect(env.fake.badges.get(TAB).text).toBe('●');
    expect(env.fake.sessionData.has(KEYS.pending)).toBe(false);

    const reloads = named(env.calls, 'tabs.reload');
    expect(reloads).toHaveLength(1);
    expect(reloads[0].args[0]).toBe(TAB);
    // Reload is the last step: scripts and state are in place before the new document starts.
    const names = env.calls.map((c) => c.name);
    expect(names.lastIndexOf('tabs.reload')).toBeGreaterThan(names.lastIndexOf('scripting.registerContentScripts'));
    expect(names.lastIndexOf('tabs.reload')).toBeGreaterThan(names.lastIndexOf('action.setBadgeText'));
  });

  it('start twice with same requestId reloads once (AC-1.3)', async () => {
    await env.h.armStart({ requestId: 'r1', tabId: TAB, origin: ORIGIN, pattern: PATTERN });
    const [a, b] = await Promise.all([env.h.start({ requestId: 'r1' }), env.h.start({ requestId: 'r1' })]);
    const c = await env.h.start({ requestId: 'r1' });
    expect(a.ok && b.ok && c.ok).toBe(true);
    expect(named(env.calls, 'tabs.reload')).toHaveLength(1);
    expect(named(env.calls, 'scripting.registerContentScripts')).toHaveLength(1);
  });

  it('onPermissionAdded with fresh pending starts recording', async () => {
    env = setup({ granted: [] });
    await env.h.armStart({ requestId: 'r1', tabId: TAB, origin: ORIGIN, pattern: PATTERN });
    env.fake.grantedOrigins.add(PATTERN);
    await env.h.onPermissionAdded({ origins: [PATTERN], permissions: [] });
    // The popup's own start arrives too: still one reload.
    await env.h.start({ requestId: 'r1' });
    expect(rec(env).status).toBe('recording');
    expect(named(env.calls, 'tabs.reload')).toHaveLength(1);
  });

  it('onPermissionAdded ignores stale pending and other origins', async () => {
    env = setup({ granted: [] });
    await env.h.armStart({ requestId: 'r1', tabId: TAB, origin: ORIGIN, pattern: PATTERN });
    env.fake.grantedOrigins.add(PATTERN);
    await env.h.onPermissionAdded({ origins: ['https://other.test/*'], permissions: [] });
    clock.t += PENDING_TTL_MS + 1;
    await env.h.onPermissionAdded({ origins: [PATTERN], permissions: [] });
    expect(rec(env)).toBeUndefined();
    expect(named(env.calls, 'tabs.reload')).toHaveLength(0);
  });

  it('start without granted permission returns permissionDenied and does not register or reload (AC-1.4)', async () => {
    env = setup({ granted: [] });
    const res = await startRecording(env);
    expect(res).toEqual({ ok: false, reason: 'permissionDenied' });
    expect(named(env.calls, 'scripting.registerContentScripts')).toHaveLength(0);
    expect(named(env.calls, 'tabs.reload')).toHaveLength(0);
    expect(rec(env)).toBeUndefined();
  });

  it('start without arming or with a mismatched tab URL fails without registering', async () => {
    expect(await env.h.start({ requestId: 'nope' })).toEqual({ ok: false, reason: 'recordFailed' });
    // Popup claims another origin than the tab actually shows.
    const res = await startRecording(env, { origin: 'http://127.0.0.1:9999', pattern: PATTERN });
    expect(res).toEqual({ ok: false, reason: 'recordFailed' });
    expect(named(env.calls, 'scripting.registerContentScripts')).toHaveLength(0);
  });

  it('registration error maps to restricted / recordFailed and leaves no state', async () => {
    env.fake.failNextRegister = new Error('Cannot access contents of url "http://127.0.0.1:8080/". Missing host permission');
    expect(await startRecording(env)).toEqual({ ok: false, reason: 'restricted' });
    env.fake.failNextRegister = new Error('boom');
    expect(await startRecording(env, { requestId: 'r2' })).toEqual({ ok: false, reason: 'recordFailed' });
    expect(rec(env)).toBeUndefined();
    expect(named(env.calls, 'tabs.reload')).toHaveLength(0);
  });

  it('start in another tab ends the previous recording without saving (D1)', async () => {
    await startRecording(env);
    const { token } = await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    await env.h.flush({ type: 'flush', docId: 1, token, data: { consoleLogs: [{ t: 1 }] } }, bridge(TAB, URL_A));
    const res = await startRecording(env, {
      requestId: 'r2',
      tabId: OTHER_TAB,
      origin: 'https://example.com',
      pattern: 'https://example.com/*',
    });
    expect(res.ok).toBe(true);
    expect(rec(env)).toMatchObject({ requestId: 'r2', tabId: OTHER_TAB, docSeq: 0, docs: [] });
    expect(await env.store.listDocs()).toEqual([]);
    const destroy = named(env.calls, 'tabs.sendMessage').find((c) => c.args[0] === TAB);
    expect(destroy.args.slice(1)).toEqual([{ type: 'destroy' }, { frameId: 0 }]);
    expect(env.fake.badges.get(TAB).text).toBe('');
    expect(env.fake.registered.get(SCRIPT_IDS.recorder).matches).toEqual(['https://example.com/*']);
  });

  it('disarm clears only the matching pending request', async () => {
    await env.h.armStart({ requestId: 'r1', tabId: TAB, origin: ORIGIN, pattern: PATTERN });
    await env.h.disarm({ requestId: 'other' });
    expect(env.fake.sessionData.has(KEYS.pending)).toBe(true);
    await env.h.disarm({ requestId: 'r1' });
    expect(env.fake.sessionData.has(KEYS.pending)).toBe(false);
  });
});

describe('hello (per-document gate, D1)', () => {
  it('hello from recording tab and exact origin → record:true with docId and deadline; badge set (AC-1.6)', async () => {
    await startRecording(env);
    await env.fake.badges.delete(TAB);
    const first = await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    expect(first).toEqual({ record: true, docId: 1, token: TOKEN, deadline: clock.t + RECORDING_LIMIT_MS, limitMs: RECORDING_LIMIT_MS });
    expect(env.fake.badges.get(TAB).text).toBe('●');
    const second = await env.h.hello({ type: 'hello' }, bridge(TAB, `${ORIGIN}/next`));
    expect(second.docId).toBe(2);
    expect(second.token).not.toBe(first.token);
    expect(rec(env).docs).toEqual([
      { id: 1, url: URL_A, flushed: false, token: first.token },
      { id: 2, url: `${ORIGIN}/next`, flushed: false, token: second.token },
    ]);
  });

  it('Firefox: works without sender.origin, from sender.url', async () => {
    await startRecording(env);
    const sender = bridge(TAB, URL_A);
    delete sender.origin;
    expect((await env.h.hello({ type: 'hello' }, sender)).record).toBe(true);
  });

  it('hello from another tab → record:false (AC-3.3)', async () => {
    await startRecording(env);
    expect(await env.h.hello({ type: 'hello' }, bridge(OTHER_TAB, URL_A))).toEqual({ record: false });
  });

  it.each(['http://127.0.0.1:8081/app', 'http://127.0.0.1/app', 'https://127.0.0.1:8080/app', URL_B])(
    'hello from another origin or port %s → record:false (AC-3.4)',
    async (url) => {
      await startRecording(env);
      expect(await env.h.hello({ type: 'hello' }, bridge(TAB, url))).toEqual({ record: false });
    },
  );

  it('hello without a recording → record:false', async () => {
    expect(await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A))).toEqual({ record: false });
  });

  it('hello at or after the deadline → record:false', async () => {
    await startRecording(env);
    clock.t += RECORDING_LIMIT_MS;
    const res = await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    expect(res.record).toBe(false);
  });

  it('bridge messages accepted only from sender.tab with frameId 0 (D2)', async () => {
    await startRecording(env);
    expect(await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A, { frameId: 3 }))).toEqual({ record: false });
    expect(await env.h.hello({ type: 'hello' }, { url: URL_A, id: 'pds-test-id', frameId: 0 })).toEqual({ record: false });
    expect(await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A, { id: 'evil' }))).toEqual({ record: false });
    const flushed = await env.h.flush({ type: 'flush', docId: 1, data: {} }, bridge(TAB, URL_A, { frameId: 2 }));
    expect(flushed.ok).toBe(false);
    expect(rec(env).docSeq).toBe(0);
  });
});

describe('flush (D4)', () => {
  it('flush stores document via store.putDoc and marks flushed (AC-4.4)', async () => {
    await startRecording(env);
    const { docId, token } = await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    const data = { consoleLogs: [{ t: 3, level: 'error' }], runtimeErrors: [], network: [], truncated: {} };
    const res = await env.h.flush({ type: 'flush', docId, token, data }, bridge(TAB, URL_A));
    expect(res).toEqual({ ok: true, stored: 'full' });
    expect(await env.store.listDocs()).toEqual([{ id: docId, data }]);
    expect(rec(env).docs[0]).toMatchObject({ id: docId, flushed: true });
  });

  it('flush for an unknown document, another tab or without a recording is ignored', async () => {
    expect((await env.h.flush({ type: 'flush', docId: 1, data: {} }, bridge(TAB, URL_A))).ok).toBe(false);
    await startRecording(env);
    const { token } = await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    expect((await env.h.flush({ type: 'flush', docId: 99, token, data: {} }, bridge(TAB, URL_A))).ok).toBe(false);
    expect((await env.h.flush({ type: 'flush', docId: 1, token, data: {} }, bridge(OTHER_TAB, URL_A))).ok).toBe(false);
    expect((await env.h.flush({ type: 'flush', docId: 1, token, data: 'x' }, bridge(TAB, URL_A))).ok).toBe(false);
    expect(await env.store.listDocs()).toEqual([]);
  });

  // F-2: Chrome delivers the pagehide flush of a document left for another site from a frame that is
  // pending deletion (frameId ≠ 0, sender.tab.url already the new site); the token proves the sender.
  it('flush with the document token is accepted from another frameId and while the tab shows another origin', async () => {
    await startRecording(env);
    const { docId, token } = await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    const leaving = bridge(TAB, URL_A, { frameId: 5, tab: { id: TAB, url: 'http://localhost:8080/sso' }, documentLifecycle: 'pending_deletion' });
    const res = await env.h.flush({ type: 'flush', docId, token, data: { consoleLogs: [{ t: 1 }] } }, leaving);
    expect(res).toEqual({ ok: true, stored: 'full' });
    expect(await env.store.listDocs()).toEqual([{ id: docId, data: { consoleLogs: [{ t: 1 }] } }]);
    expect(rec(env).docs[0]).toMatchObject({ id: docId, flushed: true });
    // A browser that reports the new address in sender.url: the token still decides.
    const moved = bridge(TAB, 'http://localhost:8080/sso');
    expect((await env.h.flush({ type: 'flush', docId, token, data: { consoleLogs: [] } }, moved)).ok).toBe(true);
  });

  it('flush without the token, with a wrong one or with the token of another document is rejected', async () => {
    await startRecording(env);
    const first = await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    const second = await env.h.hello({ type: 'hello' }, bridge(TAB, `${ORIGIN}/next`));
    for (const token of [undefined, null, '', 'x'.repeat(32), second.token, { toString: () => first.token }]) {
      expect((await env.h.flush({ type: 'flush', docId: first.docId, token, data: {} }, bridge(TAB, URL_A))).ok).toBe(false);
    }
    expect((await env.h.flush({ type: 'flush', docId: second.docId, token: first.token, data: {} }, bridge(TAB, URL_A))).ok).toBe(false);
    expect(await env.store.listDocs()).toEqual([]);
    expect(rec(env).docs.map((d) => d.flushed)).toEqual([false, false]);
  });

  it('a repeated flush of the same document (incremental) overwrites its copy', async () => {
    await startRecording(env);
    const { docId, token } = await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    await env.h.flush({ type: 'flush', docId, token, data: { consoleLogs: [{ t: 1 }] } }, bridge(TAB, URL_A));
    await env.h.flush({ type: 'flush', docId, token, data: { consoleLogs: [{ t: 1 }, { t: 2 }] } }, bridge(TAB, URL_A));
    expect(await env.store.listDocs()).toEqual([{ id: docId, data: { consoleLogs: [{ t: 1 }, { t: 2 }] } }]);
    expect(tokenOf(env, docId)).toBe(token);
  });

  it('a token from an earlier recording is not valid in the next one', async () => {
    await startRecording(env);
    const old = await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    await startRecording(env, { requestId: 'r2' });
    await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    expect((await env.h.flush({ type: 'flush', docId: old.docId, token: old.token, data: {} }, bridge(TAB, URL_A))).ok).toBe(false);
  });

  it('bridgeError marks the document as not recorded', async () => {
    await startRecording(env);
    const { docId } = await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    await env.h.bridgeError({ type: 'bridgeError', docId, reason: 'unbound' }, bridge(TAB, URL_A));
    expect(rec(env).docs[0]).toMatchObject({ id: docId, bridgeError: 'unbound' });
  });
});

describe('getStatus', () => {
  it('reports idle, then recording for the tab and otherTabRecording elsewhere', async () => {
    expect(await env.h.getStatus({ tabId: TAB, url: URL_A })).toMatchObject({ state: 'idle', isRecordingTab: false });
    await startRecording(env);
    expect(await env.h.getStatus({ tabId: TAB, url: URL_A })).toEqual({
      state: 'recording',
      startedAt: clock.t,
      stopReason: null,
      isRecordingTab: true,
      otherTabRecording: false,
      otherOrigin: false,
      lastSaved: null,
      lastError: null,
    });
    expect(await env.h.getStatus({ tabId: OTHER_TAB, url: URL_B })).toMatchObject({
      state: 'idle',
      isRecordingTab: false,
      otherTabRecording: true,
    });
  });

  it('getStatus marks otherOrigin when tab url origin differs (AC-3.4)', async () => {
    await startRecording(env);
    expect((await env.h.getStatus({ tabId: TAB, url: 'http://127.0.0.1:8081/' })).otherOrigin).toBe(true);
    expect((await env.h.getStatus({ tabId: TAB, url: `${ORIGIN}/other` })).otherOrigin).toBe(false);
    expect((await env.h.getStatus({ tabId: TAB })).otherOrigin).toBe(false);
  });

  it('stale pending without permission is reported once as permissionDenied by getStatus (AC-1.4)', async () => {
    env = setup({ granted: [] });
    await env.h.armStart({ requestId: 'r1', tabId: TAB, origin: ORIGIN, pattern: PATTERN });
    expect((await env.h.getStatus({ tabId: TAB, url: URL_A })).lastError).toBe('permissionDenied');
    expect((await env.h.getStatus({ tabId: TAB, url: URL_A })).lastError).toBe(null);
  });

  it('pending of the asking popup (ownRequestId) is not judged while consent is still open', async () => {
    env = setup({ granted: [] });
    await env.h.armStart({ requestId: 'r1', tabId: TAB, origin: ORIGIN, pattern: PATTERN });
    const status = await env.h.getStatus({ tabId: TAB, url: URL_A, ownRequestId: 'r1' });
    expect(status.lastError).toBe(null);
    expect(status.state).toBe('starting');
    expect(env.fake.sessionData.has(KEYS.pending)).toBe(true);
    env.fake.grantedOrigins.add(PATTERN);
    expect((await env.h.start({ requestId: 'r1' })).ok).toBe(true);
  });

  it('lastError is one-shot and lastSaved comes from the store', async () => {
    await startRecording(env);
    await env.store.updateRec((r) => ({ ...r, lastError: 'saveCancelled' }));
    await env.store.setLast(TAB, { fileName: 'page-debug-snapshot-1.json', at: 1 });
    const first = await env.h.getStatus({ tabId: TAB, url: URL_A });
    expect(first.lastError).toBe('saveCancelled');
    expect(first.lastSaved).toEqual({ fileName: 'page-debug-snapshot-1.json', at: 1 });
    expect((await env.h.getStatus({ tabId: TAB, url: URL_A })).lastError).toBe(null);
  });

  it('fresh handler instance reads the same status after restart (no module state) (AC-1.5)', async () => {
    await startRecording(env);
    const before = await env.h.getStatus({ tabId: TAB, url: URL_A });
    const restarted = env.fresh();
    expect(await restarted.getStatus({ tabId: TAB, url: URL_A })).toEqual(before);
    const hello = await restarted.hello({ type: 'hello' }, bridge(TAB, URL_A));
    expect(hello).toMatchObject({ record: true, docId: 1 });
    expect(await restarted.start({ requestId: 'r1' })).toEqual({ ok: true, startedAt: before.startedAt });
    expect(named(env.calls, 'tabs.reload')).toHaveLength(1);
  });
});

describe('cleanup', () => {
  it('onTabRemoved for recording tab unregisters and clears state; other tab ignored (AC-2.6)', async () => {
    await startRecording(env);
    const { token } = await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    await env.h.flush({ type: 'flush', docId: 1, token, data: { consoleLogs: [] } }, bridge(TAB, URL_A));
    expect(await env.store.listDocs()).toHaveLength(1);

    await env.h.onTabRemoved(OTHER_TAB);
    expect(rec(env)).toBeDefined();
    expect(env.fake.registered.size).toBe(2);

    await env.h.onTabRemoved(TAB);
    expect(rec(env)).toBeUndefined();
    expect(env.fake.registered.size).toBe(0);
    expect(await env.store.listDocs()).toEqual([]);
  });

  it.each(['onStartup', 'onInstalled'])('%s unregisters scripts and clears state (AC-2.6)', async (name) => {
    await startRecording(env);
    await env.h.armStart({ requestId: 'r9', tabId: TAB, origin: ORIGIN, pattern: PATTERN });
    await env.h.flush({ type: 'flush', docId: 1, data: {} }, bridge(TAB, URL_A));
    await env.h[name]();
    expect(env.fake.registered.size).toBe(0);
    expect(rec(env)).toBeUndefined();
    expect(env.fake.sessionData.has(KEYS.pending)).toBe(false);
    expect(await env.store.listDocs()).toEqual([]);
  });
});

describe('starting state (protocol popup ↔ background, T12)', () => {
  it('armed request with permission → starting for its tab, idle elsewhere; recording after start', async () => {
    await env.h.armStart({ requestId: 'r1', tabId: TAB, origin: ORIGIN, pattern: PATTERN });
    expect(await env.h.getStatus({ tabId: TAB, url: URL_A })).toMatchObject({ state: 'starting', isRecordingTab: false, lastError: null });
    expect((await env.h.getStatus({ tabId: OTHER_TAB, url: URL_B })).state).toBe('idle');
    await env.h.start({ requestId: 'r1' });
    expect((await env.h.getStatus({ tabId: TAB, url: URL_A })).state).toBe('recording');
  });

  it('armed request without permission and not owned → idle with permissionDenied, never starting', async () => {
    env = setup({ granted: [] });
    await env.h.armStart({ requestId: 'r1', tabId: TAB, origin: ORIGIN, pattern: PATTERN });
    expect(await env.h.getStatus({ tabId: TAB, url: URL_A })).toMatchObject({ state: 'idle', lastError: 'permissionDenied' });
  });

  it('getStatus runs the save expiry hook first (abandoned save after an SW restart)', async () => {
    const order = [];
    const h = createRecordingHandlers({
      chrome: env.chrome,
      now: () => clock.t,
      expireSave: async () => {
        order.push('expireSave');
        throw new Error('boom');
      },
    });
    expect((await h.getStatus({ tabId: TAB, url: URL_A })).state).toBe('idle');
    expect(order).toEqual(['expireSave']);
  });
});

describe('time limit (D10, AC-1.9)', () => {
  it('resolveLimitMs clamps above 10 min and ignores non-numbers (AC-1.9)', () => {
    expect(resolveLimitMs(null)).toBe(RECORDING_LIMIT_MS);
    expect(resolveLimitMs(undefined)).toBe(RECORDING_LIMIT_MS);
    expect(resolveLimitMs('3000')).toBe(RECORDING_LIMIT_MS);
    expect(resolveLimitMs(NaN)).toBe(RECORDING_LIMIT_MS);
    expect(resolveLimitMs(Infinity)).toBe(RECORDING_LIMIT_MS);
    expect(resolveLimitMs(3_600_000)).toBe(RECORDING_LIMIT_MS);
    expect(resolveLimitMs(3000)).toBe(3000);
    expect(resolveLimitMs(2500.9)).toBe(2500);
    expect(resolveLimitMs(10)).toBe(1000);
  });

  it('start takes limitMs from pds:test:recordingLimitMs (set by the harness through the SW)', async () => {
    env.fake.sessionData.set(KEYS.testLimit, 3000);
    await startRecording(env);
    expect(rec(env)).toMatchObject({ limitMs: 3000, deadline: clock.t + 3000 });
    const hello = await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    expect(hello).toEqual({ record: true, docId: 1, token: TOKEN, deadline: clock.t + 3000, limitMs: 3000 });
  });

  it('getStatus after deadline returns stopped/time-limit and unregisters scripts once (AC-1.9)', async () => {
    env.fake.sessionData.set(KEYS.testLimit, 3000);
    await startRecording(env);
    clock.t += 2999;
    expect((await env.h.getStatus({ tabId: TAB, url: URL_A })).state).toBe('recording');
    expect(env.fake.registered.size).toBe(2);

    clock.t += 1;
    const status = await env.h.getStatus({ tabId: TAB, url: URL_A });
    expect(status).toMatchObject({ state: 'stopped', stopReason: 'time-limit', isRecordingTab: true });
    expect(rec(env)).toMatchObject({ status: 'stopped', stopReason: 'time-limit' });
    expect(env.fake.registered.size).toBe(0);
    expect(env.fake.badges.get(TAB).text).toBe('■');

    const unregisters = named(env.calls, 'scripting.unregisterContentScripts').length;
    await env.h.getStatus({ tabId: TAB, url: URL_A });
    await env.h.getStatus({ tabId: OTHER_TAB, url: URL_B });
    expect(named(env.calls, 'scripting.unregisterContentScripts')).toHaveLength(unregisters);
    expect(named(env.calls, 'scripting.getRegisteredContentScripts').length).toBeGreaterThan(0);
  });

  it('stopped message from bridge sets stopped and badge (AC-1.9)', async () => {
    await startRecording(env);
    await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    // Not from our bridge, or not the time limit: ignored.
    expect((await env.h.stopped({ type: 'stopped', reason: 'time-limit' }, bridge(TAB, URL_A, { frameId: 1 }))).ok).toBe(false);
    expect((await env.h.stopped({ type: 'stopped', reason: 'user' }, bridge(TAB, URL_A))).ok).toBe(false);
    await env.h.stopped({ type: 'stopped', reason: 'time-limit' }, bridge(OTHER_TAB, URL_A));
    expect(rec(env).status).toBe('recording');

    expect(await env.h.stopped({ type: 'stopped', reason: 'time-limit' }, bridge(TAB, URL_A))).toEqual({ ok: true });
    expect(rec(env)).toMatchObject({ status: 'stopped', stopReason: 'time-limit' });
    expect(env.fake.badges.get(TAB).text).toBe('■');
    expect(env.fake.registered.size).toBe(0);
    expect((await env.h.getStatus({ tabId: TAB, url: URL_A })).state).toBe('stopped');
  });

  it('hello after deadline returns record:false, stops the recording and keeps the document (AC-1.9)', async () => {
    await startRecording(env);
    await env.h.hello({ type: 'hello' }, bridge(TAB, URL_A));
    clock.t += RECORDING_LIMIT_MS + 5;
    const res = await env.h.hello({ type: 'hello' }, bridge(TAB, `${ORIGIN}/after`));
    expect(res).toMatchObject({ record: false, docId: 2 });
    expect(rec(env)).toMatchObject({ status: 'stopped', stopReason: 'time-limit' });
    expect(rec(env).docs[1]).toMatchObject({ id: 2, recorded: false });
    expect(env.fake.registered.size).toBe(0);
    expect(env.fake.badges.get(TAB).text).toBe('■');
  });
});
