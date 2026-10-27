// Page state collector (environment / DOM / performance / storage) for the MAIN world.
// Logic moved 1:1 from E0 page-debug-snapshot.js; v4 changes only `dom` (E3-T3b, design D5): no outerHTML,
// `structure` without texts, form values as `valueLength`, `fullHtml` only on the developer's request.
// Every function takes (win, doc, deps); deps.safeSlice is injected (src/page/serialize.js in the recorder).
// No chrome.* here: this module runs in the page's MAIN world.

import { captureDomIntrinsics, serializeDom, DOM_STRUCTURE_MAX_CHARS, DOM_FULL_MAX_CHARS } from './dom-structure.js';

export const COLLECTOR_LIMITS = Object.freeze({
  html: DOM_STRUCTURE_MAX_CHARS, // dom.structure (limits.html in the package)
  fullHtml: DOM_FULL_MAX_CHARS, // dom.fullHtml, developer option only
  storageValue: 5000,
  text: 300,
});

// DOM getters captured when the module loads (document_start in MAIN), so page patches made later
// cannot change dom.structure (D5). Outside a DOM realm serializeDom captures them on its own.
function collectorCaptureIntrinsics() {
  try {
    return typeof globalThis.Element === 'function' ? captureDomIntrinsics(globalThis) : undefined;
  } catch {
    return undefined;
  }
}

const COLLECTOR_DOM_INTRINSICS = collectorCaptureIntrinsics();

function collectorLimits(deps) {
  return { ...COLLECTOR_LIMITS, ...(deps && deps.limits) };
}

// Array copy of a NodeList/HTMLCollection/NamedNodeMap by index, not Array.from: the page may replace the
// array iterator (E4-IN2b).
function collectorList(arrayLike) {
  const out = [];
  const n = arrayLike ? arrayLike.length >>> 0 : 0;
  for (let i = 0; i < n; i++) out.push(arrayLike[i]);
  return out;
}

export function getAttributes(el) {
  if (!el?.attributes) return {};
  return collectorList(el.attributes).reduce((acc, attr) => {
    acc[attr.name] = attr.value;
    return acc;
  }, {});
}

export function textContentShort(el, deps, max = collectorLimits(deps).text) {
  if (!el) return '';
  return deps.safeSlice((el.textContent || '').trim().replace(/\s+/g, ' '), max);
}

export function getElementSummary(el, deps) {
  return {
    tagName: el.tagName,
    id: el.id || null,
    className: el.className || null,
    name: el.getAttribute?.('name') || null,
    type: el.getAttribute?.('type') || null,
    src: el.getAttribute?.('src') || null,
    href: el.getAttribute?.('href') || null,
    text: textContentShort(el, deps),
    attributes: getAttributes(el),
  };
}

export function collectEnvironment(win, doc, _deps) {
  const location = win.location;
  const navigator = win.navigator;
  const screen = win.screen;
  return {
    timestamp: new Date().toISOString(),
    location: {
      href: location.href,
      origin: location.origin,
      protocol: location.protocol,
      host: location.host,
      hostname: location.hostname,
      port: location.port,
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    },
    document: {
      title: doc.title,
      referrer: doc.referrer,
      readyState: doc.readyState,
      visibilityState: doc.visibilityState,
      lastModified: doc.lastModified,
    },
    navigator: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      languages: navigator.languages,
      cookieEnabled: navigator.cookieEnabled,
      onLine: navigator.onLine,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory || null,
    },
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
    },
    viewport: {
      innerWidth: win.innerWidth,
      innerHeight: win.innerHeight,
      outerWidth: win.outerWidth,
      outerHeight: win.outerHeight,
      devicePixelRatio: win.devicePixelRatio,
      scrollX: win.scrollX,
      scrollY: win.scrollY,
    },
  };
}

// Form field value as its length only (AC-3.2); a password value is never read. A file input gives only the
// file count; its value (a fake path with the file name) is never read (IN4).
function collectorFieldValue(el) {
  if (el.type === 'password') return {};
  if (el.type === 'file') {
    const files = el.files;
    const count = files ? Number(files.length) : NaN;
    return Number.isFinite(count) ? { fileCount: count } : {};
  }
  const value = el.value;
  return typeof value === 'string' ? { valueLength: value.length } : {};
}

export function collectDomSnapshot(win, doc, deps) {
  const limits = collectorLimits(deps);
  const intrinsics = deps.intrinsics || COLLECTOR_DOM_INTRINSICS;
  const structure = serializeDom(doc, { mode: 'structure', maxChars: limits.html, intrinsics });
  const allElements = collectorList(doc.querySelectorAll('*'));

  return {
    counts: {
      totalElements: allElements.length,
      scripts: doc.scripts.length,
      stylesheets: doc.styleSheets.length,
      images: doc.images.length,
      links: doc.links.length,
      iframes: doc.querySelectorAll('iframe').length,
      forms: doc.forms.length,
    },
    html: {
      doctype: doc.doctype
        ? {
            name: doc.doctype.name,
            publicId: doc.doctype.publicId,
            systemId: doc.doctype.systemId,
          }
        : null,
      lang: doc.documentElement.lang || null,
      charset: doc.characterSet,
      compatMode: doc.compatMode,
    },
    meta: collectorList(doc.querySelectorAll('meta')).map((el) => getElementSummary(el, deps)),
    canonical: doc.querySelector('link[rel="canonical"]')?.href || null,
    hreflangs: collectorList(doc.querySelectorAll('link[rel="alternate"][hreflang]')).map((el) => ({
      hreflang: el.getAttribute('hreflang'),
      href: el.href,
    })),
    scripts: collectorList(doc.scripts).map((el) => ({
      src: el.src || null,
      type: el.type || null,
      async: el.async,
      defer: el.defer,
      textLength: el.src ? 0 : (el.textContent || '').length,
      id: el.id || null,
      attributes: getAttributes(el),
    })),
    stylesheets: collectorList(doc.querySelectorAll('link[rel="stylesheet"], style')).map((el) => ({
      tagName: el.tagName,
      href: el.getAttribute('href') || null,
      media: el.getAttribute('media') || null,
      disabled: !!el.disabled,
      textLength: el.tagName === 'STYLE' ? (el.textContent || '').length : 0,
      attributes: getAttributes(el),
    })),
    images: collectorList(doc.images).map((img) => ({
      src: img.currentSrc || img.src,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      width: img.width,
      height: img.height,
      loading: img.loading || null,
      // Review F7: alt and title texts may name a person ("Avatar Jana Kowalskiego"); only their lengths are kept.
      altLength: (img.alt || '').length,
    })),
    iframes: collectorList(doc.querySelectorAll('iframe')).map((el) => {
      const attributes = getAttributes(el);
      delete attributes.title;
      return {
        src: el.src || null,
        id: el.id || null,
        name: el.name || null,
        titleLength: (el.title || '').length,
        attributes,
      };
    }),
    forms: collectorList(doc.forms).map((form) => ({
      id: form.id || null,
      name: form.name || null,
      method: form.method || null,
      action: form.action || null,
      enctype: form.enctype || null,
      elements: collectorList(form.elements).map((el) => ({
        tagName: el.tagName,
        type: el.type || null,
        name: el.name || null,
        id: el.id || null,
        ...collectorFieldValue(el),
        checked: typeof el.checked === 'boolean' ? el.checked : undefined,
      })),
    })),
    rootMarkers: {
      bodyClassName: doc.body?.className || null,
      htmlClassName: doc.documentElement.className || null,
      dataAttributesOnHtml: getAttributes(doc.documentElement),
      dataAttributesOnBody: doc.body ? getAttributes(doc.body) : {},
    },
    // Last keys of dom (schema v4).
    structure: structure.html,
    structureTruncated: structure.truncated,
    omittedElements: structure.omittedElements,
    fullHtml: deps.fullHtml
      ? serializeDom(doc, { mode: 'full', maxChars: limits.fullHtml, intrinsics }).html
      : null,
  };
}

export function getPerformanceSummary(win, _doc, _deps) {
  const performance = win.performance;
  const nav = performance.getEntriesByType('navigation')[0];
  const resources = performance.getEntriesByType('resource');

  return {
    timeOrigin: performance.timeOrigin,
    navigation: nav
      ? {
          name: nav.name,
          entryType: nav.entryType,
          startTime: nav.startTime,
          duration: nav.duration,
          initiatorType: nav.initiatorType,
          nextHopProtocol: nav.nextHopProtocol,
          renderBlockingStatus: nav.renderBlockingStatus,
          workerStart: nav.workerStart,
          redirectStart: nav.redirectStart,
          redirectEnd: nav.redirectEnd,
          fetchStart: nav.fetchStart,
          domainLookupStart: nav.domainLookupStart,
          domainLookupEnd: nav.domainLookupEnd,
          connectStart: nav.connectStart,
          secureConnectionStart: nav.secureConnectionStart,
          connectEnd: nav.connectEnd,
          requestStart: nav.requestStart,
          responseStart: nav.responseStart,
          responseEnd: nav.responseEnd,
          domInteractive: nav.domInteractive,
          domContentLoadedEventStart: nav.domContentLoadedEventStart,
          domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
          domComplete: nav.domComplete,
          loadEventStart: nav.loadEventStart,
          loadEventEnd: nav.loadEventEnd,
          transferSize: nav.transferSize,
          encodedBodySize: nav.encodedBodySize,
          decodedBodySize: nav.decodedBodySize,
          type: nav.type,
        }
      : null,
    resources: resources.map((r) => ({
      name: r.name,
      entryType: r.entryType,
      initiatorType: r.initiatorType,
      startTime: r.startTime,
      duration: r.duration,
      transferSize: r.transferSize,
      encodedBodySize: r.encodedBodySize,
      decodedBodySize: r.decodedBodySize,
      nextHopProtocol: r.nextHopProtocol,
      renderBlockingStatus: r.renderBlockingStatus || null,
      responseEnd: r.responseEnd,
    })),
  };
}

function readStorageArea(win, name, deps, max) {
  const data = {};
  try {
    const storage = win[name];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      data[key] = deps.safeSlice(storage.getItem(key), max);
    }
  } catch (e) {
    data.__error = e.message;
  }
  return data;
}

export function getStorageSnapshot(win, doc, deps) {
  const max = collectorLimits(deps).storageValue;
  return {
    cookies: doc.cookie,
    localStorage: readStorageArea(win, 'localStorage', deps, max),
    sessionStorage: readStorageArea(win, 'sessionStorage', deps, max),
  };
}

const COLLECTOR_SECTIONS = [
  ['environment', collectEnvironment],
  ['dom', collectDomSnapshot],
  ['performance', getPerformanceSummary],
  ['storage', getStorageSnapshot],
];

// Collects all four sections; a throwing section becomes null plus { section, error: error.name }.
// `fullHtml: true` (developer option, D12) adds dom.fullHtml; otherwise it is null.
export function collectPageState({ win, doc, safeSlice, limits, fullHtml = false, intrinsics }) {
  const deps = { safeSlice, limits, fullHtml: fullHtml === true, intrinsics };
  const result = { environment: null, dom: null, performance: null, storage: null, errors: [] };
  for (let i = 0; i < COLLECTOR_SECTIONS.length; i++) {
    const section = COLLECTOR_SECTIONS[i][0];
    try {
      result[section] = COLLECTOR_SECTIONS[i][1](win, doc, deps);
    } catch (error) {
      result.errors.push({ section, error: (error && error.name) || 'Error' });
    }
  }
  return result;
}
