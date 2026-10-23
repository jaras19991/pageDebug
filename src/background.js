// Background entry point (design D2, E1-T1c): Chrome service worker and Firefox event page,
// one ES module. No state lives here: every handler reads and writes storage.session through
// the store, so a restarted worker (a fresh module) continues from the same data. All
// listeners are registered synchronously at top level, so an event that wakes the worker
// finds its listener.

import { createStore } from './lib/session-store.js';
import { createRecordingHandlers, PENDING_TTL_MS } from './lib/recording.js';
import { createSaveHandlers } from './lib/save.js';
import { unregisterAll, setBadge } from './lib/content-scripts.js';

// Popup commands (extension page, no tab) and bridge messages (top frame of a tab).
const POPUP_TYPES = new Set(['getStatus', 'armStart', 'start', 'disarm', 'collect', 'saveStarted', 'saveFailed']);
const BRIDGE_TYPES = new Set(['hello', 'flush', 'stopped', 'bridgeError']);

const FAILED = Object.freeze({ ok: false, reason: 'failed' });

/** Both handler sets of one background instance on one shared store (writes share a queue). */
export function createHandlers({ chrome, store, now }) {
  const clock = now ? { now } : {};
  const save = createSaveHandlers({ store, ...chrome, unregisterAll, setBadge, ...clock });
  const recording = createRecordingHandlers({ chrome, store, expireSave: save.expireSave, ...clock });
  return { recording, save };
}

/** D2 sender check; synchronous, so the onMessage listener knows whether it will answer. */
export function acceptsMessage(chrome, message, sender) {
  const type = message?.type;
  if (!sender || sender.id !== chrome.runtime.id) return false;
  if (POPUP_TYPES.has(type)) {
    // A literal file path: the build walker (T11) resolves it; query and hash do not matter.
    const page = typeof sender.url === 'string' ? sender.url.split(/[?#]/)[0] : null;
    return !sender.tab && page === chrome.runtime.getURL('popup/popup.html');
  }
  // `flush` of a document left for another site comes from a frame pending deletion (frameId ≠ 0);
  // the handler checks the document's token instead (F-2).
  if (type === 'flush') return typeof sender.tab?.id === 'number';
  if (BRIDGE_TYPES.has(type)) return typeof sender.tab?.id === 'number' && sender.frameId === 0;
  return false;
}

/**
 * @returns {(message: object, sender: object) => Promise<object | undefined>}  the handler's
 *   answer, or undefined for a message that is not ours or comes from the wrong sender.
 */
export function createRouter({ chrome, store, now = () => Date.now(), handlers = createHandlers({ chrome, store, now }) }) {
  const { recording, save } = handlers;

  // The popup closed between armStart and start while the origin was already granted
  // (no permissions.onAdded): the next status request for that tab finishes the start.
  async function startArmedIfGranted({ tabId, ownRequestId } = {}) {
    const pending = await store.getPending();
    if (!pending || pending.tabId !== tabId || pending.requestId === ownRequestId) return;
    if (now() - pending.at > PENDING_TTL_MS || (await store.getRec())?.requestId === pending.requestId) return;
    if (await chrome.permissions.contains({ origins: [pending.pattern] })) await recording.start({ requestId: pending.requestId });
  }

  const routes = {
    ...recording,
    ...save,
    async getStatus(message, sender) {
      await startArmedIfGranted(message);
      return recording.getStatus(message, sender);
    },
  };

  return async (message, sender) => {
    if (!acceptsMessage(chrome, message, sender)) return undefined;
    return routes[message.type](message, sender);
  };
}

// Captured once: listeners and handlers use the namespace the module was loaded with.
const api = chrome;
const store = createStore(api.storage.session);
const handlers = createHandlers({ chrome: api, store });
const route = createRouter({ chrome: api, store, handlers });

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!acceptsMessage(api, message, sender)) return false;
  route(message, sender).then(sendResponse, (error) => {
    console.error('[pds] background', message.type, error);
    sendResponse(FAILED);
  });
  return true;
});
api.permissions.onAdded.addListener((permissions) => handlers.recording.onPermissionAdded(permissions));
api.downloads.onChanged.addListener((delta) => handlers.save.onDownloadChanged(delta));
api.tabs.onRemoved.addListener((tabId) => handlers.recording.onTabRemoved(tabId));
api.runtime.onStartup.addListener(() => handlers.recording.onStartup());
api.runtime.onInstalled.addListener(() => handlers.recording.onInstalled());
