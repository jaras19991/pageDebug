// Private MAIN <-> ISOLATED channel (design D3), not window messaging: the two worlds bind
// synchronously at document_start on a detached DOM node handed over in
// MouseEvent.relatedTarget, then talk only through CustomEvents on that node. The page has no
// reference to the node, so it can neither hear nor send. Every detail is a JSON string
// `{ n: nonce, v: CHANNEL_PROTOCOL, id, type, payload }` — objects do not cross worlds reliably.
// Used by both worlds; no extension API here.

export const CHANNEL_PROTOCOL = 1;

export const CHANNEL_EVENTS = Object.freeze({
  mainReady: 'pds:main-ready',
  isolatedReady: 'pds:isolated-ready',
  toMain: 'pds:i2m',
  toIsolated: 'pds:m2i',
});

// Public message types per direction; 'bind' and 'hello' are internal handshake messages.
export const I2M_TYPES = Object.freeze(['config', 'collect', 'destroy']);
export const M2I_TYPES = Object.freeze(['result', 'flush', 'stopped']);

export const CHANNEL_BIND_TIMEOUT_MS = 10000;
// Upper bound for one serialized message (characters); D4 flush is ≤ 3 MB, result adds page state.
export const CHANNEL_MAX_MESSAGE = 32 * 1024 * 1024;

// Captures everything the channel calls, so page scripts patching prototypes or JSON after
// document_start cannot observe the node, the nonce or the payload.
export function captureChannelIntrinsics(win) {
  const etProto = win.EventTarget.prototype;
  const nodeProto = win.Node.prototype;
  return {
    apply: Reflect.apply,
    addEventListener: etProto.addEventListener,
    removeEventListener: etProto.removeEventListener,
    dispatchEvent: etProto.dispatchEvent,
    appendChild: nodeProto.appendChild,
    removeChild: nodeProto.removeChild,
    getParentNode: Object.getOwnPropertyDescriptor(nodeProto, 'parentNode').get,
    getLastChild: Object.getOwnPropertyDescriptor(nodeProto, 'lastChild').get,
    getDetail: Object.getOwnPropertyDescriptor(win.CustomEvent.prototype, 'detail').get,
    getRelatedTarget: Object.getOwnPropertyDescriptor(win.MouseEvent.prototype, 'relatedTarget').get,
    Event: win.Event,
    CustomEvent: win.CustomEvent,
    MouseEvent: win.MouseEvent,
    Node: win.Node,
    Promise: win.Promise,
    jsonParse: win.JSON.parse,
    jsonStringify: win.JSON.stringify,
    setTimeout: win.setTimeout.bind(win),
    clearTimeout: win.clearTimeout.bind(win),
  };
}

// Shared core of both ends. `side` is 'main' or 'isolated'.
function createChannelEnd({ side, doc, intrinsics, onMessage, onUnbound, setTimeout, clearTimeout, bindTimeoutMs }) {
  const I = intrinsics || captureChannelIntrinsics(doc.defaultView);
  const call = (fn, self, ...args) => I.apply(fn, self, args);
  const inEvent = side === 'main' ? CHANNEL_EVENTS.toMain : CHANNEL_EVENTS.toIsolated;
  const outEvent = side === 'main' ? CHANNEL_EVENTS.toIsolated : CHANNEL_EVENTS.toMain;
  const inTypes = side === 'main' ? I2M_TYPES : M2I_TYPES;
  const outTypes = side === 'main' ? M2I_TYPES : I2M_TYPES;
  const st = {
    node: null, nonce: null, bound: false, closed: false, timer: null,
    docListeners: [], resolveBound: null,
  };
  const whenBound = new I.Promise((resolve) => { st.resolveBound = resolve; });
  const setT = setTimeout || I.setTimeout;
  const clearT = clearTimeout || I.clearTimeout;

  function listenDoc(type, fn) {
    call(I.addEventListener, doc, type, fn, true);
    st.docListeners.push([type, fn]);
  }
  function unlistenDoc() {
    for (const [type, fn] of st.docListeners) call(I.removeEventListener, doc, type, fn, true);
    st.docListeners = [];
  }

  function post(type, payload, id) {
    let detail;
    try {
      detail = call(I.jsonStringify, null, { n: st.nonce, v: CHANNEL_PROTOCOL, id: id ?? null, type, payload });
    } catch {
      return false;
    }
    if (typeof detail !== 'string' || detail.length > CHANNEL_MAX_MESSAGE) return false;
    call(I.dispatchEvent, st.node, new I.CustomEvent(outEvent, { detail }));
    return true;
  }

  function markBound() {
    st.bound = true;
    unlistenDoc();
    if (st.timer !== null) { clearT(st.timer); st.timer = null; }
    st.resolveBound(true);
  }

  // Parses and validates one incoming detail; returns the message or null.
  function parse(event) {
    let detail;
    try { detail = call(I.getDetail, event); } catch { return null; }
    if (typeof detail !== 'string' || detail.length > CHANNEL_MAX_MESSAGE) return null;
    let msg;
    try { msg = call(I.jsonParse, null, detail); } catch { return null; }
    if (msg === null || typeof msg !== 'object' || msg.v !== CHANNEL_PROTOCOL) return null;
    if (typeof msg.type !== 'string') return null;
    return msg;
  }

  function deliver(msg) {
    if (!inTypes.includes(msg.type)) return;
    try {
      onMessage({ type: msg.type, payload: msg.payload, id: msg.id ?? null });
    } catch {
      // A failing handler must not surface in the page (window.onerror) or break the sender.
    }
  }

  function onNodeMessage(event) {
    if (st.closed) return;
    const msg = parse(event);
    if (!msg) return;
    if (side === 'main') {
      if (!st.bound) {
        // First message from ISOLATED carries the nonce; MAIN adopts it.
        if (msg.type === 'bind' && typeof msg.n === 'string' && msg.n.length > 0 && msg.n.length <= 200) {
          st.nonce = msg.n;
          markBound();
        }
        return;
      }
      if (msg.n !== st.nonce) return;
      deliver(msg);
      return;
    }
    // ISOLATED
    if (!st.bound) {
      if (msg.type === 'hello' && msg.n === null) {
        const p = msg.payload;
        st.peerVersion = p && typeof p.version === 'string' ? p.version.slice(0, 100) : null;
        markBound();
        post('bind', null);
      }
      return;
    }
    if (msg.n !== st.nonce) return;
    deliver(msg);
  }

  function takeNode(node) {
    st.node = node;
    call(I.addEventListener, node, inEvent, onNodeMessage);
  }

  function close() {
    if (st.closed) return;
    st.closed = true;
    st.bound = false;
    unlistenDoc();
    if (st.timer !== null) { clearT(st.timer); st.timer = null; }
    if (st.node) call(I.removeEventListener, st.node, inEvent, onNodeMessage);
    st.node = null;
    st.nonce = null;
    st.resolveBound(false);
  }

  st.timer = setT(() => {
    st.timer = null;
    if (st.bound || st.closed) return;
    close();
    if (onUnbound) {
      try { onUnbound(); } catch { /* see deliver() */ }
    }
  }, bindTimeoutMs ?? CHANNEL_BIND_TIMEOUT_MS);

  const api = {
    send(type, payload, id) {
      if (!st.bound || st.closed || !outTypes.includes(type)) return false;
      return post(type, payload, id);
    },
    whenBound,
    isBound: () => st.bound && !st.closed,
    close,
  };
  return { st, I, call, api, listenDoc, unlistenDoc, takeNode, post };
}

// MAIN end: waits for ISOLATED's node, accepts only the first one, announces itself so the
// handshake works in either start order. `version` goes to ISOLATED in the hello message.
export function connectMain({
  doc, intrinsics, onMessage, onUnbound, version = null, attachNode = false,
  setTimeout, clearTimeout, bindTimeoutMs,
}) {
  const end = createChannelEnd({
    side: 'main', doc, intrinsics, onMessage, onUnbound, setTimeout, clearTimeout, bindTimeoutMs,
  });
  const { st, I, call } = end;

  function onIsolatedReady(event) {
    if (st.node || st.closed) return;
    let node;
    try { node = call(I.getRelatedTarget, event); } catch { node = null; }
    if (!(node instanceof I.Node) && attachNode) {
      // Fallback (D3): ISOLATED attached the node to documentElement for this synchronous dispatch.
      const root = doc.documentElement;
      const last = root ? call(I.getLastChild, root) : null;
      if (last instanceof I.Node) {
        call(I.removeChild, root, last);
        node = last;
      }
    }
    if (!(node instanceof I.Node)) return;
    // Detach before talking, so nothing bubbles to the document even in fallback mode.
    const parent = call(I.getParentNode, node);
    if (parent) call(I.removeChild, parent, node);
    end.unlistenDoc();
    end.takeNode(node);
    end.post('hello', { version: typeof version === 'string' ? version : null });
  }

  end.listenDoc(CHANNEL_EVENTS.isolatedReady, onIsolatedReady);
  call(I.dispatchEvent, doc, new I.Event(CHANNEL_EVENTS.mainReady));
  return end.api;
}

// ISOLATED end: owns the detached node and the nonce; offers the node now and again whenever
// MAIN announces itself, until MAIN says hello.
export function connectIsolated({
  doc, onMessage, onUnbound, randomUUID, attachNode = false,
  setTimeout, clearTimeout, bindTimeoutMs, intrinsics,
}) {
  const end = createChannelEnd({
    side: 'isolated', doc, intrinsics, onMessage, onUnbound, setTimeout, clearTimeout, bindTimeoutMs,
  });
  const { st, I, call } = end;
  const uuid = randomUUID || (() => doc.defaultView.crypto.randomUUID());
  st.nonce = String(uuid());
  st.peerVersion = null;
  end.takeNode(doc.createElement('div'));

  function offer() {
    if (st.bound || st.closed) return;
    const node = st.node;
    const root = attachNode ? doc.documentElement : null;
    if (root) call(I.appendChild, root, node);
    try {
      call(I.dispatchEvent, doc, new I.MouseEvent(CHANNEL_EVENTS.isolatedReady, { relatedTarget: node }));
    } finally {
      const parent = call(I.getParentNode, node);
      if (parent) call(I.removeChild, parent, node);
    }
  }

  end.listenDoc(CHANNEL_EVENTS.mainReady, offer);
  offer();
  end.api.peerVersion = () => st.peerVersion;
  return end.api;
}
