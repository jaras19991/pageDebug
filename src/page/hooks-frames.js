// Same-origin iframe hooks for the MAIN-world recorder (design E2-D6, E2-T8).
// From the top document: existing <iframe> elements + a MutationObserver for new ones. Every accessible same-origin
// frame window gets console.error and window error/unhandledrejection hooks; records go to the caller's `record`
// with `frame` (the frame URL). Each `load` of the element restores the previous install and installs again,
// because the WindowProxy survives a frame navigation. Cross-origin frames throw on access and are skipped.
// Nested frames are followed to depth 2; at most 20 frames are hooked at a time (removed frames free a slot).
// Known limitation: errors a frame raises before we hook it (before its `load`) are lost.

import { installConsoleHook } from './hooks-console.js';
import { installErrorHooks } from './hooks-errors.js';

export const FRAME_LIMITS = Object.freeze({ frames: 20, depth: 2, urlChars: 4000 });

function framesTry(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function frameUrlOf(frameWin) {
  return framesTry(() => {
    const href = String(frameWin.location.href);
    return href.length > FRAME_LIMITS.urlChars ? href.slice(0, FRAME_LIMITS.urlChars) : href;
  }, null);
}

// The frame window when the browser lets us in and its origin is ours ('null' for about:blank/srcdoc that
// inherited our origin — reading its document already proved access). Anything else → null.
function sameOriginWindow(el, topOrigin) {
  return framesTry(() => {
    const frameWin = el.contentWindow;
    if (!frameWin) return null;
    const origin = String(frameWin.location.origin);
    if (origin !== topOrigin && origin !== 'null') return null;
    if (!frameWin.document || !frameWin.console) return null;
    return frameWin;
  }, null);
}

function isIframe(node) {
  return framesTry(() => node.nodeType === 1 && String(node.localName) === 'iframe', false);
}

export function installFrameHooks({ win, doc, now, record, json, intrinsics = {}, depth = 0, shared = null }) {
  // Shared by the whole tree of nested installs: frame budget, on/off and the top document's origin.
  const ctx = shared || { count: 0, active: true, origin: framesTry(() => String(win.location.origin), null) };
  const add = intrinsics.addEventListener || framesTry(() => win.EventTarget.prototype.addEventListener, null);
  const remove = intrinsics.removeEventListener || framesTry(() => win.EventTarget.prototype.removeEventListener, null);
  const Observer = intrinsics.MutationObserver || framesTry(() => win.MutationObserver, null);
  const topOrigin = ctx.origin;
  if (!add || !remove || !doc || topOrigin === null) return () => {};

  // iframe element -> { onLoad, restoreFrame }
  const tracked = new Map();
  let observer = null;

  function hookFrame(el, state) {
    framesTry(() => state.restoreFrame());
    state.restoreFrame = () => {};
    if (!ctx.active) return;
    const frameWin = sameOriginWindow(el, topOrigin);
    if (!frameWin) return;
    const fallbackUrl = frameUrlOf(frameWin);
    const frameRecord = (section, entry) => {
      entry.frame = frameUrlOf(frameWin) ?? fallbackUrl;
      record(section, entry);
    };
    const restores = [];
    const hooks = [
      () => installConsoleHook({ win: frameWin, now, record: frameRecord, json, levels: ['error'], intrinsics }),
      () => installErrorHooks({ win: frameWin, now, record: frameRecord, json, intrinsics }),
    ];
    if (depth + 1 < FRAME_LIMITS.depth) {
      hooks.push(() =>
        installFrameHooks({ win: frameWin, doc: frameWin.document, now, record, json, intrinsics, depth: depth + 1, shared: ctx }),
      );
    }
    for (let i = 0; i < hooks.length; i++) {
      const restoreHook = framesTry(hooks[i], null);
      if (typeof restoreHook === 'function') restores.push(restoreHook);
    }
    state.restoreFrame = () => {
      for (let i = 0; i < restores.length; i++) framesTry(restores[i]);
    };
  }

  function track(el) {
    if (tracked.has(el) || ctx.count >= FRAME_LIMITS.frames) return;
    const state = { onLoad: null, restoreFrame: () => {} };
    state.onLoad = () => hookFrame(el, state);
    const listening = framesTry(() => {
      add.call(el, 'load', state.onLoad);
      return true;
    }, false);
    if (!listening) return;
    tracked.set(el, state);
    ctx.count += 1;
    // Already loaded (or about:blank that fired `load` synchronously on insertion) — hook now.
    hookFrame(el, state);
  }

  // Tracked frames as [el, state] pairs, read with Map#forEach: the page may replace the array iterator (E4-IN2b).
  function trackedPairs() {
    const pairs = [];
    tracked.forEach((state, el) => { pairs.push([el, state]); });
    return pairs;
  }

  function untrack(el, state) {
    framesTry(() => remove.call(el, 'load', state.onLoad));
    framesTry(() => state.restoreFrame());
    tracked.delete(el);
    ctx.count -= 1;
  }

  function scan(root) {
    if (isIframe(root)) track(root);
    const found = framesTry(() => root.querySelectorAll('iframe'), null);
    if (!found) return;
    for (let i = 0; i < found.length && ctx.count < FRAME_LIMITS.frames; i += 1) track(found[i]);
  }

  function onMutations(mutations) {
    if (!ctx.active) return;
    let removed = false;
    const n = framesTry(() => mutations.length >>> 0, 0);
    for (let m = 0; m < n; m++) {
      const mutation = mutations[m];
      if (mutation.removedNodes && mutation.removedNodes.length) removed = true;
      const added = mutation.addedNodes || [];
      for (let i = 0; i < added.length; i += 1) {
        if (framesTry(() => added[i].nodeType === 1, false)) scan(added[i]);
      }
    }
    if (removed) {
      const pairs = trackedPairs();
      for (let i = 0; i < pairs.length; i++) {
        if (!framesTry(() => pairs[i][0].isConnected, true)) untrack(pairs[i][0], pairs[i][1]);
      }
    }
  }

  scan(doc);
  if (Observer) {
    observer = framesTry(() => {
      const obs = new Observer((mutations) => framesTry(() => onMutations(mutations)));
      obs.observe(doc, { childList: true, subtree: true });
      return obs;
    }, null);
  }

  let restored = false;
  return function restore() {
    if (restored) return;
    restored = true;
    if (!shared) ctx.active = false;
    if (observer) framesTry(() => observer.disconnect());
    observer = null;
    const pairs = trackedPairs();
    for (let i = 0; i < pairs.length; i++) untrack(pairs[i][0], pairs[i][1]);
  };
}
