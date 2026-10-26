// Rectangles of editable fields for the screenshot mask (design D6, E3-IN1a, AC-2.2, gate decision PB-1 = B).
// Runs in the ISOLATED world: same DOM as the page, own (unpatchable) DOM prototypes, no page JS. Answers the
// background's `fieldRects` without MAIN. Fields (spec question 2): `input` except button/submit/reset/checkbox/radio/
// range/color/image/hidden, `textarea`, `select`, contenteditable hosts — also in open shadow roots, closed ones through
// the injected `openShadowRoot` (chrome.dom.openOrClosedShadowRoot / Element.openOrClosedShadowRoot) and same-origin
// iframes (2 levels; deeper frames are masked whole). Cross-origin frames are skipped and counted (PB-1 = B); the visible
// ones separately in `frames.crossOriginVisible` (store review S1).
// Rectangles are in CSS px of the top viewport, clipped to it; above FIELD_RECTS_MAX the whole viewport is masked.
// Frame content offset = frame rect + clientLeft/Top + padding-left/top (content box, spike S0); `viewport.vvScale`
// (pinch zoom) lets the background refuse a mask it cannot place.
// Never throws: any failure gives `{ ok: false, reason }`, so the background drops the screenshot (fail-closed, AC-2.4).

export const FIELD_RECTS_MAX = 2000;

// Same-origin frame documents walked below the top document; a deeper frame is one rectangle.
const FIELD_FRAME_DEPTH = 2;
// Nested shadow roots walked per document.
const FIELD_SHADOW_DEPTH = 32;
const FIELD_REASON_MAX_CHARS = 120;
// Smallest cross-origin frame that counts as seen by the reporter (store review S1), CSS px.
const FIELD_FRAME_MIN_W = 40;
const FIELD_FRAME_MIN_H = 20;

const FIELD_SELECTOR = 'input, textarea, select, [contenteditable]';
const FIELD_INPUT_SKIP = ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'image', 'hidden'];
const FIELD_EDITABLE_FLAGS = ['', 'true', 'plaintext-only'];

function fieldTag(el) {
  return String(el.localName || '').toLowerCase();
}

function fieldEditable(el) {
  if (!el) return false;
  if (typeof el.isContentEditable === 'boolean') return el.isContentEditable;
  // Environments without isContentEditable (jsdom): the attribute decides.
  const flag = el.getAttribute ? el.getAttribute('contenteditable') : null;
  return flag !== null && FIELD_EDITABLE_FLAGS.includes(String(flag).toLowerCase());
}

function fieldIsMasked(el) {
  const tag = fieldTag(el);
  if (tag === 'input') return !FIELD_INPUT_SKIP.includes(String(el.type).toLowerCase());
  if (tag === 'textarea' || tag === 'select') return true;
  // Contenteditable: only the host; editable descendants are inside its rectangle.
  return fieldEditable(el) && !fieldEditable(el.parentElement);
}

// Intersection of two { x, y, w, h } boxes, or null when empty.
function fieldClip(rect, box) {
  const x = Math.max(rect.x, box.x);
  const y = Math.max(rect.y, box.y);
  const right = Math.min(rect.x + rect.w, box.x + box.w);
  const bottom = Math.min(rect.y + rect.h, box.y + box.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}

function fieldBox(el, dx, dy) {
  const r = el.getBoundingClientRect();
  const box = { x: Number(r.left) + dx, y: Number(r.top) + dy, w: Number(r.width), h: Number(r.height) };
  if (![box.x, box.y, box.w, box.h].every(Number.isFinite)) throw new Error('bad rect');
  return box;
}

// Accessible document of a frame, or null (cross-origin: contentDocument is null or throws).
function fieldFrameDocument(frame) {
  try {
    return frame.contentDocument || null;
  } catch {
    return null;
  }
}

function fieldViewportScale(win) {
  const vv = win.visualViewport;
  const scale = vv ? Number(vv.scale) : 1;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

// padding-left/top of a frame from its own window's computed style (content box offset, spike S0).
function fieldPadding(frame, win) {
  const owner = frame.ownerDocument && frame.ownerDocument.defaultView;
  const view = owner && typeof owner.getComputedStyle === 'function' ? owner : win;
  if (!view || typeof view.getComputedStyle !== 'function') return { left: 0, top: 0 };
  const style = view.getComputedStyle(frame);
  return { left: parseFloat(style.paddingLeft) || 0, top: parseFloat(style.paddingTop) || 0 };
}

// A cross-origin frame the reporter can see (store review S1): its box crosses the visible area, it is at least
// FIELD_FRAME_MIN_W × FIELD_FRAME_MIN_H CSS px and its computed style does not hide it. Off-screen ads, 1×1 pixels and
// invisible reCAPTCHA do not count. Anything that cannot be read counts as visible (fail-closed: the screenshot default
// goes off). Opacity of ancestors is not checked.
function fieldFrameVisible(frame, dx, dy, clip, win) {
  try {
    const box = fieldBox(frame, dx, dy);
    if (box.w < FIELD_FRAME_MIN_W || box.h < FIELD_FRAME_MIN_H || !fieldClip(box, clip)) return false;
    const owner = frame.ownerDocument && frame.ownerDocument.defaultView;
    const view = owner && typeof owner.getComputedStyle === 'function' ? owner : win;
    if (!view || typeof view.getComputedStyle !== 'function') return true;
    const style = view.getComputedStyle(frame);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    const opacity = parseFloat(style.opacity);
    return !(Number.isFinite(opacity) && opacity <= 0);
  } catch {
    return true;
  }
}

// `openShadowRoot` for collectFieldRects, by feature detection (spike S0): Chrome `chrome.dom.openOrClosedShadowRoot(el)`;
// Firefox a getter on Element.prototype — detected with `in` (reading it off the prototype throws) and read per element.
// undefined when neither exists (open shadow roots only).
export function resolveOpenShadowRoot({ api, win } = {}) {
  const dom = api && api.dom;
  if (dom && typeof dom.openOrClosedShadowRoot === 'function') return (el) => dom.openOrClosedShadowRoot(el);
  const proto = win && win.Element && win.Element.prototype;
  if (proto && 'openOrClosedShadowRoot' in proto) return (el) => el.openOrClosedShadowRoot;
  return undefined;
}

export function collectFieldRects({ win, doc, openShadowRoot } = {}) {
  try {
    const viewport = {
      innerWidth: Number(win.innerWidth),
      innerHeight: Number(win.innerHeight),
      scrollX: Number(win.scrollX),
      scrollY: Number(win.scrollY),
      dpr: Number(win.devicePixelRatio) || 1,
      vvScale: fieldViewportScale(win),
    };
    if (!(viewport.innerWidth > 0 && viewport.innerHeight > 0)) return { ok: false, reason: 'no-viewport' };
    const view = { x: 0, y: 0, w: viewport.innerWidth, h: viewport.innerHeight };
    const rects = [];
    // crossOriginVisible: the part of crossOrigin the reporter can see; the popup turns the screenshot off by it.
    const frames = { sameOrigin: 0, crossOrigin: 0, crossOriginVisible: 0 };
    let overflow = false;

    const add = (box, clip) => {
      const visible = fieldClip(box, clip);
      if (!visible) return;
      if (rects.length >= FIELD_RECTS_MAX) {
        overflow = true;
        return;
      }
      rects.push(visible);
    };

    const shadowOf = (el) => {
      if (typeof openShadowRoot === 'function') {
        try {
          const root = openShadowRoot(el);
          if (root) return root;
        } catch {
          // fall back to the open root
        }
      }
      return el.shadowRoot || null;
    };

    // One document: its tree plus shadow roots; frames recurse with their offset and clip box.
    function walkDocument(document, dx, dy, clip, depth) {
      const roots = [{ root: document, level: 0 }];
      while (roots.length > 0 && !overflow) {
        const { root, level } = roots.pop();
        for (const el of root.querySelectorAll(FIELD_SELECTOR)) {
          if (fieldIsMasked(el)) add(fieldBox(el, dx, dy), clip);
        }
        for (const el of root.querySelectorAll('*')) {
          const tag = fieldTag(el);
          if (tag === 'iframe' || tag === 'frame') walkFrame(el, dx, dy, clip, depth);
          if (level < FIELD_SHADOW_DEPTH) {
            const shadow = shadowOf(el);
            if (shadow) roots.push({ root: shadow, level: level + 1 });
          }
        }
      }
    }

    function walkFrame(frame, dx, dy, clip, depth) {
      const inner = fieldFrameDocument(frame);
      if (!inner) {
        frames.crossOrigin++;
        if (fieldFrameVisible(frame, dx, dy, clip, win)) frames.crossOriginVisible++;
        return;
      }
      frames.sameOrigin++;
      const box = fieldBox(frame, dx, dy);
      const frameClip = fieldClip(box, clip);
      if (!frameClip) return;
      if (depth >= FIELD_FRAME_DEPTH) {
        add(box, clip);
        return;
      }
      const padding = fieldPadding(frame, win);
      const left = box.x + (Number(frame.clientLeft) || 0) + padding.left;
      const top = box.y + (Number(frame.clientTop) || 0) + padding.top;
      walkDocument(inner, left, top, frameClip, depth + 1);
    }

    walkDocument(doc, 0, 0, view, 0);
    if (overflow) return { ok: true, viewport, rects: [view], frames, overflow: true };
    return { ok: true, viewport, rects, frames, overflow: false };
  } catch (error) {
    const name = error && typeof error.name === 'string' ? error.name : 'Error';
    return { ok: false, reason: ('exception: ' + name).slice(0, FIELD_REASON_MAX_CHARS) };
  }
}
