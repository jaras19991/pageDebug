// Page state collector (environment / DOM / performance / storage) for the MAIN world.
// Logic moved 1:1 from E0 page-debug-snapshot.js; v2 keeps these sections "bez zmian treści".
// Every function takes (win, doc, deps); deps.safeSlice is injected (src/page/serialize.js in the recorder).
// No chrome.* here: this module runs in the page's MAIN world.

export const COLLECTOR_LIMITS = Object.freeze({
  html: 2000000, // v1 config.maxHtmlLength
  storageValue: 5000,
  formValue: 500,
  text: 300,
});

function collectorLimits(deps) {
  return { ...COLLECTOR_LIMITS, ...(deps && deps.limits) };
}

export function getAttributes(el) {
  if (!el?.attributes) return {};
  return Array.from(el.attributes).reduce((acc, attr) => {
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

// The disclosure promises "bez haseł i pól ukrytych" (QA F-3): their value attribute must not
// reach outerHTML either. Template contents are serialized too, so they are searched as well.
const SECRET_INPUTS = 'input[type="password" i], input[type="hidden" i]';
const REDACTED = '[redacted]';

function redactSecretInputs(root) {
  for (const el of root.querySelectorAll(SECRET_INPUTS)) {
    if (el.hasAttribute('value')) el.setAttribute('value', REDACTED);
  }
  for (const tpl of root.querySelectorAll('template')) {
    if (tpl.content) redactSecretInputs(tpl.content);
  }
}

// Page markup without secret input values; the page itself is never touched. The copy lives in
// an inert document: no browsing context, so images do not load and custom elements do not upgrade.
function redactedOuterHTML(doc) {
  const root = doc.documentElement;
  if (!doc.querySelector(`${SECRET_INPUTS}, template`)) return root.outerHTML;
  const inert = doc.implementation.createHTMLDocument('');
  const copy = inert.importNode(root, true);
  redactSecretInputs(copy);
  return copy.outerHTML;
}

export function collectDomSnapshot(win, doc, deps) {
  const { safeSlice } = deps;
  const limits = collectorLimits(deps);
  const allElements = Array.from(doc.querySelectorAll('*'));

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
      outerHTML: safeSlice(redactedOuterHTML(doc), limits.html),
    },
    meta: Array.from(doc.querySelectorAll('meta')).map((el) => getElementSummary(el, deps)),
    canonical: doc.querySelector('link[rel="canonical"]')?.href || null,
    hreflangs: Array.from(doc.querySelectorAll('link[rel="alternate"][hreflang]')).map((el) => ({
      hreflang: el.getAttribute('hreflang'),
      href: el.href,
    })),
    scripts: Array.from(doc.scripts).map((el) => ({
      src: el.src || null,
      type: el.type || null,
      async: el.async,
      defer: el.defer,
      textLength: el.src ? 0 : (el.textContent || '').length,
      id: el.id || null,
      attributes: getAttributes(el),
    })),
    stylesheets: Array.from(doc.querySelectorAll('link[rel="stylesheet"], style')).map((el) => ({
      tagName: el.tagName,
      href: el.getAttribute('href') || null,
      media: el.getAttribute('media') || null,
      disabled: !!el.disabled,
      textLength: el.tagName === 'STYLE' ? (el.textContent || '').length : 0,
      attributes: getAttributes(el),
    })),
    images: Array.from(doc.images).map((img) => ({
      src: img.currentSrc || img.src,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      width: img.width,
      height: img.height,
      loading: img.loading || null,
      alt: img.alt || null,
    })),
    iframes: Array.from(doc.querySelectorAll('iframe')).map((el) => ({
      src: el.src || null,
      id: el.id || null,
      name: el.name || null,
      title: el.title || null,
      attributes: getAttributes(el),
    })),
    forms: Array.from(doc.forms).map((form) => ({
      id: form.id || null,
      name: form.name || null,
      method: form.method || null,
      action: form.action || null,
      enctype: form.enctype || null,
      elements: Array.from(form.elements).map((el) => ({
        tagName: el.tagName,
        type: el.type || null,
        name: el.name || null,
        id: el.id || null,
        value: ['password', 'hidden'].includes(el.type) ? '[redacted]' : safeSlice(el.value, limits.formValue),
        checked: typeof el.checked === 'boolean' ? el.checked : undefined,
      })),
    })),
    rootMarkers: {
      bodyClassName: doc.body?.className || null,
      htmlClassName: doc.documentElement.className || null,
      dataAttributesOnHtml: getAttributes(doc.documentElement),
      dataAttributesOnBody: doc.body ? getAttributes(doc.body) : {},
    },
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
export function collectPageState({ win, doc, safeSlice, limits }) {
  const deps = { safeSlice, limits };
  const result = { environment: null, dom: null, performance: null, storage: null, errors: [] };
  for (const [section, collect] of COLLECTOR_SECTIONS) {
    try {
      result[section] = collect(win, doc, deps);
    } catch (error) {
      result.errors.push({ section, error: (error && error.name) || 'Error' });
    }
  }
  return result;
}
