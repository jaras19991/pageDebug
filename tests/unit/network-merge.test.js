import { describe, it, expect } from 'vitest';
import {
  resourceKind,
  resourceRecord,
  correlateSizes,
  mergeLoadErrors,
  documentStatus,
} from '../../src/page/network-merge.js';

const ORIGIN = 'http://127.0.0.1:8080';
const OTHER = 'http://localhost:8081';

// A PerformanceResourceTiming-like entry; only the fields the module reads.
function rt(name, initiatorType, startTime, extra = {}) {
  return {
    name,
    entryType: 'resource',
    initiatorType,
    startTime,
    duration: 12.345,
    responseStatus: 200,
    encodedBodySize: 100,
    decodedBodySize: 300,
    transferSize: 400,
    ...extra,
  };
}

function hookEntry(type, url, t, status) {
  return {
    t,
    type,
    method: 'GET',
    url,
    status,
    statusText: '',
    ok: status >= 200 && status < 300,
    redirected: false,
    durationMs: 3,
    requestHeaders: {},
    responseHeaders: {},
    requestBody: null,
    error: null,
  };
}

const SCHEMA_KEYS = [
  't', 'type', 'method', 'url', 'status', 'statusText', 'ok', 'redirected', 'durationMs', 'sizeBytes',
  'requestHeaders', 'responseHeaders', 'requestBody', 'error', 'initiatorType',
];

describe('resourceKind (AC-4.1)', () => {
  it('kind mapping table', () => {
    const table = [
      ['img', `${ORIGIN}/img/a.png`, 'img'],
      ['css', `${ORIGIN}/fonts/f.woff2?v=3`, 'font'],
      ['css', `${ORIGIN}/fonts/f.woff`, 'font'],
      ['link', `${ORIGIN}/f.TTF`, 'font'],
      ['other', `${ORIGIN}/f.otf`, 'font'],
      ['css', `${ORIGIN}/f.eot#iefix`, 'font'],
      ['link', `${ORIGIN}/s/site.css`, 'css'],
      ['other', `${ORIGIN}/s/site.css?x=1`, 'css'],
      ['css', `${ORIGIN}/bg.jpg`, 'img'],
      ['link', `${ORIGIN}/a.jpeg`, 'img'],
      ['other', `${ORIGIN}/a.gif`, 'img'],
      ['other', `${ORIGIN}/a.webp`, 'img'],
      ['other', `${ORIGIN}/a.avif`, 'img'],
      ['css', `${ORIGIN}/a.svg`, 'img'],
      ['link', `${ORIGIN}/favicon.ico`, 'img'],
      ['link', `${ORIGIN}/app.js`, 'script'],
      ['other', `${ORIGIN}/mod.mjs`, 'script'],
      ['img', `${ORIGIN}/pixel`, 'img'],
      ['image', `${ORIGIN}/pixel`, 'img'],
      ['input', `${ORIGIN}/btn`, 'img'],
      ['script', `${ORIGIN}/jsonp?cb=x`, 'script'],
      ['link', `${ORIGIN}/styles`, 'css'],
      ['css', `${ORIGIN}/no-ext`, 'other'],
      ['beacon', `${ORIGIN}/collect`, 'other'],
      ['iframe', `${ORIGIN}/inner.html`, 'other'],
      ['other', `${ORIGIN}/dir.png/file`, 'other'],
      [undefined, undefined, 'other'],
    ];
    for (const [initiator, url, kind] of table) {
      expect([initiator, url, resourceKind(initiator, url)]).toEqual([initiator, url, kind]);
    }
  });

  it('fetch, xmlhttprequest and navigation have no resource kind, even with a file extension', () => {
    expect(resourceKind('fetch', `${ORIGIN}/data.json`)).toBeNull();
    expect(resourceKind('fetch', `${ORIGIN}/lib.js`)).toBeNull();
    expect(resourceKind('xmlhttprequest', `${ORIGIN}/a.png`)).toBeNull();
    expect(resourceKind('navigation', `${ORIGIN}/index.html`)).toBeNull();
  });
});

describe('resourceRecord (AC-4.1, AC-4.3)', () => {
  const opts = { docOrigin: ORIGIN, supportsStatus: true };

  it('same-origin 404 img keeps status 404', () => {
    const rec = resourceRecord(rt(`${ORIGIN}/img/missing.png`, 'img', 40.123, { responseStatus: 404, encodedBodySize: 9 }), opts);
    expect(rec).toMatchObject({ t: 40.12, type: 'img', method: 'GET', url: `${ORIGIN}/img/missing.png`, status: 404, ok: false,
      sizeBytes: 9, durationMs: 12.35, error: null, initiatorType: 'img' });
    expect('statusUnavailable' in rec).toBe(false);
    expect(Object.keys(rec)).toEqual(SCHEMA_KEYS);
  });

  it('same-origin 200 css is ok with encodedBodySize as sizeBytes', () => {
    const rec = resourceRecord(rt(`${ORIGIN}/site.css`, 'link', 5), opts);
    expect(rec).toMatchObject({ type: 'css', status: 200, ok: true, sizeBytes: 100 });
  });

  it('cross-origin entry with responseStatus 0 → null + cross-origin; never bare 0', () => {
    const rec = resourceRecord(rt(`${OTHER}/x.png`, 'img', 41, {
      responseStatus: 0, encodedBodySize: 0, decodedBodySize: 0, transferSize: 0,
    }), opts);
    expect(rec.status).toBeNull();
    expect(rec.statusUnavailable).toBe('cross-origin');
    expect(rec.ok).toBeNull();
    expect(rec.sizeBytes).toBeNull();
    expect(Object.keys(rec)).toEqual([...SCHEMA_KEYS.slice(0, 5), 'statusUnavailable', ...SCHEMA_KEYS.slice(5)]);
  });

  it('cross-origin entry with CORS status keeps the status', () => {
    const rec = resourceRecord(rt(`${OTHER}/cors.js`, 'script', 1, { responseStatus: 200, encodedBodySize: 50 }), opts);
    expect(rec.status).toBe(200);
    expect(rec.sizeBytes).toBe(50);
    expect('statusUnavailable' in rec).toBe(false);
  });

  it('unsupported browser → statusUnavailable unsupported-browser', () => {
    const entry = rt(`${ORIGIN}/a.png`, 'img', 1);
    delete entry.responseStatus;
    const rec = resourceRecord(entry, { docOrigin: ORIGIN, supportsStatus: false });
    expect(rec.status).toBeNull();
    expect(rec.statusUnavailable).toBe('unsupported-browser');
    expect(rec.sizeBytes).toBe(100);
  });

  it('cross-origin in a browser without responseStatus still says cross-origin', () => {
    const entry = rt(`${OTHER}/a.png`, 'img', 1, { encodedBodySize: 0, decodedBodySize: 0, transferSize: 0 });
    delete entry.responseStatus;
    expect(resourceRecord(entry, { docOrigin: ORIGIN, supportsStatus: false }).statusUnavailable).toBe('cross-origin');
  });

  it('same-origin responseStatus 0 → network-error', () => {
    const rec = resourceRecord(rt(`${ORIGIN}/gone.js`, 'script', 1, { responseStatus: 0, encodedBodySize: 0 }), opts);
    expect(rec.status).toBeNull();
    expect(rec.statusUnavailable).toBe('network-error');
    expect(rec.sizeBytes).toBe(0);
  });

  it('long URLs and odd numbers are bounded', () => {
    const long = `${ORIGIN}/${'a'.repeat(5000)}.png`;
    const rec = resourceRecord(rt(long, 'x'.repeat(100), NaN, { duration: undefined, encodedBodySize: -1 }), opts);
    expect(rec.url.length).toBeLessThanOrEqual(4100);
    expect(rec.initiatorType.length).toBeLessThanOrEqual(32);
    expect(rec.t).toBeNull();
    expect(rec.durationMs).toBeNull();
    expect(rec.sizeBytes).toBeNull();
  });

  it('returns null for fetch/xmlhttprequest entries', () => {
    expect(resourceRecord(rt(`${ORIGIN}/api`, 'fetch', 1), opts)).toBeNull();
    expect(resourceRecord(rt(`${ORIGIN}/api`, 'xmlhttprequest', 1), opts)).toBeNull();
  });
});

describe('correlateSizes (E2-TEST1, AC-4.4)', () => {
  it('3 identical fetch(\'/api/x\') within 50 ms map 1:1 to 3 RT entries in order; statuses 200/500/404 untouched; no extra entries', () => {
    const url = `${ORIGIN}/api/x`;
    const hooks = [hookEntry('fetch', url, 100, 200), hookEntry('fetch', url, 120, 500), hookEntry('fetch', url, 140, 404)];
    // RT entries report the order in which responses finished; startTime is what the module matches on.
    const rts = [
      rt(url, 'fetch', 140.5, { encodedBodySize: 33, responseStatus: 200 }),
      rt(url, 'fetch', 100.2, { encodedBodySize: 11, responseStatus: 404 }),
      rt(url, 'fetch', 120.4, { encodedBodySize: 22, responseStatus: 200 }),
    ];
    const out = correlateSizes(hooks, rts);
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.status)).toEqual([200, 500, 404]);
    expect(out.map((e) => e.sizeBytes)).toEqual([11, 22, 33]);
    expect(out.every((e) => e.type === 'fetch')).toBe(true);
    // Copies: the hook entries are not mutated.
    expect('sizeBytes' in hooks[0]).toBe(false);
    expect(Object.keys(out[0])).toEqual(SCHEMA_KEYS.slice(0, -1));
  });

  it('RT entries of initiatorType fetch/xmlhttprequest never become own records', () => {
    const url = `${ORIGIN}/api/y`;
    const rts = [rt(url, 'fetch', 1), rt(url, 'xmlhttprequest', 2), rt(`${ORIGIN}/orphan`, 'fetch', 3)];
    expect(correlateSizes([], rts)).toEqual([]);
    expect(correlateSizes([hookEntry('xhr', url, 2, 401)], rts)).toHaveLength(1);
    expect(rts.map((e) => resourceRecord(e, { docOrigin: ORIGIN, supportsStatus: true }))).toEqual([null, null, null]);
  });

  it('matches xhr only with xmlhttprequest and fetch only with fetch', () => {
    const url = `${ORIGIN}/api/z`;
    const out = correlateSizes(
      [hookEntry('xhr', url, 10, 401), hookEntry('fetch', url, 10, 500)],
      [rt(url, 'fetch', 10, { encodedBodySize: 5 }), rt(url, 'xmlhttprequest', 10, { encodedBodySize: 7 })],
    );
    expect(out.map((e) => [e.type, e.status, e.sizeBytes])).toEqual([['xhr', 401, 7], ['fetch', 500, 5]]);
  });

  it('unmatched hook entry keeps sizeBytes null', () => {
    const out = correlateSizes([hookEntry('fetch', `${ORIGIN}/a`, 10, 200)], [rt(`${ORIGIN}/b`, 'fetch', 10)]);
    expect(out[0].sizeBytes).toBeNull();
  });

  it('RT entry far outside window not assigned', () => {
    const url = `${ORIGIN}/a`;
    const out = correlateSizes(
      [hookEntry('fetch', url, 1000, 200), hookEntry('fetch', url, 5000, 200)],
      [rt(url, 'fetch', 990), rt(url, 'fetch', 6500)],
    );
    expect(out.map((e) => e.sizeBytes)).toEqual([null, null]);
    // Window edges: [t - 5, t + 1000].
    const edge = correlateSizes([hookEntry('fetch', url, 1000, 200), hookEntry('fetch', url, 3000, 200)],
      [rt(url, 'fetch', 995, { encodedBodySize: 1 }), rt(url, 'fetch', 4000, { encodedBodySize: 2 })]);
    expect(edge.map((e) => e.sizeBytes)).toEqual([1, 2]);
  });

  it('cross-origin opaque fetch with all-zero sizes gets null, not 0', () => {
    const url = `${OTHER}/api`;
    const out = correlateSizes([hookEntry('fetch', url, 1, 200)],
      [rt(url, 'fetch', 1, { encodedBodySize: 0, decodedBodySize: 0, transferSize: 0, responseStatus: 0 })], { docOrigin: ORIGIN });
    expect(out[0].sizeBytes).toBeNull();
  });

  it('resource records pass through unchanged and the input order is kept', () => {
    const img = resourceRecord(rt(`${ORIGIN}/a.png`, 'img', 50), { docOrigin: ORIGIN, supportsStatus: true });
    const f = hookEntry('fetch', `${ORIGIN}/a`, 60, 200);
    const out = correlateSizes([f, img], [rt(`${ORIGIN}/a`, 'fetch', 60, { encodedBodySize: 4 })]);
    expect(out[1]).toEqual(img);
    expect(out[1]).not.toBe(img);
    expect(out[0].sizeBytes).toBe(4);
  });
});

describe('mergeLoadErrors', () => {
  const opts = { docOrigin: ORIGIN, supportsStatus: true };

  it('load error merged into matching entry; unmatched load error becomes network-error record', () => {
    const img = resourceRecord(rt(`${ORIGIN}/img/missing.png`, 'img', 40, { responseStatus: 404 }), opts);
    const css = resourceRecord(rt(`${ORIGIN}/site.css`, 'link', 10), opts);
    const out = mergeLoadErrors([css, img], [
      { t: 45, url: `${ORIGIN}/img/missing.png`, kind: 'img' },
      { t: 70, url: `${ORIGIN}/dead.js`, kind: 'script' },
    ]);
    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({ url: `${ORIGIN}/img/missing.png`, status: 404, error: 'load-failed' });
    expect(out[0].error).toBeNull();
    const added = out[2];
    expect(added).toMatchObject({ t: 70, type: 'script', method: 'GET', url: `${ORIGIN}/dead.js`, status: null,
      statusUnavailable: 'network-error', sizeBytes: null, error: 'load-failed' });
    expect(img.error).toBeNull();
  });

  it('each record takes at most one load error; a second failure of the same URL is its own record', () => {
    const url = `${ORIGIN}/a.png`;
    const rec = resourceRecord(rt(url, 'img', 10, { responseStatus: 404 }), opts);
    const out = mergeLoadErrors([rec], [{ t: 12, url, kind: 'img' }, { t: 20, url, kind: 'img' }]);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.status)).toEqual([404, null]);
  });

  it('does not attach a load error to a fetch/xhr entry or a resource of another kind', () => {
    const url = `${ORIGIN}/thing`;
    const out = mergeLoadErrors([hookEntry('fetch', url, 1, 500)], [{ t: 5, url, kind: 'img' }]);
    expect(out).toHaveLength(2);
    expect(out[0].error).toBeNull();
    expect(out[1].type).toBe('img');
  });

  it('new records are placed by time', () => {
    const a = resourceRecord(rt(`${ORIGIN}/a.css`, 'link', 10), opts);
    const b = resourceRecord(rt(`${ORIGIN}/b.css`, 'link', 90), opts);
    const out = mergeLoadErrors([a, b], [{ t: 50, url: `${ORIGIN}/c.png`, kind: 'img' }]);
    expect(out.map((e) => e.t)).toEqual([10, 50, 90]);
  });
});

describe('documentStatus (AC-4.2)', () => {
  it('documentStatus from navigation responseStatus 404', () => {
    expect(documentStatus({ entryType: 'navigation', responseStatus: 404 }, true)).toEqual({ status: 404 });
  });

  it('unsupported browser, missing entry and zero status explain the null', () => {
    expect(documentStatus({ entryType: 'navigation' }, false)).toEqual({ status: null, statusUnavailable: 'unsupported-browser' });
    expect(documentStatus(null, true)).toEqual({ status: null, statusUnavailable: 'unknown' });
    expect(documentStatus({ responseStatus: 0 }, true)).toEqual({ status: null, statusUnavailable: 'unknown' });
  });
});

describe('intrinsics captured at load (E2-T9a, orchestrator decision 1)', () => {
  it('page replacing URL/Set/Map after load does not change records or size correlation', () => {
    const saved = { URL: globalThis.URL, Set: globalThis.Set, Map: globalThis.Map };
    const broken = function () {
      throw new Error('patched by page');
    };
    let rec;
    let sized;
    try {
      globalThis.URL = broken;
      globalThis.Set = broken;
      globalThis.Map = broken;
      rec = resourceRecord(rt(`${ORIGIN}/x.png`, 'img', 5, { responseStatus: 0 }), { docOrigin: ORIGIN, supportsStatus: true });
      sized = correlateSizes(
        [{ t: 10, type: 'fetch', url: `${ORIGIN}/api`, durationMs: 1, sizeBytes: null }],
        [rt(`${ORIGIN}/api`, 'fetch', 11, { encodedBodySize: 23 })],
        { docOrigin: ORIGIN },
      );
    } finally {
      Object.assign(globalThis, saved);
    }
    // Same-origin is only recognised through the captured URL (a broken one would say cross-origin).
    expect(rec.statusUnavailable).toBe('network-error');
    expect(sized[0].sizeBytes).toBe(23);
  });

  it('explicit intrinsics option is used instead of the captured ones', () => {
    const seen = [];
    class SpyURL extends URL {
      constructor(href) {
        super(href);
        seen.push(href);
      }
    }
    const rec = resourceRecord(rt(`${ORIGIN}/a.css`, 'link', 1), { docOrigin: ORIGIN, supportsStatus: true, intrinsics: { URL: SpyURL } });
    expect(rec.type).toBe('css');
    expect(seen).toEqual([`${ORIGIN}/a.css`]);
    correlateSizes([], [], { docOrigin: ORIGIN, intrinsics: { URL: SpyURL, Set, Map } });
  });
});
