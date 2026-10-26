// DOM structure without texts for the package (design D5, E3-T3a, AC-5.2, AC-5.3).
// A walker over elements in document order that never materializes outerHTML: it emits tags, a whitelist of
// attributes (id, class, role, data-*, aria-* except those that can carry user text, `type` on input/button) and no
// text, comments, script/style/template/noscript content or field values. Every DOM read goes through getters
// captured at document_start, so later page patches (getAttribute, attributes, tagName, …) cannot change the result;
// a page can at most fake the structure, never leak through it (tag names are checked against [a-z][a-z0-9-]*).
// Output stops before `maxChars` with all open tags closed, so it always parses (`truncated`, `omittedElements`).
// `full` mode (developer option `html-structure` off) adds text nodes and all attributes except input `value`.
// Shadow DOM and iframe documents are not walked (host/tag only). Top-level helpers carry the `dom` prefix (D6).

import { redactRegExp, redactReplace, redactTest } from '../lib/redact-rules.js';

export const DOM_STRUCTURE_MAX_CHARS = 300000;
export const DOM_FULL_MAX_CHARS = 8000000;
export const DOM_ELEMENT_STRUCTURE_MAX_CHARS = 2000;

// One attribute value (escaped size grows on top) and one attribute name.
const DOM_ATTR_VALUE_MAX_CHARS = 2000;
const DOM_ATTR_NAME_MAX_CHARS = 256;
// Safety stop for the walk that counts omitted elements after a cut.
const DOM_COUNT_MAX_NODES = 2000000;

// Regexes are used through the redact* helpers, safe from page-replaced String/RegExp built-ins (AC-3.6).
const DOM_TAG_RE = redactRegExp(/^[a-z][a-z0-9-]*$/);
const DOM_DATA_ATTR_RE = redactRegExp(/^data-[a-z0-9_.:-]+$/);
const DOM_ARIA_ATTR_RE = redactRegExp(/^aria-[a-z]+$/);
// Any attribute name that serializes safely (full mode): no whitespace, quotes, `<>/=` or control characters.
const DOM_ANY_ATTR_RE = redactRegExp(/^[^\s"'<>/=\p{Cc}]+$/u);
const DOM_ATTR_ESCAPES = redactRegExp(/[&"<]/g);
const DOM_TEXT_ESCAPES = redactRegExp(/[&<>]/g);
const DOM_RAW_END = redactRegExp(/<\//g);
const DOM_ENTITIES = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' };
const domEntity = (ch) => DOM_ENTITIES[ch];
const DOM_ARIA_TEXT = ['aria-label', 'aria-valuetext', 'aria-description', 'aria-placeholder'];
const DOM_TYPE_TAGS = ['input', 'button'];
const DOM_VOID = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'];
// Structure mode: the tag stays (nth-of-type keeps matching), the content does not.
const DOM_NO_CONTENT = ['script', 'style', 'template', 'noscript'];
// Full mode: raw text elements, their text goes out unescaped (only `</` is broken so the element cannot end early).
const DOM_RAW_TEXT = ['script', 'style'];

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;

function domGetter(ctor, name) {
  try {
    const desc = Object.getOwnPropertyDescriptor(ctor.prototype, name);
    return desc && typeof desc.get === 'function' ? desc.get : undefined;
  } catch {
    return undefined;
  }
}

// Getters the walker uses, captured before page scripts run (D5).
export function captureDomIntrinsics(win) {
  return {
    apply: Reflect.apply,
    getLocalName: domGetter(win.Element, 'localName'),
    getAttributes: domGetter(win.Element, 'attributes'),
    getFirstElementChild: domGetter(win.Element, 'firstElementChild'),
    getNextElementSibling: domGetter(win.Element, 'nextElementSibling'),
    getFirstChild: domGetter(win.Node, 'firstChild'),
    getNextSibling: domGetter(win.Node, 'nextSibling'),
    getNodeType: domGetter(win.Node, 'nodeType'),
    getData: domGetter(win.CharacterData, 'data'),
    getDocumentElement: domGetter(win.Document, 'documentElement'),
    getMapLength: domGetter(win.NamedNodeMap, 'length'),
    mapItem: win.NamedNodeMap.prototype.item,
    getAttrName: domGetter(win.Attr, 'name'),
    getAttrValue: domGetter(win.Attr, 'value'),
  };
}

function domEscapeAttr(value) {
  return redactReplace(value, DOM_ATTR_ESCAPES, domEntity);
}

function domEscapeText(value) {
  return redactReplace(value, DOM_TEXT_ESCAPES, domEntity);
}

function domEmpty(truncated) {
  return { html: '', truncated, omittedElements: 0, elements: 0 };
}

// { html, truncated, omittedElements, elements } of `root` (an element, or a document → its documentElement).
// Never throws: a failing DOM read gives an empty result with `truncated: true`.
export function serializeDom(root, { mode = 'structure', maxChars = DOM_STRUCTURE_MAX_CHARS, intrinsics } = {}) {
  if (!root || typeof root !== 'object') return domEmpty(false);
  try {
    const I = intrinsics || captureDomIntrinsics(root.ownerDocument ? root.ownerDocument.defaultView : root.defaultView);
    return domWalk(root, mode === 'full', Math.max(0, Number(maxChars) || 0), I);
  } catch {
    return domEmpty(true);
  }
}

function domWalk(root, full, maxChars, I) {
  const call = (fn, self) => I.apply(fn, self, []);
  const nodeType = (node) => call(I.getNodeType, node);
  let start = root;
  if (nodeType(start) === DOCUMENT_NODE) start = call(I.getDocumentElement, start);
  if (!start || nodeType(start) !== ELEMENT_NODE) return domEmpty(false);

  const first = full ? (node) => call(I.getFirstChild, node) : (node) => call(I.getFirstElementChild, node);
  const next = full ? (node) => call(I.getNextSibling, node) : (node) => call(I.getNextElementSibling, node);
  // Lower-cased local name, or null when it is not a plain tag name.
  const tagOf = (el) => {
    const name = String(call(I.getLocalName, el)).toLowerCase();
    return name.length <= DOM_ATTR_NAME_MAX_CHARS && redactTest(DOM_TAG_RE, name) ? name : null;
  };

  function keepAttr(tag, name) {
    if (full) return redactTest(DOM_ANY_ATTR_RE, name) && !(name === 'value' && tag === 'input');
    if (name === 'id' || name === 'class' || name === 'role') return true;
    if (name === 'type') return DOM_TYPE_TAGS.includes(tag);
    if (redactTest(DOM_DATA_ATTR_RE, name)) return true;
    return redactTest(DOM_ARIA_ATTR_RE, name) && !DOM_ARIA_TEXT.includes(name);
  }

  function openTag(el, tag) {
    let out = '<' + tag;
    const attrs = call(I.getAttributes, el);
    const count = attrs ? call(I.getMapLength, attrs) : 0;
    for (let i = 0; i < count; i++) {
      const attr = I.apply(I.mapItem, attrs, [i]);
      if (!attr) continue;
      const name = String(call(I.getAttrName, attr)).toLowerCase();
      if (name.length > DOM_ATTR_NAME_MAX_CHARS || !keepAttr(tag, name)) continue;
      const value = String(call(I.getAttrValue, attr)).slice(0, DOM_ATTR_VALUE_MAX_CHARS);
      out += ' ' + name + '="' + domEscapeAttr(value) + '"';
    }
    return out + '>';
  }

  // Text of a raw text element (full mode), with `</` broken up.
  function rawText(el) {
    let text = '';
    for (let child = call(I.getFirstChild, el); child; child = call(I.getNextSibling, child)) {
      if (nodeType(child) === TEXT_NODE) text += String(call(I.getData, child));
      if (text.length > maxChars) break;
    }
    return redactReplace(text, DOM_RAW_END, '<\\/');
  }

  const parts = [];
  // Length of everything emitted, and of the closing tags still owed to the open elements.
  let length = 0;
  let closing = 0;
  let elements = 0;
  let truncated = false;
  const stack = [];
  const fits = (extra) => length + extra + closing <= maxChars;
  const emit = (text) => {
    parts.push(text);
    length += text.length;
  };

  // Next node after `node` in document order; closes the elements it leaves. null after the root.
  function advance(node) {
    let current = node;
    while (current !== start) {
      const sibling = next(current);
      if (sibling) return sibling;
      const frame = stack.pop();
      closing -= frame.close.length;
      emit(frame.close);
      current = frame.el;
    }
    return null;
  }

  let node = start;
  while (node) {
    const type = nodeType(node);
    if (type === TEXT_NODE) {
      const text = domEscapeText(String(call(I.getData, node)).slice(0, maxChars + 1));
      if (!fits(text.length)) {
        truncated = true;
        break;
      }
      emit(text);
      node = advance(node);
      continue;
    }
    const tag = type === ELEMENT_NODE ? tagOf(node) : null;
    if (!tag) {
      // Comments, processing instructions, odd tag names (with their subtree).
      node = advance(node);
      continue;
    }
    const open = openTag(node, tag);
    const isVoid = DOM_VOID.includes(tag);
    const close = isVoid ? '' : '</' + tag + '>';
    let inner = '';
    if (!isVoid && full && DOM_RAW_TEXT.includes(tag)) inner = rawText(node);
    if (!fits(open.length + inner.length + close.length)) {
      truncated = true;
      break;
    }
    emit(open);
    elements++;
    const childless = isVoid || (full ? DOM_RAW_TEXT.includes(tag) : DOM_NO_CONTENT.includes(tag));
    const child = childless ? null : first(node);
    if (!child) {
      emit(inner + close);
      node = node === start ? null : advance(node);
      continue;
    }
    stack.push({ el: node, close });
    closing += close.length;
    node = child;
  }

  while (stack.length > 0) emit(stack.pop().close);
  const omittedElements = truncated ? Math.max(0, domCountElements(start, full, I, tagOf) - elements) : 0;
  return { html: parts.join(''), truncated, omittedElements, elements };
}

// Elements the walker would emit without a limit (same skip rules), for `omittedElements` after a cut.
function domCountElements(start, full, I, tagOf) {
  const call = (fn, self) => I.apply(fn, self, []);
  const skipContent = full ? DOM_RAW_TEXT : DOM_NO_CONTENT;
  let count = 0;
  let visited = 0;
  const stack = [start];
  while (stack.length > 0 && visited < DOM_COUNT_MAX_NODES) {
    const el = stack.pop();
    visited++;
    const tag = tagOf(el);
    if (!tag) continue;
    count++;
    if (DOM_VOID.includes(tag) || skipContent.includes(tag)) continue;
    for (let child = call(I.getFirstElementChild, el); child; child = call(I.getNextElementSibling, child)) stack.push(child);
  }
  return count;
}

// Structure of one element (console arguments, D5): same walker, ≤ maxChars, '' for non-elements.
export function elementStructure(el, maxChars = DOM_ELEMENT_STRUCTURE_MAX_CHARS, intrinsics) {
  const result = serializeDom(el, { mode: 'structure', maxChars, intrinsics });
  return result.html;
}
