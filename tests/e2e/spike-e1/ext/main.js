/* global document, location, window, MouseEvent */
// E1-T0 spike, MAIN world: no chrome.*. Captures intrinsics at document_start, so page patches
// made later (dispatchEvent, CustomEvent.prototype.detail) cannot see channel traffic. One
// "naive" round trip uses the live (patchable) APIs to show what T13 must avoid.
(() => {
  const t0 = performance.now();
  const apply = Reflect.apply;
  const addL = EventTarget.prototype.addEventListener;
  const removeL = EventTarget.prototype.removeEventListener;
  const dispatch = EventTarget.prototype.dispatchEvent;
  const detailGet = Object.getOwnPropertyDescriptor(CustomEvent.prototype, 'detail').get;
  const relatedGet = Object.getOwnPropertyDescriptor(MouseEvent.prototype, 'relatedTarget').get;
  const CE = CustomEvent;
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const mode = new URLSearchParams(location.search).get('mode') || 'related';
  const state = {
    world: 'main', t0, timeOrigin: performance.timeOrigin, mode, bound: false, nodeConnected: null,
    received: [], errors: [], objDetail: null, sent: false, docElAtStart: !!document.documentElement,
  };
  const publish = () => document.documentElement?.setAttribute('data-spike-main', stringify(state));
  let node = null;
  let nonce = null;

  apply(addL, window, ['error', (e) => state.errors.push(String(e.message).slice(0, 200)), true]);

  const sendSafe = (type) =>
    apply(dispatch, node, [new CE('pds:msg', { detail: stringify({ n: nonce, v: 1, from: 'main', type }) })]);
  const sendNaive = (type) =>
    node.dispatchEvent(new CustomEvent('pds:msg', { detail: JSON.stringify({ n: nonce, v: 1, from: 'main', type }) }));

  function onMsg(e) {
    const d = apply(detailGet, e, []);
    if (typeof d !== 'string') return void state.received.push(`non-string:${typeof d}`);
    let m;
    try {
      m = parse(d);
    } catch {
      return;
    }
    if (m.from === 'main') return;
    if (nonce === null && m.type === 'init') {
      nonce = m.n;
      sendSafe('ack');
    }
    if (m.n !== nonce) return;
    state.received.push(m.type);
    if (m.type === 'pong-naive') void e.detail; // live getter: page patch sees it
    publish();
  }

  function onObj(e) {
    try {
      const d = apply(detailGet, e, []);
      state.objDetail = { type: d === null ? 'null' : typeof d, json: stringify(d) };
    } catch (error) {
      state.objDetail = { error: String(error).slice(0, 200) };
    }
  }

  function onIsolatedReady(e) {
    if (node) return;
    const candidate = mode === 'fallback' ? document.documentElement.lastChild : apply(relatedGet, e, []);
    if (!candidate || candidate.nodeType !== 1) return void state.errors.push('no-node');
    node = candidate;
    state.nodeConnected = node.isConnected;
    if (mode === 'fallback') node.remove();
    apply(addL, node, ['pds:msg', onMsg]);
    apply(addL, node, ['pds:obj', onObj]);
    apply(removeL, document, ['pds:isolated-ready', onIsolatedReady]);
    state.bound = true;
    state.boundAt = performance.now();
  }

  apply(addL, document, ['pds:isolated-ready', onIsolatedReady]);
  apply(dispatch, document, [new CE('pds:main-ready')]);

  apply(addL, window, [
    'load',
    () =>
      setTimeout(() => {
        if (node) {
          sendSafe('ping-safe');
          sendNaive('ping-naive');
        }
        setTimeout(() => {
          state.sent = true;
          publish();
        }, 50);
      }, 50),
  ]);
  publish();
})();
