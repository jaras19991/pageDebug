// In-memory stand-in for the subset of chrome.* used by the background (design E1-T1a).
// Every API call is appended to `calls` as { name: 'tabs.reload', args: [...] }.
// Test-only knobs live on `fake`, never on the `chrome` object itself.

const NO_RECEIVER = 'Could not establish connection. Receiving end does not exist.';
const QUOTA_MESSAGE = 'Session storage quota bytes exceeded. Values were not stored.';

// Mirrors the JSON serialization the real storage applies (undefined dropped, no shared refs).
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

export function createEvent() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    hasListener: (fn) => listeners.has(fn),
    hasListeners: () => listeners.size > 0,
    /** Test helper: calls every listener, returns their results. */
    dispatch: (...args) => [...listeners].map((fn) => fn(...args)),
  };
}

/**
 * @param {{ quotaBytes?: number, tabs?: Array<{id:number,url:string}>, granted?: string[],
 *           version?: string, extensionId?: string }} [options]
 */
export function createFakeChrome({
  quotaBytes = Infinity,
  tabs = [],
  granted = [],
  version = '0.3.0',
  extensionId = 'pds-test-id',
} = {}) {
  const calls = [];
  const log = (name, args) => calls.push({ name, args: clone(args) });

  const sessionData = new Map();
  const tabMap = new Map(tabs.map((t) => [t.id, { ...t }]));
  const registered = new Map();
  const badges = new Map();
  const grantedOrigins = new Set(granted);
  const downloadItems = new Map();
  let nextDownloadId = 1;

  const fake = {
    /** Next storage.session.set rejects with this error (once). */
    failNextSet: null,
    /** Next scripting.registerContentScripts rejects with this error (once). */
    failNextRegister: null,
    /** Answer of permissions.request; true also grants and fires onAdded. */
    permissionAnswer: true,
    /** Handler for tabs.sendMessage(tabId, message, options); default: no receiver. */
    sendMessage: async () => {
      throw new Error(NO_RECEIVER);
    },
    /** Handler for runtime.sendMessage(message) (popup → background); default: no receiver. */
    runtimeSendMessage: async () => {
      throw new Error(NO_RECEIVER);
    },
    /** Tab returned by tabs.query({ active: true }); default: the first tab. */
    activeTabId: tabs[0]?.id ?? null,
    sessionData,
    registered,
    badges,
    grantedOrigins,
    downloadItems,
    setTab: (tab) => tabMap.set(tab.id, { ...tab }),
    removeTab: (tabId) => {
      tabMap.delete(tabId);
      chrome.tabs.onRemoved.dispatch(tabId, { windowId: 1, isWindowClosing: false });
    },
    /** Finishes a download and fires onChanged like the browser does. */
    completeDownload: (id, filename) => {
      const item = downloadItems.get(id);
      item.state = 'complete';
      if (filename) item.filename = filename;
      chrome.downloads.onChanged.dispatch({ id, state: { previous: 'in_progress', current: 'complete' } });
    },
    interruptDownload: (id, error = 'USER_CANCELED') => {
      const item = downloadItems.get(id);
      item.state = 'interrupted';
      item.error = error;
      chrome.downloads.onChanged.dispatch({
        id,
        state: { previous: 'in_progress', current: 'interrupted' },
        error: { current: error },
      });
    },
  };

  const sessionBytes = (data) => {
    let total = 0;
    for (const [k, v] of data) total += k.length + JSON.stringify(v).length;
    return total;
  };

  const pickKeys = (keys) => {
    if (keys === null || keys === undefined) return [...sessionData.keys()];
    if (typeof keys === 'string') return [keys];
    if (Array.isArray(keys)) return keys;
    return Object.keys(keys);
  };

  const session = {
    onChanged: createEvent(),
    async get(keys) {
      log('storage.session.get', [keys]);
      await Promise.resolve();
      const out = {};
      if (keys && typeof keys === 'object' && !Array.isArray(keys)) Object.assign(out, clone(keys));
      for (const k of pickKeys(keys)) if (sessionData.has(k)) out[k] = clone(sessionData.get(k));
      return out;
    },
    async set(items) {
      log('storage.session.set', [items]);
      await Promise.resolve();
      if (fake.failNextSet) {
        const err = fake.failNextSet;
        fake.failNextSet = null;
        throw err;
      }
      const next = new Map(sessionData);
      for (const [k, v] of Object.entries(items)) if (v !== undefined) next.set(k, clone(v));
      if (sessionBytes(next) > quotaBytes) throw new Error(QUOTA_MESSAGE);
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        if (v === undefined) continue;
        changes[k] = { oldValue: clone(sessionData.get(k)), newValue: clone(v) };
        sessionData.set(k, clone(v));
      }
      session.onChanged.dispatch(changes);
    },
    async remove(keys) {
      log('storage.session.remove', [keys]);
      await Promise.resolve();
      const changes = {};
      for (const k of typeof keys === 'string' ? [keys] : keys) {
        if (!sessionData.has(k)) continue;
        changes[k] = { oldValue: sessionData.get(k) };
        sessionData.delete(k);
      }
      if (Object.keys(changes).length) session.onChanged.dispatch(changes);
    },
    async clear() {
      log('storage.session.clear', []);
      await Promise.resolve();
      const changes = {};
      for (const [k, v] of sessionData) changes[k] = { oldValue: v };
      sessionData.clear();
      if (Object.keys(changes).length) session.onChanged.dispatch(changes);
    },
  };

  const storage = { session };
  // Background state must never reach persistent storage (NFR privacy): touching it fails loudly.
  Object.defineProperty(storage, 'local', {
    enumerable: false,
    get() {
      log('storage.local', []);
      throw new Error('fake-chrome: storage.local must not be used');
    },
  });

  const chrome = {
    storage,
    scripting: {
      async registerContentScripts(scripts) {
        log('scripting.registerContentScripts', [scripts]);
        if (fake.failNextRegister) {
          const err = fake.failNextRegister;
          fake.failNextRegister = null;
          throw err;
        }
        for (const s of scripts) {
          if (registered.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
        }
        for (const s of scripts) registered.set(s.id, clone(s));
      },
      async unregisterContentScripts(filter) {
        log('scripting.unregisterContentScripts', [filter]);
        const ids = filter?.ids ?? [...registered.keys()];
        for (const id of ids) {
          if (!registered.has(id)) throw new Error(`Nonexistent script ID '${id}'`);
        }
        for (const id of ids) registered.delete(id);
      },
      async getRegisteredContentScripts(filter) {
        log('scripting.getRegisteredContentScripts', [filter]);
        const ids = filter?.ids;
        return [...registered.values()].filter((s) => !ids || ids.includes(s.id)).map(clone);
      },
    },
    tabs: {
      onRemoved: createEvent(),
      async reload(tabId, props) {
        log('tabs.reload', [tabId, props]);
        if (!tabMap.has(tabId)) throw new Error(`No tab with id: ${tabId}.`);
      },
      async get(tabId) {
        log('tabs.get', [tabId]);
        if (!tabMap.has(tabId)) throw new Error(`No tab with id: ${tabId}.`);
        return { ...tabMap.get(tabId) };
      },
      async sendMessage(tabId, message, options) {
        log('tabs.sendMessage', [tabId, message, options]);
        return fake.sendMessage(tabId, message, options);
      },
      async query(queryInfo) {
        log('tabs.query', [queryInfo]);
        const all = [...tabMap.values()];
        const picked = queryInfo?.active ? all.filter((t) => t.id === fake.activeTabId) : all;
        return picked.map((t) => ({ ...t }));
      },
    },
    action: {
      async setBadgeText({ tabId, text }) {
        log('action.setBadgeText', [{ tabId, text }]);
        badges.set(tabId, { ...badges.get(tabId), text });
      },
      async setBadgeBackgroundColor({ tabId, color }) {
        log('action.setBadgeBackgroundColor', [{ tabId, color }]);
        badges.set(tabId, { ...badges.get(tabId), color });
      },
      async getBadgeText({ tabId }) {
        log('action.getBadgeText', [{ tabId }]);
        return badges.get(tabId)?.text ?? '';
      },
    },
    permissions: {
      onAdded: createEvent(),
      onRemoved: createEvent(),
      async request(perms) {
        log('permissions.request', [perms]);
        if (!fake.permissionAnswer) return false;
        const added = (perms.origins ?? []).filter((o) => !grantedOrigins.has(o));
        for (const o of added) grantedOrigins.add(o);
        if (added.length) chrome.permissions.onAdded.dispatch({ origins: added, permissions: [] });
        return true;
      },
      async contains(perms) {
        log('permissions.contains', [perms]);
        return (perms.origins ?? []).every((o) => grantedOrigins.has(o));
      },
    },
    downloads: {
      onChanged: createEvent(),
      async download(options) {
        log('downloads.download', [options]);
        const id = nextDownloadId++;
        downloadItems.set(id, { id, filename: options.filename, state: 'in_progress', url: options.url });
        return id;
      },
      async search(query) {
        log('downloads.search', [query]);
        return [...downloadItems.values()].filter((d) => query.id === undefined || d.id === query.id).map(clone);
      },
      async cancel(id) {
        log('downloads.cancel', [id]);
        const item = downloadItems.get(id);
        if (item && item.state === 'in_progress') fake.interruptDownload(id, 'USER_CANCELED');
      },
    },
    runtime: {
      id: extensionId,
      onMessage: createEvent(),
      onStartup: createEvent(),
      onInstalled: createEvent(),
      getManifest() {
        log('runtime.getManifest', []);
        return { manifest_version: 3, version };
      },
      getURL(path) {
        log('runtime.getURL', [path]);
        return `chrome-extension://${extensionId}/${String(path).replace(/^\//, '')}`;
      },
      async sendMessage(message) {
        log('runtime.sendMessage', [message]);
        return fake.runtimeSendMessage(message);
      },
    },
  };

  return { chrome, calls, fake };
}
