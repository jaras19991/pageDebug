// Redaction of the page sections (E3 D2, D4): storage, cookies, DOM, environment, performance. Works on the copy made
// by redact() and the context of createRedactionContext() (redact.js); replaces the four sections of `pkg` in place.
// Pure and synchronous: no DOM, no chrome.*. Idempotent: cookies already listed and forms already carrying
// `valueLength` stay as they are.
import { secretKeyRule } from './redact-rules.js';
import { shortHash } from './sha256.js';

const MARKER = /^\[redacted:[a-z0-9_*-]+\]$/;
const FORM_VALUE = '[redacted:form-value]';
const HTML_STRUCTURE = '[redacted:html-structure]';
// The v3 collector replaced password/hidden values with this plain marker; its length says nothing.
const V3_REDACTED = '[redacted]';

const PHONE = Object.freeze({ phone: true });
const STORAGE_AREA = Object.freeze({ phone: true, keep: new Set(['__error']) });
// Keys of the two storage areas in the package (schema keys, not the page API).
const STORAGE_AREAS = new Set(['localStorage', 'sessionStorage']);
// Attributes holding addresses (D3 URL fields; `srcset` has spaces, so it also gets the text pass).
const ATTRIBUTES = Object.freeze({ urlKeys: new Set(['src', 'href', 'action', 'formaction', 'poster', 'srcset']) });
const META_NAMES = ['name', 'property', 'http-equiv'];
const META_URL_NAME = /(?:^|[:_.-])url$/i;
// Split of a URL without a parser (as maskUrl): base, `?query`, `#fragment`.
const URL_PARTS = /^([^?#]*)(\?[^#]*)?(#.*)?$/s;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function put(target, key, value) {
  if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

// ---- storage and cookies ------------------------------------------------------------------------------------------

/** Bytes of `text` in UTF-8 (a lone surrogate counts as the 3-byte replacement character). */
export function utf8Length(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * `document.cookie` → `[{ name, sizeBytes, valueHash }]` (AC-4.4): pairs split by `; ` and the first `=`; a pair
 * without `=` is a cookie with an empty name. `sizeBytes` = UTF-8 bytes of `name=value`, `valueHash` = first 8 hex
 * characters of SHA-256 of the value. Names stay (level "Zostaje"); values never leave this function.
 */
export function parseCookies(cookie) {
  const out = [];
  for (const pair of cookie.split('; ')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const name = eq < 0 ? '' : pair.slice(0, eq);
    const value = eq < 0 ? pair : pair.slice(eq + 1);
    out.push({ name, sizeBytes: utf8Length(pair), valueHash: shortHash(value) });
  }
  return out;
}

function redactStorage(storage, ctx) {
  if (!isObject(storage)) return ctx.plain(storage, PHONE);
  const out = {};
  for (const key of Object.keys(storage)) {
    const value = storage[key];
    if (key === 'cookies') {
      if (typeof value === 'string') {
        put(out, 'cookies', parseCookies(value));
        put(out, 'cookiesTotalBytes', utf8Length(value));
      } else put(out, 'cookies', value);
    } else if (key === 'cookiesTotalBytes') {
      if (!has(out, key)) put(out, key, value);
    } else if (STORAGE_AREAS.has(key)) {
      put(out, key, ctx.keyed(value, STORAGE_AREA));
    } else put(out, key, ctx.plain(value, PHONE));
  }
  return out;
}

// ---- DOM ----------------------------------------------------------------------------------------------------------

// A tag runs to the first `>` outside a quoted attribute (`<input data-x="a>b" value="S1">`, E4-REREVIEW). An unclosed
// quote or tag runs to the end of the text, so every match succeeds from its first `<input`/`<textarea`: no retry from
// the next one, the scan stays linear.
const TAG_REST = String.raw`(?:[^>"']|"[^"]*(?:"|$)|'[^']*(?:'|$))*(?:>|$)`;
const INPUT_TAG = new RegExp(String.raw`<input\b${TAG_REST}`, 'gi');
const VALUE_ATTRIBUTE = /(\svalue\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
// Textarea content is text up to `</textarea` (any case), tags inside included (`<textarea>S3 <b></textarea>`); an
// unclosed textarea runs to the end, as in the browser.
const TEXTAREA = new RegExp(String.raw`(<textarea\b${TAG_REST})([\s\S]*?)(<\/textarea(?=[\s/>])|$)`, 'gi');

// Full HTML (developer option, v3 outerHTML): `value` of inputs and textarea content → form-value, then the text pass.
function redactHtml(html, ctx) {
  if (typeof html !== 'string') return ctx.plain(html);
  let out = html.replace(INPUT_TAG, (tag) => tag.replace(VALUE_ATTRIBUTE, (all, prefix, dq, sq, bare) => {
    const value = dq ?? sq ?? bare;
    if (value === '' || MARKER.test(value)) return all;
    ctx.applied++;
    return `${prefix}"${FORM_VALUE}"`;
  }));
  out = out.replace(TEXTAREA, (all, open, content, close) => {
    if (content.trim() === '' || MARKER.test(content)) return all;
    ctx.applied++;
    return `${open}${FORM_VALUE}${close}`;
  });
  return ctx.text(out);
}

const attributes = (map, ctx) => ctx.keyed(map, ATTRIBUTES);

// `<meta name="csrf-token" content="…">`: the content is masked by the name (D3, AC-3.2).
function redactMetaAttributes(map, ctx) {
  if (!isObject(map)) return attributes(map, ctx);
  let rule = null;
  let isUrl = false;
  for (const key of Object.keys(map)) {
    if (!META_NAMES.includes(key.toLowerCase()) || typeof map[key] !== 'string') continue;
    rule = rule ?? secretKeyRule(map[key]);
    isUrl = isUrl || META_URL_NAME.test(map[key]);
  }
  const out = {};
  for (const key of Object.keys(map)) {
    const value = map[key];
    if (key.toLowerCase() === 'content' && rule !== null) put(out, key, ctx.forced(value, rule));
    else if (key.toLowerCase() === 'content' && isUrl && typeof value === 'string') put(out, key, ctx.urlValue(value));
    else put(out, key, attributes({ [key]: value }, ctx)[key]);
  }
  return out;
}

// `<iframe srcdoc>` is the whole HTML of the frame, texts and field values included (QA E4 F-2): like the page HTML it
// becomes the html-structure marker; only with html-structure off (dom.fullHtml) it is kept, as fullHtml (redactHtml).
function redactFrameAttributes(map, ctx) {
  if (!isObject(map)) return attributes(map, ctx);
  const out = {};
  for (const key of Object.keys(map)) {
    const value = map[key];
    if (key.toLowerCase() !== 'srcdoc' || typeof value !== 'string' || value === '') {
      put(out, key, attributes({ [key]: value }, ctx)[key]);
    } else if (ctx.disabledRules.includes('html-structure')) {
      put(out, key, redactHtml(value, ctx));
    } else if (MARKER.test(value)) {
      put(out, key, value);
    } else {
      ctx.applied++;
      put(out, key, HTML_STRUCTURE);
    }
  }
  return out;
}

// Element summary (meta, scripts, stylesheets, iframes, images): addresses as URLs, attribute maps by key.
function redactElement(el, ctx, kind = null) {
  const map = kind === 'meta' ? redactMetaAttributes : kind === 'iframe' ? redactFrameAttributes : attributes;
  return ctx.fields(el, {
    src: ctx.urlValue,
    href: ctx.urlValue,
    attributes: (value) => map(value, ctx),
  });
}

// Form field: `value` → `valueLength` (none for password); never a value in the package (form-value, spec "Dane").
function redactFormElement(el, ctx) {
  if (!isObject(el)) return ctx.plain(el);
  const password = typeof el.type === 'string' && el.type.toLowerCase() === 'password';
  const out = {};
  for (const key of Object.keys(el)) {
    const value = el[key];
    if (key !== 'value') {
      if (key === 'valueLength' && has(out, key)) continue;
      put(out, key, key === 'valueLength' ? value : ctx.plain(value));
      continue;
    }
    ctx.applied++;
    const known = typeof value === 'string' && value !== V3_REDACTED && !MARKER.test(value);
    if (!password && known && !has(el, 'valueLength')) put(out, 'valueLength', value.length);
  }
  return out;
}

function redactDom(dom, ctx) {
  const list = (fn) => (items) => ctx.list(items, fn);
  return ctx.fields(dom, {
    html: (html) => ctx.fields(html, { outerHTML: (text) => redactHtml(text, ctx) }),
    meta: list((el) => redactElement(el, ctx, 'meta')),
    canonical: ctx.urlValue,
    hreflangs: list((el) => ctx.fields(el, { href: ctx.urlValue })),
    scripts: list((el) => redactElement(el, ctx)),
    stylesheets: list((el) => redactElement(el, ctx)),
    images: list((el) => redactElement(el, ctx)),
    iframes: list((el) => redactElement(el, ctx, 'iframe')),
    forms: list((form) => ctx.fields(form, {
      action: ctx.urlValue,
      elements: list((el) => redactFormElement(el, ctx)),
    })),
    rootMarkers: (markers) => ctx.fields(markers, {
      dataAttributesOnHtml: (map) => attributes(map, ctx),
      dataAttributesOnBody: (map) => attributes(map, ctx),
    }),
    fullHtml: (html) => redactHtml(html, ctx),
  });
}

// ---- environment and performance ----------------------------------------------------------------------------------

// `search` and `hash` follow the masked `href`, so the three always agree (D3).
function redactLocation(location, ctx) {
  if (!isObject(location)) return ctx.plain(location);
  const href = typeof location.href === 'string' ? ctx.urlValue(location.href) : null;
  const parts = href === null ? null : URL_PARTS.exec(href);
  const part = (value) => (value && value.length > 1 ? value : '');
  return ctx.fields(location, {
    href: (value) => (href === null ? ctx.plain(value) : href),
    search: (value) => (parts ? part(parts[2]) : ctx.urlValue(value)),
    hash: (value) => (parts ? part(parts[3]) : ctx.urlValue(value)),
    pathname: ctx.urlValue,
  });
}

function redactEnvironment(environment, ctx) {
  return ctx.fields(environment, {
    location: (location) => redactLocation(location, ctx),
    document: (doc) => ctx.fields(doc, { referrer: ctx.urlValue }),
  });
}

function redactPerformance(performance, ctx) {
  return ctx.fields(performance, {
    navigation: (nav) => ctx.fields(nav, { name: ctx.urlValue }),
    resources: (list) => ctx.list(list, (entry) => ctx.fields(entry, { name: ctx.urlValue })),
  });
}

const SECTIONS = [
  ['environment', redactEnvironment],
  ['performance', redactPerformance],
  ['storage', redactStorage],
  ['dom', redactDom],
];

/**
 * Redacts `environment`, `performance`, `storage` and `dom` of `pkg` in place (keys that are absent stay absent).
 * @param {object} pkg  the copy made by redact()
 * @param {object} ctx  createRedactionContext() of redact.js
 * @returns {object} pkg
 */
export function redactPageSections(pkg, ctx) {
  if (!isObject(pkg)) return pkg;
  for (const [key, fn] of SECTIONS) if (has(pkg, key)) pkg[key] = fn(pkg[key], ctx);
  return pkg;
}
