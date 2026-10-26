// Synthetic "heavy" v4 package (design E3-T6, AC-6.1): 5000 console logs of 40 000 characters, 5000 network requests,
// a 300 KB DOM structure and 1000 runtime errors, plus the smaller page sections. Deterministic (seeded PRNG).
// Text is built from a word list so that it compresses like real logs (not like zeros, not like noise). Long strings
// come from a pool and are shared between entries: memory stays low while the JSON is ~200 MB; the pool chunks are
// longer than the deflate window (32 KB), so sharing does not make the package compress better than real data.

const WORDS = ('user cart order item price total request response error warning loaded render component state update '
  + 'fetch timeout retry session config module handler event click submit form field value invalid missing undefined '
  + 'null object array index length promise resolve reject callback listener widget banner layout scroll resize image '
  + 'script style font cache hit miss status ok failed network latency queue worker thread payload json parse').split(' ');

const LEVELS = ['debug', 'log', 'info', 'warn', 'error'];
const RESOURCE_TYPES = ['img', 'script', 'css', 'font', 'other'];

function prng(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

function textOf(rand, chars) {
  const parts = [];
  let n = 0;
  while (n < chars) {
    const w = rand() < 0.08 ? String(Math.floor(rand() * 1e6)) : WORDS[Math.floor(rand() * WORDS.length)];
    parts.push(w);
    n += w.length + 1;
  }
  return parts.join(' ').slice(0, chars);
}

function structureOf(rand, chars) {
  const parts = ['<html lang="pl"><body>'];
  let n = parts[0].length;
  let i = 0;
  while (n < chars - 40) {
    const tag = ['div', 'span', 'a', 'li', 'section', 'button'][Math.floor(rand() * 6)];
    const el = `<${tag} id="el-${i}" class="c-${Math.floor(rand() * 50)}"></${tag}>`;
    parts.push(el);
    n += el.length;
    i++;
  }
  parts.push('</body></html>');
  return parts.join('');
}

/**
 * @param {{ logs?: number, logChars?: number, requests?: number, errors?: number, structureChars?: number,
 *           resources?: number, seed?: number, fullHtmlChars?: number }} [options]
 */
export function heavyPackage(options = {}) {
  const {
    logs = 5000, logChars = 40000, requests = 5000, errors = 1000, structureChars = 300000,
    resources = 3000, seed = 42, fullHtmlChars = 0,
  } = options;
  const rand = prng(seed);
  const pool = Array.from({ length: 40 }, () => textOf(rand, logChars));
  const stackPool = Array.from({ length: 20 }, () => textOf(rand, 6000));

  const consoleLogs = [];
  for (let i = 0; i < logs; i++) {
    const level = LEVELS[i % LEVELS.length];
    const entry = { t: i * 10, doc: 0, level, args: [pool[i % pool.length]] };
    if (level === 'error' || level === 'warn') entry.stack = stackPool[i % stackPool.length];
    consoleLogs.push(entry);
  }

  const network = [];
  for (let i = 0; i < requests; i++) {
    const isApi = i % 3 === 0;
    const failed = i % 50 === 0;
    const errored = i % 97 === 0;
    network.push({
      t: i * 10 + 5,
      doc: 0,
      type: isApi ? (i % 2 ? 'fetch' : 'xhr') : RESOURCE_TYPES[i % RESOURCE_TYPES.length],
      method: 'GET',
      url: `https://heavy.example.com/${isApi ? 'api/items' : 'static/file'}/${i}?v=${Math.floor(rand() * 1e9)}`,
      status: errored ? null : failed ? 500 : 200,
      ok: !failed && !errored,
      durationMs: Math.round(rand() * 5000) / 10,
      sizeBytes: Math.floor(rand() * 100000),
      requestHeaders: { accept: 'application/json', 'x-request-id': `req-${i}` },
      responseHeaders: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
      requestBody: null,
      error: errored ? 'Failed to fetch' : null,
      ...(isApi ? { responseBodyPreview: textOf(rand, 300), responseBodyTruncated: false } : {}),
    });
  }

  const runtimeErrors = [];
  for (let i = 0; i < errors; i++) {
    runtimeErrors.push({
      t: i * 50 + 1,
      doc: 0,
      type: 'error',
      message: `Uncaught TypeError: item ${i} is undefined`,
      filename: 'https://heavy.example.com/static/app.js',
      lineno: 100 + i,
      colno: 7,
      stack: stackPool[i % stackPool.length],
    });
  }

  const steps = Array.from({ length: 200 }, (_, i) => ({ t: i * 100, doc: 0, type: 'click', selector: `#button-${i}`, text: 'Dodaj' }));
  const failedCount = network.filter((r) => (typeof r.status === 'number' && r.status >= 400) || r.error !== null).length;
  const kept = { consoleLogs: logs, runtimeErrors: errors, network: requests, steps: steps.length };

  const listOf = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  return {
    schemaVersion: 4,
    extensionVersion: '0.5.0',
    source: 'extension',
    collectedAt: '2026-10-26T10:00:00.000Z',
    recordingStartedAt: '2026-10-26T09:50:00.000Z',
    recordingStoppedReason: null,
    timeOrigin: 1792922400000,
    overview: {
      runtimeErrors: errors,
      consoleErrors: consoleLogs.filter((r) => r.level === 'error').length,
      failedRequests: failedCount,
      steps: steps.length,
      poorVitals: 1,
      screenshot: true,
    },
    redaction: { rulesVersion: 1, disabledRules: [], masked: {} },
    limits: {
      consoleLogs: 5000, runtimeErrors: 1000, network: 5000, steps: 2000, entryChars: 40000, stackChars: 16000,
      responseBodyChars: 4096, responseBodyTotalChars: 262144, screenshotBytes: 307200, longTasks: 20,
      html: 300000, packageBytes: fullHtmlChars > 0 ? 10485760 : 2097152,
    },
    truncated: {
      consoleLogs: false, runtimeErrors: false, network: false, steps: false, responseBodies: false,
      html: false, resources: false, dom: false, storage: false, stacks: false,
    },
    documents: [{
      id: 0, url: 'https://heavy.example.com/', timeOrigin: 1792922400000, navigationType: 'navigate', status: 200,
      recorded: true, flushed: true, current: true, counts: { ...kept }, kept: { ...kept },
    }],
    notes: ['Recording started at 2026-10-26T09:50:00.000Z (page reloaded); earlier data is not included.'],
    steps,
    runtimeErrors,
    network,
    vitals: [{
      doc: 0,
      TTFB: { value: 100, rating: 'good' },
      FCP: { value: 900, rating: 'good' },
      LCP: { value: 5000, rating: 'poor' },
      CLS: { value: 0.01, rating: 'good' },
      INP: { available: false, reason: 'no-data' },
      longTasks: { count: 0, items: [] },
    }],
    screenshots: [{ t: 1000, doc: 0, reason: 'save', mime: 'image/jpeg', width: 1280, height: 720, bytes: 200000, file: 'screenshot.jpg', maskedFields: 2 }],
    consoleLogs,
    environment: {
      location: { href: 'https://heavy.example.com/', hostname: 'heavy.example.com', pathname: '/' },
      navigator: { userAgent: 'Mozilla/5.0 Heavy', language: 'pl-PL' },
      viewport: { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 },
    },
    performance: {
      timeOrigin: 1792922400000,
      navigation: { type: 'navigate' },
      resources: listOf(resources, (i) => ({
        name: `https://heavy.example.com/static/file/${i}`, initiatorType: RESOURCE_TYPES[i % 5], startTime: i, duration: 12.5, transferSize: 1000 + i,
      })),
    },
    storage: {
      cookies: [{ name: 'consent', sizeBytes: 12, valueHash: 'a'.repeat(64) }],
      cookiesTotalBytes: 12,
      localStorage: Object.fromEntries(listOf(50, (i) => [`key-${i}`, textOf(rand, 5000)])),
      sessionStorage: Object.fromEntries(listOf(10, (i) => [`s-${i}`, textOf(rand, 3000)])),
    },
    dom: {
      counts: { totalElements: 12000, forms: 2 },
      meta: listOf(300, (i) => ({ name: `meta-${i}`, content: textOf(rand, 80) })),
      scripts: listOf(400, (i) => ({ src: `https://heavy.example.com/js/${i}.js`, async: true })),
      stylesheets: listOf(200, (i) => ({ href: `https://heavy.example.com/css/${i}.css` })),
      images: listOf(800, (i) => ({ src: `https://heavy.example.com/img/${i}.png`, width: 100, height: 100 })),
      iframes: listOf(20, (i) => ({ src: `https://heavy.example.com/frame/${i}` })),
      hreflangs: listOf(150, (i) => ({ lang: `x-${i}`, href: `https://heavy.example.com/${i}` })),
      forms: [],
      structure: structureOf(rand, structureChars),
      fullHtml: fullHtmlChars > 0 ? structureOf(rand, fullHtmlChars) : null,
    },
  };
}
