/* global URL, setInterval, clearInterval, setTimeout, Buffer */
// E2-T0 spike fixture server on 127.0.0.1:0 (also reachable as localhost:<port> = cross-origin).
// /shot      full-viewport solid colour page (S1/S2/S4 screenshot corners)
// /s3        resources with known statuses + feature detection, results in <html data-spike-s3>
// /missing   404 html (navigation responseStatus)
// /s5        same-origin and localhost images (webRequest visibility)
// /s6        endless 500 text/plain stream read through clone + reader + cancel, results in data-spike-s6
import { createServer } from 'node:http';

const S3 = (cross, closed) => `<!doctype html><html><head><meta charset="utf-8"><title>S3</title>
<script>
  window.__errors = [];
  addEventListener('error', (e) => {
    const t = e.target;
    if (t && t !== window && t.tagName) window.__errors.push(t.tagName.toLowerCase() + ':' + (t.src || t.href || ''));
  }, true);
</script>
<link rel="stylesheet" href="/ok.css">
<script src="/missing.js"></script>
<style>@font-face { font-family: Spike; src: url(/font.woff2) format('woff2'); } p { font-family: Spike, sans-serif; }</style>
</head><body><p>S3 text with font</p>
<img src="/missing.png" alt="">
<img src="/ok.png" alt="">
<img src="${cross}/ok.png" alt="">
<img src="${cross}/ok.png?tao=1" alt="">
<img src="${cross}/missing.png?tao=1" alt="">
<img src="${closed}/x.png" alt="">
<script>
  addEventListener('load', () => setTimeout(() => {
    const rt = performance.getEntriesByType('resource').map((e) => ({
      name: e.name.replace(location.origin, '').replace(/^http:\\/\\/[^/]+/, (m) => m.includes('localhost') ? '[cross]' : '[other]'),
      initiatorType: e.initiatorType, responseStatus: 'responseStatus' in e ? e.responseStatus : 'n/a',
      encodedBodySize: e.encodedBodySize, transferSize: e.transferSize,
    }));
    const nav = performance.getEntriesByType('navigation')[0];
    const result = {
      ua: navigator.userAgent,
      features: {
        rtResponseStatus: 'responseStatus' in PerformanceResourceTiming.prototype,
        navResponseStatus: typeof PerformanceNavigationTiming !== 'undefined' && 'responseStatus' in PerformanceNavigationTiming.prototype,
        supportedEntryTypes: PerformanceObserver.supportedEntryTypes,
        interactionId: typeof PerformanceEventTiming !== 'undefined' && 'interactionId' in PerformanceEventTiming.prototype,
      },
      navStatus: nav && 'responseStatus' in nav ? nav.responseStatus : 'n/a',
      rt, errors: window.__errors,
    };
    document.documentElement.setAttribute('data-spike-s3', JSON.stringify(result));
  }, 1500));
</script></body></html>`;

const NAV404 = `<!doctype html><title>404</title><p>not found</p><script>
  addEventListener('load', () => {
    const nav = performance.getEntriesByType('navigation')[0];
    document.documentElement.setAttribute('data-spike-nav', JSON.stringify({ status: nav && 'responseStatus' in nav ? nav.responseStatus : 'n/a' }));
  });
</script>`;

const SHOT = '<!doctype html><title>shot</title><style>html,body{margin:0;height:100%;background:rgb(0,128,255)}</style><body></body>';

const S5 = (cross) => `<!doctype html><title>S5</title><img src="/ok.png?s5=same"><img src="${cross}/ok.png?s5=cross">`;

const S6 = `<!doctype html><title>S6</title><script>
(async () => {
  const out = {};
  const t0 = performance.now();
  const r = await fetch('/endless');
  out.status = r.status;
  out.type = r.headers.get('content-type');
  const clone = r.clone();
  out.bodyUsedAfterClone = r.bodyUsed;
  // Spike reader: up to 8192 chars, end, or 2 s; then cancel.
  const reader = clone.body.getReader();
  const dec = new TextDecoder();
  let text = '';
  const deadline = Date.now() + 2000;
  let timedOut = false;
  while (text.length < 8192) {
    const left = deadline - Date.now();
    if (left <= 0) { timedOut = true; break; }
    const step = await Promise.race([reader.read(), new Promise((res) => setTimeout(() => res('timeout'), left))]);
    if (step === 'timeout') { timedOut = true; break; }
    if (step.done) break;
    text += dec.decode(step.value, { stream: true });
  }
  await reader.cancel().catch((e) => { out.cancelError = String(e); });
  out.cloneChars = text.length;
  out.cloneTimedOut = timedOut;
  out.cloneMs = Math.round(performance.now() - t0);
  out.bodyUsedAfterCloneCancel = r.bodyUsed;
  // Page branch keeps flowing after the clone was cancelled.
  const pr = r.body.getReader();
  let pageChunks = 0, pageChars = 0;
  for (let i = 0; i < 5; i++) {
    const s = await pr.read();
    if (s.done) break;
    pageChunks++; pageChars += s.value.length;
  }
  out.bodyUsedAfterPageRead = r.bodyUsed;
  await pr.cancel();
  out.pageChunks = pageChunks;
  out.pageChars = pageChars;
  // Finite 500 JSON: clone read, then the page still parses r.json().
  const j = await fetch('/err.json');
  const jc = j.clone();
  const jt = await jc.text();
  out.jsonCloneText = jt;
  out.jsonPageParsed = JSON.stringify(await j.json());
  out.totalMs = Math.round(performance.now() - t0);
  document.documentElement.setAttribute('data-spike-s6', JSON.stringify(out));
})().catch((e) => document.documentElement.setAttribute('data-spike-s6', JSON.stringify({ error: String(e) })));
</script>`;

// 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export function startServer() {
  let port;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const cross = `http://localhost:${port}`;
    const tao = url.searchParams.has('tao') ? { 'timing-allow-origin': '*' } : {};
    const send = (status, type, body, extra = {}) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra });
      res.end(body);
    };
    switch (url.pathname) {
      case '/shot': return send(200, 'text/html; charset=utf-8', SHOT);
      case '/s3': return send(200, 'text/html; charset=utf-8', S3(cross, url.searchParams.get('closed')));
      case '/s5': return send(200, 'text/html; charset=utf-8', S5(cross));
      case '/s6': return send(200, 'text/html; charset=utf-8', S6);
      case '/missing': return send(404, 'text/html; charset=utf-8', NAV404);
      case '/ok.css': return send(200, 'text/css', 'body { color: rgb(1, 2, 3); }');
      case '/font.woff2': return send(200, 'font/woff2', Buffer.alloc(2048, 7), { 'access-control-allow-origin': '*' });
      case '/ok.png': return send(200, 'image/png', PNG, tao);
      case '/err.json': return send(500, 'application/json', '{"error":"boom","code":42}');
      case '/endless': {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.write('chunk-0;');
        let i = 1;
        const timer = setInterval(() => res.write(`chunk-${i++};`), 100);
        const stop = () => clearInterval(timer);
        req.on('close', stop);
        res.on('close', stop);
        setTimeout(() => { stop(); res.end(); }, 60_000);
        return undefined;
      }
      default:
        return send(404, url.pathname.endsWith('.js') ? 'text/javascript' : 'text/plain', 'not found', tao);
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      server.closeAllConnections?.();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        cross: `http://localhost:${port}`,
        port,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
      });
    });
  });
}
