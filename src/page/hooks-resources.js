// Resource observer of the recorder (E2 D2, E2-T3b): Resource Timing entries become `network[]` records
// (img/script/css/font/other); RT entries of fetch/XHR only feed `sizeBytes` of the hook records; `error`
// events of elements (capture phase on window, they do not bubble) mark failed loads. Document status comes
// from Navigation Timing. Statuses are detected by feature (`responseStatus` on the prototype), never by UA.
// Everything the page could replace later is captured at install (document_start). Failures are swallowed.

import { resourceRecord, resourceKind, correlateSizes, mergeLoadErrors, documentStatus as navStatus } from './network-merge.js';

export const RESOURCE_LIMITS = Object.freeze({
  // RT entries of fetch/XHR kept for size correlation, and element load errors kept for merging.
  rtEntries: 500,
  loadErrors: 200,
  urlChars: 4000,
});

// RT initiators whose entries only feed the correlation ring.
const RESOURCE_HOOK_INITIATORS = ['fetch', 'xmlhttprequest'];
// Elements whose `error` event is a failed load; `link` only with rel=stylesheet.
const RESOURCE_ERROR_TAGS = ['img', 'script', 'link', 'source', 'video', 'audio'];

// win -> true while installed; a second install in the same window is inert.
const resourceHooksActive = new WeakMap();

function resourceTry(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function resourcePick(intrinsics, win, name) {
  if (intrinsics && Object.prototype.hasOwnProperty.call(intrinsics, name)) return intrinsics[name];
  return resourceTry(() => win[name], undefined);
}

// Plain copy of a PerformanceResourceTiming entry, read once when observed.
function resourcePlain(entry) {
  return {
    name: resourceTry(() => entry.name, ''),
    initiatorType: resourceTry(() => entry.initiatorType, ''),
    startTime: resourceTry(() => entry.startTime, null),
    duration: resourceTry(() => entry.duration, null),
    responseStatus: resourceTry(() => entry.responseStatus, undefined),
    encodedBodySize: resourceTry(() => entry.encodedBodySize, null),
    decodedBodySize: resourceTry(() => entry.decodedBodySize, null),
    transferSize: resourceTry(() => entry.transferSize, null),
  };
}

function resourceCopies(items) {
  return (Array.isArray(items) ? items : []).map((e) => (e && typeof e === 'object' ? { ...e } : e));
}

function resourceString(value) {
  return typeof value === 'string' ? value.slice(0, RESOURCE_LIMITS.urlChars) : '';
}

// `{ url, kind }` of an element whose load failed, or null for other targets.
function resourceLoadTarget(el) {
  const tag = resourceTry(() => el.localName, null);
  if (typeof tag !== 'string' || RESOURCE_ERROR_TAGS.indexOf(tag) < 0) return null;
  let initiator = tag;
  let url;
  if (tag === 'link') {
    const rel = resourceTry(() => String(el.rel).toLowerCase(), '');
    if (rel.split(/\s+/).indexOf('stylesheet') < 0) return null;
    url = resourceString(resourceTry(() => el.href, ''));
  } else if (tag === 'source') {
    const parent = resourceTry(() => el.parentNode.localName, '');
    initiator = parent === 'picture' ? 'img' : parent || 'other';
    url = resourceString(resourceTry(() => el.src, ''));
  } else if (tag === 'script') {
    url = resourceString(resourceTry(() => el.src, ''));
  } else {
    url = resourceString(resourceTry(() => el.currentSrc, '')) || resourceString(resourceTry(() => el.src, ''));
  }
  if (!url) return null;
  return { url, kind: resourceKind(initiator, url) || 'other' };
}

/**
 * @param {{ win: Window, doc?: Document, now: () => number, record: (section: string, entry: object) => void,
 *   enabled?: () => boolean, intrinsics?: object }} ctx
 *   `intrinsics` may override `PerformanceObserver`, `PerformanceResourceTiming`, `performance`,
 *   `addEventListener`, `removeEventListener` (captured from `win` otherwise).
 * @returns {{ adjust: (items: object[]) => object[], documentStatus: () => object, sync: () => object[], restore: () => void }}
 *   `sync()` records entries still queued in the observer; `adjust(items)` calls it, appends the records it made
 *   and returns copies of the network items with `sizeBytes` correlated and element load errors merged.
 */
export function installResourceHooks({ win, now, record, enabled, intrinsics = {} }) {
  const I = intrinsics || {};
  const reflectApply = Reflect.apply;
  const Observer = resourcePick(I, win, 'PerformanceObserver');
  const Timing = resourcePick(I, win, 'PerformanceResourceTiming');
  const perf = resourcePick(I, win, 'performance');
  const getEntriesByType = resourceTry(() => perf.getEntriesByType, null);
  const add = I.addEventListener || resourceTry(() => win.addEventListener, null);
  const remove = I.removeEventListener || resourceTry(() => win.removeEventListener, null);
  const supportsStatus = resourceTry(() => !!Timing && 'responseStatus' in Timing.prototype, false);
  const docOrigin = resourceTry(() => String(win.location.origin), '');

  const documentStatus = () => {
    const nav = resourceTry(() => (getEntriesByType ? reflectApply(getEntriesByType, perf, ['navigation'])[0] : undefined), undefined);
    const responseStatus = resourceTry(() => nav && nav.responseStatus, undefined);
    return navStatus(nav ? { responseStatus } : undefined, supportsStatus && !!getEntriesByType);
  };

  if (resourceTry(() => resourceHooksActive.get(win), true)) {
    return { adjust: resourceCopies, documentStatus, sync: () => [], restore() {} };
  }

  let active = true;
  const isOn = () => active && resourceTry(() => (typeof enabled === 'function' ? !!enabled() : true), false);
  const rtRing = [];
  const loadErrors = [];
  const push = (ring, item, max) => {
    ring.push(item);
    if (ring.length > max) ring.splice(0, ring.length - max);
  };

  function handle(entries) {
    const made = [];
    if (!isOn()) return made;
    const list = resourceTry(() => Array.from(entries), []);
    for (const raw of list) {
      resourceTry(() => {
        const entry = resourcePlain(raw);
        if (RESOURCE_HOOK_INITIATORS.indexOf(entry.initiatorType) >= 0) {
          push(rtRing, entry, RESOURCE_LIMITS.rtEntries);
          return;
        }
        const rec = resourceRecord(entry, { docOrigin, supportsStatus });
        if (!rec) return;
        made.push(rec);
        resourceTry(() => record('network', rec));
      });
    }
    return made;
  }

  let observer = null;
  if (typeof Observer === 'function') {
    observer = resourceTry(() => new Observer((list) => {
      resourceTry(() => handle(list.getEntries()));
    }), null);
    if (observer && resourceTry(() => (observer.observe({ type: 'resource', buffered: true }), true), false) === false) {
      observer = null;
    }
  }

  function onError(event) {
    resourceTry(() => {
      if (!isOn()) return;
      const target = resourceLoadTarget(event.target);
      if (target) push(loadErrors, { t: now(), url: target.url, kind: target.kind }, RESOURCE_LIMITS.loadErrors);
    });
  }

  const listening = !!add && resourceTry(() => (reflectApply(add, win, ['error', onError, true]), true), false);
  resourceTry(() => resourceHooksActive.set(win, true));

  function sync() {
    if (!observer || !active) return [];
    return resourceTry(() => handle(observer.takeRecords()), []);
  }

  function adjust(items) {
    let list = resourceCopies(items).concat(sync());
    list = resourceTry(() => correlateSizes(list, rtRing.slice(), { docOrigin }), list);
    return resourceTry(() => mergeLoadErrors(list, loadErrors.slice()), list);
  }

  function restore() {
    if (!active) return;
    active = false;
    if (observer) resourceTry(() => observer.disconnect());
    if (listening && remove) resourceTry(() => reflectApply(remove, win, ['error', onError, true]));
    rtRing.length = 0;
    loadErrors.length = 0;
    resourceTry(() => resourceHooksActive.delete(win));
  }

  return { adjust, documentStatus, sync, restore };
}
