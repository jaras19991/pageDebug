/* global URL */
// E1-T0 spike fixture server on 127.0.0.1:0. `/head` is a hostile page: its first <head> script
// listens for pds:* events, patches dispatchEvent and CustomEvent.prototype.detail, then forges a
// handshake at load; the second <head> script throws (S5).
import { createServer } from 'node:http';

const HOSTILE = `
(() => {
  const t0 = performance.now();
  const types = ['pds:isolated-ready', 'pds:main-ready', 'pds:msg', 'pds:obj'];
  const log = { t0, events: [], leaks: [], forged: 0, fakeNodeMessages: 0 };
  let self = false;
  for (const target of [document, window]) {
    for (const type of types) target.addEventListener(type, (e) => { if (!self) log.events.push(type); }, true);
  }
  const detailGet = Object.getOwnPropertyDescriptor(CustomEvent.prototype, 'detail').get;
  const origDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (e) {
    if (!self && e && String(e.type).startsWith('pds:')) log.leaks.push({ via: 'dispatchEvent', type: e.type, detail: e instanceof CustomEvent ? String(detailGet.call(e)).slice(0, 300) : '' });
    return origDispatch.call(this, e);
  };
  Object.defineProperty(CustomEvent.prototype, 'detail', {
    configurable: true,
    get() {
      const d = detailGet.call(this);
      if (!self && String(this.type).startsWith('pds:')) log.leaks.push({ via: 'detailGetter', type: this.type, detail: String(d).slice(0, 300) });
      return d;
    },
  });
  addEventListener('load', () => {
    log.events = log.events.slice();
    self = true;
    const fake = document.createElement('span');
    fake.addEventListener('pds:msg', () => log.fakeNodeMessages++);
    document.dispatchEvent(new MouseEvent('pds:isolated-ready', { relatedTarget: fake }));
    document.dispatchEvent(new CustomEvent('pds:main-ready'));
    log.forged = 2;
    self = false;
    setTimeout(() => document.documentElement.setAttribute('data-spike-page', JSON.stringify(log)), 150);
  });
})();`;

const page = (title) => `<!doctype html><html><head><title>${title}</title>
<script>${HOSTILE}</script>
<script>throw new Error('head-boom');</script>
</head><body><p>${title}</p></body></html>`;

export function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const html = url.pathname === '/head' ? page('Spike E1 head') : '<!doctype html><title>plain</title><p>plain</p>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ origin: `http://127.0.0.1:${port}`, port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
