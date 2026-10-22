/* global chrome */
// E1-T0 spike background: service worker in Chrome, module event page in Firefox (D2).
// All listeners are registered at top level; state lives only in storage.session.
const bootId = crypto.randomUUID();
const bootAt = Date.now();
const IDS = ['spike-main', 'spike-iso'];

async function unregister() {
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const ids = existing.map((s) => s.id).filter((id) => IDS.includes(id));
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  return ids;
}

async function register({ pattern, order = 'main-first', slash = true, tabId = null }) {
  await unregister();
  const p = slash ? '/' : '';
  const common = { matches: [pattern], runAt: 'document_start', allFrames: false, persistAcrossSessions: false };
  const main = { id: 'spike-main', js: [`${p}main.js`], world: 'MAIN', ...common };
  const iso = { id: 'spike-iso', js: [`${p}iso.js`], world: 'ISOLATED', ...common };
  await chrome.scripting.registerContentScripts(order === 'main-first' ? [main, iso] : [iso, main]);
  if (tabId !== null) await chrome.tabs.reload(tabId);
  const registered = await chrome.scripting.getRegisteredContentScripts();
  return registered.map((s) => ({ id: s.id, js: s.js, world: s.world }));
}

async function handle(msg, sender) {
  switch (msg?.type) {
    case 'ping':
      return { bootId, bootAt, id: chrome.runtime.id, senderUrl: sender.url ?? null };
    case 'register':
      return register(msg);
    case 'unregister':
      return unregister();
    case 'isoReport': {
      const { isoReports = [] } = await chrome.storage.session.get('isoReports');
      isoReports.push({ tabId: sender.tab?.id ?? null, frameId: sender.frameId, url: sender.url, bound: msg.bound });
      await chrome.storage.session.set({ isoReports: isoReports.slice(-50) });
      return { ok: true };
    }
    case 'isoReportCount': {
      const { isoReports = [] } = await chrome.storage.session.get('isoReports');
      return { count: isoReports.length, last: isoReports.at(-1) ?? null };
    }
    case 'saveStarted':
      await chrome.storage.session.set({ save: { downloadId: msg.downloadId, at: Date.now() } });
      return { ok: true };
    default:
      return { error: 'unknown' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ error: String(e?.message ?? e) }));
  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state) return;
  const key = `dl:${delta.id}`;
  const record = { state: delta.state.current, error: delta.error?.current ?? null, at: Date.now(), bootId };
  const done =
    delta.state.current === 'complete'
      ? chrome.downloads.search({ id: delta.id }).then(([item]) => {
          record.filename = item?.filename ?? null;
          record.basename = item?.filename?.split(/[\\/]/).pop() ?? null;
        })
      : Promise.resolve();
  done.then(() => chrome.storage.session.set({ [key]: record }));
});

// Handles for serviceWorker.evaluate() in the Chromium runner.
globalThis.spike = { bootId, bootAt, register, unregister };
