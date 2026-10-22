/* global chrome, document, location, window, MouseEvent */
// E1-T0 spike, ISOLATED world: owns the detached node and the nonce (D3 variant c).
// `?mode=fallback` attaches the node to <html> for the synchronous handshake instead of relatedTarget.
(() => {
  const t0 = performance.now();
  const mode = new URLSearchParams(location.search).get('mode') || 'related';
  const nonce = crypto.randomUUID();
  const node = document.createElement('span');
  const state = { world: 'iso', t0, mode, bound: false, announces: 0, received: [], docElAtStart: !!document.documentElement };
  const publish = () => document.documentElement?.setAttribute('data-spike-iso', JSON.stringify(state));
  const send = (type, payload = null) =>
    node.dispatchEvent(new CustomEvent('pds:msg', { detail: JSON.stringify({ n: nonce, v: 1, from: 'iso', type, payload }) }));

  const onMainReady = () => announce();
  function announce() {
    state.announces++;
    if (mode === 'fallback') document.documentElement.appendChild(node);
    document.dispatchEvent(new MouseEvent('pds:isolated-ready', { relatedTarget: mode === 'fallback' ? null : node }));
    if (node.parentNode) node.remove();
    send('init');
  }

  node.addEventListener('pds:msg', (e) => {
    const d = e.detail;
    if (typeof d !== 'string') return void state.received.push(`non-string:${typeof d}`);
    let m;
    try {
      m = JSON.parse(d);
    } catch {
      return;
    }
    if (m.n !== nonce || m.from === 'iso') return;
    state.received.push(m.type);
    if (m.type === 'ack' && !state.bound) {
      state.bound = true;
      document.removeEventListener('pds:main-ready', onMainReady);
      node.dispatchEvent(new CustomEvent('pds:obj', { detail: { a: 1, nested: { b: 'x' } } }));
      chrome.runtime.sendMessage({ type: 'isoReport', bound: true }).catch(() => {});
    }
    if (m.type.startsWith('ping-')) send(m.type.replace('ping-', 'pong-'));
    publish();
  });

  document.addEventListener('pds:main-ready', onMainReady);
  announce();
  window.addEventListener('load', publish);
  publish();
})();
