// The only way the viewer creates DOM (E4 D3, AC-4.5). Everything from a package is untrusted page data:
// children become text nodes, attributes come from a closed list (never on*, href, src, style),
// images are shown only from blob: URLs made here. ESLint forbids innerHTML, setAttribute and friends
// in src/viewer, so a new element kind or attribute is added here, after review, not at the call site.

/** Allowed elements. No a, script, iframe, form, svg: nothing that navigates, runs or loads. */
export const TAGS = Object.freeze([
  'div', 'span', 'p', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'h1', 'h2', 'h3', 'button', 'input', 'select', 'option', 'label', 'img', 'section', 'nav', 'details', 'summary',
]);

/** Allowed attribute names (lower case): a fixed list plus aria-* and data-* with a non-empty suffix. */
export const ATTRS_PATTERN = /^(?:class|id|role|type|hidden|title|value|for|placeholder|aria-[a-z]+|data-[a-z][a-z0-9-]*)$/;

const IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const objectUrls = new Set();

function append(el, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(el, c);
  } else if (typeof child === 'string' || typeof child === 'number' || typeof child === 'bigint') {
    el.append(document.createTextNode(String(child)));
  } else if (child instanceof Node) {
    el.append(child);
  } else {
    throw new TypeError(`h: unsupported child of type ${typeof child}`);
  }
}

/**
 * Creates an element. `attrs` values: string/number set as text, `true` as an empty attribute,
 * `false`/null/undefined omitted. Children: strings and numbers as text nodes, Nodes, nested arrays;
 * null/undefined/false skipped. A tag or attribute outside the lists throws TypeError.
 * @param {string} tag
 * @param {Record<string, string | number | boolean | null | undefined> | null} [attrs]
 * @param {...*} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  if (!TAGS.includes(tag)) throw new TypeError(`h: element <${String(tag).slice(0, 40)}> is not allowed`);
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (!ATTRS_PATTERN.test(name)) throw new TypeError(`h: attribute '${name.slice(0, 40)}' is not allowed`);
    if (value === false || value === null || value === undefined) continue;
    if (value !== true && typeof value !== 'string' && typeof value !== 'number') {
      throw new TypeError(`h: attribute '${name}' must be a string, number or boolean`);
    }
    // eslint-disable-next-line no-restricted-properties -- the one attribute writer; name checked against ATTRS_PATTERN
    el.setAttribute(name, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

/**
 * Shows image bytes in `img` through a blob: URL (CSP `img-src blob:`); the URL is kept for revokeAll().
 * @param {HTMLImageElement} img  created by h('img')
 * @param {Uint8Array | ArrayBuffer} bytes
 * @param {'image/jpeg' | 'image/png' | 'image/webp'} [mime]
 * @returns {string} the blob: URL
 */
export function setImageBytes(img, bytes, mime = 'image/jpeg') {
  if (!(img instanceof HTMLImageElement)) throw new TypeError('setImageBytes: target must be an <img>');
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new TypeError('setImageBytes: bytes must be a Uint8Array or ArrayBuffer');
  if (!IMAGE_TYPES.includes(mime)) throw new TypeError(`setImageBytes: type '${String(mime).slice(0, 40)}' is not allowed`);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  objectUrls.add(url);
  img.src = url;
  return url;
}

/** Revokes every URL made by setImageBytes (when a new package replaces the current one). */
export function revokeAll() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}

/**
 * Long text (DOM structure, full HTML, stacks) as text in a <pre>, cut to `maxChars` with a note.
 * @param {string} text
 * @param {number} [maxChars] default 1 000 000 (D3: full HTML up to 1 MB in the view)
 * @returns {HTMLPreElement}
 */
export function textBlock(text, maxChars = 1_000_000) {
  const value = String(text ?? '');
  if (value.length <= maxChars) return h('pre', { class: 'text-block' }, value);
  let end = maxChars;
  const code = value.charCodeAt(end - 1);
  if (end > 0 && code >= 0xd800 && code <= 0xdbff) end -= 1; // keep a surrogate pair whole
  return h('pre', { class: 'text-block', 'data-truncated': value.length - maxChars },
    value.slice(0, end),
    h('span', { class: 'truncated' }, `\n… ucięto — pokazano ${maxChars} z ${value.length} znaków`));
}
