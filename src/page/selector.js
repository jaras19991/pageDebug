// CSS selector of an element for steps and vitals attribution (design D4, E2-T5a, AC-3.2).
// Order: `#id` if unique → `tag[data-testid|data-test|data-test-id|data-qa|data-cy="…"]` if unique →
// path of `tag:nth-of-type(k)` segments joined with ` > ` from the nearest ancestor with a unique id (or `html`).
// Every DOM call goes through intrinsics captured at document_start, so page patches made later
// (getAttribute, querySelectorAll, the `id` getter, …) do not change the result.

export const SELECTOR_MAX_CHARS = 1000;

// Above this many elements in the document the test-attribute step is skipped (one scan per attribute is too slow).
export const SELECTOR_DATA_MAX_ELEMENTS = 5000;

const SELECTOR_TEST_ATTRIBUTES = ['data-testid', 'data-test', 'data-test-id', 'data-qa', 'data-cy'];

function selectorGetter(proto, name) {
  const desc = proto && Object.getOwnPropertyDescriptor(proto, name);
  return desc && typeof desc.get === 'function' ? desc.get : undefined;
}

export function captureSelectorIntrinsics(win) {
  const elementProto = win.Element.prototype;
  const nodeProto = win.Node.prototype;
  const css = win.CSS;
  return {
    apply: Reflect.apply,
    querySelectorAll: win.Document.prototype.querySelectorAll,
    getElementsByTagName: win.Document.prototype.getElementsByTagName,
    getAttribute: elementProto.getAttribute,
    closest: elementProto.closest,
    getTagName: selectorGetter(elementProto, 'tagName'),
    getId: selectorGetter(elementProto, 'id'),
    getChildren: selectorGetter(elementProto, 'children'),
    getParentElement: selectorGetter(nodeProto, 'parentElement'),
    getIsConnected: selectorGetter(nodeProto, 'isConnected'),
    getRootNode: nodeProto.getRootNode,
    getHost: win.ShadowRoot ? selectorGetter(win.ShadowRoot.prototype, 'host') : undefined,
    getListLength: selectorGetter(win.NodeList.prototype, 'length'),
    listItem: win.NodeList.prototype.item,
    getCollectionLength: selectorGetter(win.HTMLCollection.prototype, 'length'),
    collectionItem: win.HTMLCollection.prototype.item,
    Element: win.Element,
    cssEscape: css && typeof css.escape === 'function' ? css.escape : undefined,
  };
}

// CSSOM "serialize an identifier" for environments without CSS.escape (jsdom).
function selectorEscapeFallback(value) {
  const text = String(value);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const ch = text.charAt(i);
    if (code === 0) out += '�';
    else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f || (i === 0 && code >= 0x30 && code <= 0x39)
      || (i === 1 && code >= 0x30 && code <= 0x39 && text.charCodeAt(0) === 0x2d)) out += '\\' + code.toString(16) + ' ';
    else if (i === 0 && text.length === 1 && code === 0x2d) out += '\\' + ch;
    else if (code >= 0x80 || code === 0x2d || code === 0x5f || (code >= 0x30 && code <= 0x39)
      || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) out += ch;
    else out += '\\' + ch;
  }
  return out;
}

export function createSelectorOf({ doc, intrinsics }) {
  const I = intrinsics || captureSelectorIntrinsics(doc.defaultView);
  const call = (fn, self, ...args) => I.apply(fn, self, args);
  const escape = (value) => (I.cssEscape ? call(I.cssEscape, null, String(value)) : selectorEscapeFallback(value));
  const tagOf = (el) => String(call(I.getTagName, el)).toLowerCase();

  // The one element matching `sel`, or null (also for an invalid selector).
  function matchesOnly(sel, el) {
    try {
      const list = call(I.querySelectorAll, doc, sel);
      return call(I.getListLength, list) === 1 && call(I.listItem, list, 0) === el;
    } catch {
      return false;
    }
  }

  function uniqueId(el) {
    const id = call(I.getId, el);
    if (typeof id !== 'string' || id === '') return null;
    const sel = '#' + escape(id);
    return sel.length <= SELECTOR_MAX_CHARS && matchesOnly(sel, el) ? sel : null;
  }

  function uniqueTestAttribute(el) {
    const all = call(I.getElementsByTagName, doc, '*');
    if (call(I.getCollectionLength, all) > SELECTOR_DATA_MAX_ELEMENTS) return null;
    for (const name of SELECTOR_TEST_ATTRIBUTES) {
      const value = call(I.getAttribute, el, name);
      if (value === null || value === undefined) continue;
      const sel = `${escape(tagOf(el))}[${name}="${escape(value)}"]`;
      if (sel.length <= SELECTOR_MAX_CHARS && matchesOnly(sel, el)) return sel;
    }
    return null;
  }

  // `tag` when the element is the only one of its type among siblings, else `tag:nth-of-type(k)`.
  function segment(el, parent) {
    const tag = tagOf(el);
    if (!parent) return escape(tag);
    const siblings = call(I.getChildren, parent);
    const count = call(I.getCollectionLength, siblings);
    let index = 0;
    let same = 0;
    for (let i = 0; i < count; i++) {
      const sibling = call(I.collectionItem, siblings, i);
      if (tagOf(sibling) !== tag) continue;
      same++;
      if (sibling === el) index = same;
    }
    return same > 1 ? `${escape(tag)}:nth-of-type(${index})` : escape(tag);
  }

  function path(el) {
    const parts = [];
    let node = el;
    while (node) {
      const parent = call(I.getParentElement, node);
      if (node !== el) {
        const anchor = uniqueId(node);
        if (anchor) {
          parts.unshift(anchor);
          break;
        }
      }
      parts.unshift(segment(node, parent));
      node = parent;
    }
    // Too long: keep the segments closest to the element (still a valid selector).
    while (parts.length > 1 && parts.join(' > ').length > SELECTOR_MAX_CHARS) parts.shift();
    const sel = parts.join(' > ');
    return sel.length <= SELECTOR_MAX_CHARS ? sel : sel.slice(sel.length - SELECTOR_MAX_CHARS);
  }

  // Element inside a shadow root → its (outermost) host in `doc`; detached or foreign → null.
  function inDocument(el) {
    let node = el;
    for (let depth = 0; depth < 100; depth++) {
      if (!call(I.getIsConnected, node)) return null;
      const root = call(I.getRootNode, node);
      if (root === doc) return node;
      const host = I.getHost ? call(I.getHost, root) : null;
      if (!host) return null;
      node = host;
    }
    return null;
  }

  return function selectorOf(target) {
    try {
      if (!target || !(target instanceof I.Element)) return null;
      const el = inDocument(target);
      if (!el) return null;
      return uniqueId(el) || uniqueTestAttribute(el) || path(el);
    } catch {
      return null;
    }
  };
}
