// Redaction rules, `rulesVersion: 1` (E3 D3; skill privacy-redaction). Text-level functions used by redact.js in the
// background, by the console fallback and, through mask-secrets.js, by the hooks in MAIN. Pure, synchronous,
// idempotent, no DOM and no imports. Every regex is created once at module load (a redactRegExp pair) and is linear: no nested
// quantifiers over overlapping classes, and runs start only at a run boundary (look-behind on the run class).
// A masked value becomes `[redacted:<rule>]`; values that already are a marker are skipped, so a second pass
// changes nothing and reports `applied: 0`.

export const RULES_VERSION = 1;

// Intrinsics captured at module load (AC-3.6): in MAIN the bundle loads on document_start, before page scripts,
// and a page may later replace String.prototype.replace/split or RegExp.prototype members. Regexes are used only
// through redactReplace/redactSplit/redactTest/redactExec, which call the captured RegExp functions, never
// String.prototype. Every regex is a pair: the plain one keeps V8's fast path while RegExp.prototype is untouched
// (those functions look up `exec` and the flag getters on it); after a change the twin is used, a RedactRegExp whose
// prototype pins the original members (its @@split builds the splitter through the species constructor, so the
// splitter is a RedactRegExp too). The twin is about 2x slower, so it is kept for patched pages only.
const REDACT_APPLY = Reflect.apply;
const REDACT_PROTO = RegExp.prototype;
const REDACT_SYMBOL_REPLACE = Symbol.replace;
const REDACT_SYMBOL_SPLIT = Symbol.split;
const REDACT_EXEC = REDACT_PROTO.exec;
const REDACT_TEST = REDACT_PROTO.test;
const REDACT_REPLACE = REDACT_PROTO[REDACT_SYMBOL_REPLACE];
const REDACT_SPLIT = REDACT_PROTO[REDACT_SYMBOL_SPLIT];
// String methods a page may replace too (review E3 F9): key names and cuts go through these.
const REDACT_STRING_SLICE = String.prototype.slice;
const REDACT_STRING_LOWER = String.prototype.toLowerCase;
const REDACT_STRING_LAST_INDEX = String.prototype.lastIndexOf;

class RedactRegExp extends RegExp {
  static get [Symbol.species]() {
    return RedactRegExp;
  }
}
for (const key of Reflect.ownKeys(REDACT_PROTO)) {
  if (key !== 'constructor') Object.defineProperty(RedactRegExp.prototype, key, Object.getOwnPropertyDescriptor(REDACT_PROTO, key));
}

function redactPick(pair) {
  const p = REDACT_PROTO;
  return p.exec === REDACT_EXEC && p.test === REDACT_TEST && p[REDACT_SYMBOL_REPLACE] === REDACT_REPLACE
    && p[REDACT_SYMBOL_SPLIT] === REDACT_SPLIT ? pair.plain : pair.twin;
}

/** Regex pair for the redact* helpers (same source and flags); create it at module load. */
export function redactRegExp(re) {
  return Object.freeze({ plain: re, twin: new RedactRegExp(re) });
}

/** `text.replace(re, replacement)` for a redactRegExp pair, safe from page-replaced built-ins. */
export function redactReplace(text, pair, replacement) {
  return REDACT_APPLY(REDACT_REPLACE, redactPick(pair), [text, replacement]);
}

/** `text.split(re)` for a redactRegExp pair. */
export function redactSplit(text, pair) {
  return REDACT_APPLY(REDACT_SPLIT, redactPick(pair), [text]);
}

/** `re.test(text)` for a redactRegExp pair (non-global). */
export function redactTest(pair, text) {
  return REDACT_APPLY(REDACT_TEST, redactPick(pair), [text]);
}

/** `re.exec(text)` for a redactRegExp pair (non-global). */
export function redactExec(pair, text) {
  return REDACT_APPLY(REDACT_EXEC, redactPick(pair), [text]);
}

// `re.exec(text)` from `from` for a global or sticky pair: the next match at or after `from`, or null.
function redactExecAt(pair, text, from) {
  const re = redactPick(pair);
  re.lastIndex = from;
  return REDACT_APPLY(REDACT_EXEC, re, [text]);
}

/** `text.slice(start, end)` with the String.prototype.slice captured at load. */
export function redactSlice(text, start, end) {
  return REDACT_APPLY(REDACT_STRING_SLICE, text, end === undefined ? [start] : [start, end]);
}

function redactLastIndex(text, search, from) {
  return REDACT_APPLY(REDACT_STRING_LAST_INDEX, text, from === undefined ? [search] : [search, from]);
}

/** `text.toLowerCase()` with the method captured at load. */
export function redactLower(text) {
  return REDACT_APPLY(REDACT_STRING_LOWER, text, []);
}

// Rules the developer cannot turn off; `key-*` stands for every `key-<token>` rule.
export const ALWAYS_RULES = Object.freeze([
  'key-*', 'jwt', 'bearer', 'basic', 'card', 'iban', 'pesel', 'long-secret', 'url-credentials', 'url-fragment', 'form-value',
]);
// Rules a developer option may turn off (never the reporter). `html-structure` off means `dom.fullHtml` (D5).
export const DEFAULT_RULES = Object.freeze(['email', 'phone', 'html-structure']);

export const MASK_LIMITS = Object.freeze({
  // maskSecrets (MAIN previews) cuts longer input before masking: an unmasked tail must never pass through.
  inputChars: 65536,
  keyChars: 256,
});

// Skill privacy-redaction, "Klucze". The first token found in a key names the rule: `access_token` → key-token.
const SECRET_KEYS = Object.freeze([
  'token', 'access_token', 'refresh_token', 'id_token', 'auth', 'authorization', 'session', 'sessionid', 'sid', 'jwt',
  'secret', 'api_key', 'apikey', 'key', 'password', 'passwd', 'pwd', 'csrf', 'xsrf', 'cookie', 'set-cookie', 'bearer',
  'credential', 'private', 'signature', 'sig', 'otp', 'pin', 'cvv', 'cvc', 'pass',
]);
// Too short to be a word of a longer key: only the whole name counts (`pw`, not `new_pw`).
const WHOLE_KEYS = Object.freeze(['pw']);
// Sensitive only as a query or fragment parameter of a URL (OAuth authorization code, CAS ticket); in text and JSON
// they are ordinary words (`{"code":"PL"}`).
const URL_KEYS = Object.freeze(['code', 'ticket']);

// Word boundaries in a key: start/end, `_`, `-`, `.`, white space or brackets (`user[password]`).
const KEY_EDGE = '[_\\-.\\s\\[\\]]';
const KEY_ESCAPE = redactRegExp(/[.-]/g);
const CAMEL_CASE = redactRegExp(/([a-z0-9])([A-Z])/g);
const KEY_MATCHERS = SECRET_KEYS.map((token) => ({
  token,
  re: redactRegExp(new RegExp(`(?:^|${KEY_EDGE})${redactReplace(token, KEY_ESCAPE, '\\$&')}(?:$|${KEY_EDGE})`)),
}));
// Session cookies named by servers without a word boundary: JSESSIONID, PHPSESSID.
const SESSION_SUFFIX = redactRegExp(/(?:sessid|sessionid)$/);

const MARKER = redactRegExp(/^\[redacted:[a-z0-9_*-]+\]$/);
const MARKER_START = redactRegExp(/^\[redacted:[a-z0-9_*-]+\]/);

/**
 * Rule for a key/parameter/header/attribute name: `key-<token>` when the name contains a token from the skill
 * list as a word (camelCase counts as words), `key-session` for a `sessid`/`sessionid` suffix, otherwise null.
 */
export function secretKeyRule(name) {
  if (typeof name !== 'string' || name === '' || name.length > MASK_LIMITS.keyChars) return null;
  const key = redactLower(redactReplace(name, CAMEL_CASE, '$1_$2'));
  for (const { token, re } of KEY_MATCHERS) if (redactTest(re, key)) return `key-${token}`;
  const lower = redactLower(name);
  if (redactTest(SESSION_SUFFIX, lower)) return 'key-session';
  for (const token of WHOLE_KEYS) if (lower === token) return `key-${token}`;
  return null;
}

/** secretKeyRule for a query or fragment parameter of a URL: also `code` and `ticket` as the whole name. */
export function urlKeyRule(name) {
  const rule = secretKeyRule(name);
  if (rule !== null || typeof name !== 'string') return rule;
  const lower = redactLower(name);
  for (const token of URL_KEYS) if (lower === token) return `key-${token}`;
  return null;
}

// ---- validators -------------------------------------------------------------------------------------------------

/** Luhn checksum of a digit string. */
export function luhn(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

// Card issuer prefixes (IIN): Visa 4, Mastercard 51-55 and 22-27, Amex 34/37, Discover/UnionPay/Maestro 6.
const CARD_IIN = redactRegExp(/^(?:4|5[1-5]|2[2-7]|3[47]|6)/);

const PESEL_DIGITS = redactRegExp(/^\d{11}$/);
const SPACES = redactRegExp(/ /g);
const IBAN_SHAPE = redactRegExp(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/);
const PESEL_WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
/** PESEL: 11 digits, checksum and a month valid for one of the century codes (+0, +20, +40, +60, +80). */
export function peselValid(digits) {
  if (!redactTest(PESEL_DIGITS, digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += PESEL_WEIGHTS[i] * (digits.charCodeAt(i) - 48);
  if ((10 - (sum % 10)) % 10 !== digits.charCodeAt(10) - 48) return false;
  const month = Number(redactSlice(digits, 2, 4)) % 20;
  const day = Number(redactSlice(digits, 4, 6));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** IBAN mod-97 (spaces allowed). */
export function ibanValid(iban) {
  const s = redactReplace(String(iban), SPACES, '');
  if (!redactTest(IBAN_SHAPE, s)) return false;
  const moved = redactSlice(s, 4) + redactSlice(s, 0, 4);
  let rest = 0;
  for (const ch of moved) {
    const code = ch.charCodeAt(0);
    const value = code >= 65 ? String(code - 55) : ch;
    for (const digit of value) rest = (rest * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return rest === 1;
}

/** Shannon entropy in bits per character. */
export function shannon(text) {
  const counts = new Map();
  for (const ch of text) counts.set(ch, (counts.get(ch) || 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

// ---- key/value forms ----------------------------------------------------------------------------------------------

// `"key":` at any level of escaping (review E3 F1): JSON in a JSON string repeats the quote with backslashes
// (`\"k\":\"v\"`, `\\\"k\\\":…`), an HTML attribute encodes it (`&quot;k&quot;`, `&#34;`, `&#x22;`). The key quote is
// captured and the value must open with the same one; the value itself is scanned by maskQuotedValue (not a regex), so
// it may also be unclosed (a cut, F2). The value of a key that is not sensitive is scanned for nested pairs.
const QUOTE = '(?:"|&quot;|&#0*34;|&#[xX]0*22;)';
const QUOTED_KEY = redactRegExp(new RegExp(`(?<!\\\\)(\\\\*)(${QUOTE})([^"\\\\\\n&]{1,256})\\1\\2(\\s*:\\s*)`, 'g'));
// `key: "value"` and `'key': "value"` (F3: JS objects, YAML), at any level of escaping of the value quote.
const BARE_KEY = redactRegExp(new RegExp(`(?<![\\w.\\-[\\]"'])('?)([A-Za-z_][\\w.\\-[\\]]{0,255})\\1[ \\t]*:[ \\t]*(?=\\\\*${QUOTE})`, 'g'));
const QUOTE_AT = redactRegExp(new RegExp(QUOTE, 'y'));
const BACKSLASHES_AT = redactRegExp(/\\*/y);
// `"key": 123` / `true` / `false` (E3-IN2), also cut at the end of the text; null stays (nothing there).
const SCALAR_AT = redactRegExp(/(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false)(?=\s*(?:[,}\]\\&]|$))/y);
// The note a MAIN cut appends (`safeSlice`, network bodies): pairs are matched before it, so a value cut there is unclosed.
const TRUNCATED_TAIL = redactRegExp(/\.\.\. \[truncated \d+ chars\]$/);
// `<key attr…>value</key>`, optional namespace prefix; the closing tag must match.
const XML_ELEMENT = redactRegExp(/<((?:[A-Za-z_][\w.-]{0,63}:)?([A-Za-z_][\w.-]{0,255}))(\s[^<>]{0,2048})?>([^<]+)<\/\1>/g);
// `key="value"`, `key='value'` and JSON-escaped `key=\"value\"` (attributes in HTML and DOM structure).
const ATTRIBUTE = redactRegExp(/(?<![\w.:[\]-])([A-Za-z_][\w.:[\]-]{0,255})=(?:"([^"\\\n]*)"|'([^'\\\n]*)'|\\"([^"\\\n]*)\\")/g);
// The same, and an XML element, cut at the end of the text (F2): the value runs to the end.
const ATTRIBUTE_OPEN_END = redactRegExp(/(?<![\w.:[\]-])([A-Za-z_][\w.:[\]-]{0,255})=(\\?["'])([^"'\n]+)$/);
const XML_OPEN_END = redactRegExp(/<((?:[A-Za-z_][\w.-]{0,63}:)?([A-Za-z_][\w.-]{0,255}))(\s[^<>]{0,2048})?>([^<]+)(<\/?[\w.:-]*)?$/);
// The same element with `<` (and `>`) as entities (review E3 N4): XML in an attribute or a text node of dom.structure
// (`&lt;password>x&lt;/password>`), also cut at the end of the text. The value ends at the next `<` or `&lt;`.
const XML_LT = '(?:&lt;|&#0*60;)';
const XML_GT = '(?:>|&gt;|&#0*62;)';
const XML_ENTITY_VALUE = '((?:[^<&]|&(?!lt;|#0*60;))+)';
const XML_ENTITY_TAG = '((?:[A-Za-z_][\\w.-]{0,63}:)?([A-Za-z_][\\w.-]{0,255}))(\\s[^<>&]{0,2048})?';
const XML_ENTITY_ELEMENT = redactRegExp(new RegExp(`(${XML_LT})${XML_ENTITY_TAG}(${XML_GT})${XML_ENTITY_VALUE}${XML_LT}\\/\\2${XML_GT}`, 'g'));
const XML_ENTITY_OPEN_END = redactRegExp(new RegExp(`(${XML_LT})${XML_ENTITY_TAG}(${XML_GT})${XML_ENTITY_VALUE}(${XML_LT}\\/?[\\w.:-]*)?$`));
// `key=value` in forms, query strings, fragments and plain text; the value ends at `&`, `#`, white space,
// a quote, a backslash (escaped quote inside a JSON string), `;`, `,`, `<` or `>`.
const FORM_PAIR = redactRegExp(/(?<![A-Za-z0-9_.\-[\];])([A-Za-z0-9_.\-[\]]{1,256})=([^&#\s"'\\;,<>]+)/g);
// `;key=value` (a path parameter like `;jsessionid=`, or a cookie list without spaces): the value also ends at `?` (F8).
const PATH_PAIR = redactRegExp(/(?<=;)([A-Za-z0-9_.\-[\]]{1,256})=([^&#\s"'\\;,<>?]+)/g);
// `key: value` (E3-IN2): unquoted or single-quoted key; the value ends at the line end, `,`, `;` or `}`.
const COLON_PAIR = redactRegExp(/(?<![\w.\-[\]"'])('?)([A-Za-z_][\w.\-[\]]{0,255})\1[ \t]*:[ \t]*(?!\/\/)([^\s"\\,;}][^\n\r"\\,;}]*)/g);
// `Cookie: a=1; b=2` and `Set-Cookie: …`: a cookie list has `;` inside, so the value runs to the line end.
const COOKIE_LINE = redactRegExp(/(?<![\w.\-[\]"'])('?)([\w.\-[\]]{0,200}cookie)\1[ \t]*:[ \t]*([^\s"\\][^\n\r"\\]*)/gi);
const TRAILING_BLANKS = redactRegExp(/[ \t]+$/);

// Length of the quote token (`"`, `&quot;`, `&#34;`, `&#x22;`) at `i`, 0 when there is none.
function quoteLengthAt(text, i) {
  const ch = text[i];
  if (ch === '"') return 1;
  if (ch !== '&') return 0;
  const m = redactExecAt(QUOTE_AT, text, i);
  return m === null ? 0 : m[0].length;
}

// End of a quoted value opened by `level` backslashes and `quote` at `start` (the first character of the value):
// `{ end, closeLength }`. A quote preceded by exactly `level` backslashes closes it; more backslashes are an escape at
// a deeper level; fewer, a raw `"` inside an entity-quoted value, a line break or the end of `text` end an unclosed value
// (`closeLength` 0).
function quotedValueEnd(text, start, level, quote) {
  const n = text.length;
  for (let j = start; j < n;) {
    const ch = text[j];
    if (ch === '\n' || ch === '\r') return { end: j, closeLength: 0 };
    let run = 0;
    let k = j;
    if (ch === '\\') {
      k = j + redactExecAt(BACKSLASHES_AT, text, j)[0].length;
      run = k - j;
    }
    const q = quoteLengthAt(text, k);
    if (q === 0) {
      j = run > 0 ? k : j + 1;
      continue;
    }
    const token = redactSlice(text, k, k + q);
    if (run === level && token === quote) return { end: j, closeLength: run + q };
    if (run < level || (token === '"' && quote !== '"')) return { end: j, closeLength: 0 };
    j = k + q;
  }
  return { end: n, closeLength: 0 };
}

// Pairs whose key the regex `pair` finds (QUOTED_KEY or BARE_KEY); the value is read by quotedValueEnd, or as a JSON
// scalar after a quoted key. A sensitive value becomes the marker in the same quotes (an unclosed one stays unclosed).
function maskQuotedPairs(text, pair, bare, opts, count) {
  let out = '';
  let last = 0;
  let from = 0;
  for (let m = redactExecAt(pair, text, from); m !== null; m = redactExecAt(pair, text, from)) {
    from = m.index + m[0].length;
    const rule = secretKeyRule(bare ? m[2] : m[3]);
    if (rule === null) continue;
    const at = from;
    // A quoted key gives the quote the value must open with; after a bare key the value quote is read here.
    const level = bare ? redactExecAt(BACKSLASHES_AT, text, at)[0].length : m[1].length;
    const quote = bare ? redactExecAt(QUOTE_AT, text, at + level)[0] : m[2];
    const escapes = redactSlice(text, at, at + level);
    const opened = (bare || escapes === m[1]) && redactSlice(text, at + level, at + level + quote.length) === quote;
    if (opened) {
      const start = at + level + quote.length;
      const { end, closeLength } = quotedValueEnd(text, start, level, quote);
      const value = redactSlice(text, start, end);
      from = end + closeLength;
      if (value === '' || redactTest(MARKER, value)) continue;
      count.n++;
      out += `${redactSlice(text, last, start)}[redacted:${rule}]`;
      last = end;
      continue;
    }
    if (bare || !opts.jsonScalars) continue;
    const scalar = redactExecAt(SCALAR_AT, text, at);
    if (scalar === null) continue;
    const q = `${m[1]}${quote}`;
    count.n++;
    out += `${redactSlice(text, last, at)}${q}[redacted:${rule}]${q}`;
    last = at + scalar[0].length;
    from = last;
  }
  return last === 0 ? text : out + redactSlice(text, last);
}

function maskPairs(whole, opts, count) {
  // A value cut by a MAIN limit ends right before the truncation note: the pairs are matched in the text before it.
  const tail = redactExec(TRUNCATED_TAIL, whole);
  const text = tail === null ? whole : redactSlice(whole, 0, tail.index);
  let out = maskQuotedPairs(text, QUOTED_KEY, false, opts, count);
  if (opts.colonPairs) out = maskQuotedPairs(out, BARE_KEY, true, opts, count);

  // Forms cut at the end of the text: only the end can hold them, so the anchored regexes get only the last part — from
  // the last but one `<` (the opening tag; a cut closing tag has the last one), and from the last quote less the room
  // of a key (≤ 256 characters, `=` and a backslash).
  const lt = redactLastIndex(out, '<');
  if (lt >= 0) {
    const from = Math.max(0, redactLastIndex(out, '<', lt - 1));
    out = redactSlice(out, 0, from) + redactReplace(redactSlice(out, from), XML_OPEN_END, (all, tag, local, attrs = '', value, close = '') => {
      const rule = secretKeyRule(local);
      if (rule === null || redactTest(MARKER, value) || value.trim() === '') return all;
      count.n++;
      return `<${tag}${attrs}>[redacted:${rule}]${close}`;
    });
  }
  const ltEntity = Math.max(redactLastIndex(out, '&lt;'), redactLastIndex(out, '&#'));
  if (ltEntity >= 0) {
    const from = Math.max(0, redactLastIndex(out, '&lt;', ltEntity - 1), redactLastIndex(out, '&#', ltEntity - 1));
    out = redactSlice(out, 0, from) + redactReplace(redactSlice(out, from), XML_ENTITY_OPEN_END, (all, lt, tag, local, attrs = '', gt, value, close = '') => {
      const rule = secretKeyRule(local);
      if (rule === null || redactTest(MARKER, value) || value.trim() === '') return all;
      count.n++;
      return `${lt}${tag}${attrs}${gt}[redacted:${rule}]${close}`;
    });
  }
  const quoteAt = Math.max(redactLastIndex(out, '"'), redactLastIndex(out, "'"));
  if (quoteAt > 0) {
    const from = Math.max(0, quoteAt - 258);
    out = redactSlice(out, 0, from) + redactReplace(redactSlice(out, from), ATTRIBUTE_OPEN_END, (all, key, quote, value) => {
      const rule = secretKeyRule(key);
      if (rule === null || redactTest(MARKER, value)) return all;
      count.n++;
      return `${key}=${quote}[redacted:${rule}]`;
    });
  }

  out = redactReplace(out, XML_ELEMENT, (all, tag, local, attrs = '', value) => {
    if (redactTest(MARKER, value.trim()) || value.trim() === '') return all;
    const rule = secretKeyRule(local);
    if (rule === null) return all;
    count.n++;
    return `<${tag}${attrs}>[redacted:${rule}]</${tag}>`;
  });

  out = redactReplace(out, XML_ENTITY_ELEMENT, (all, lt, tag, local, attrs = '', gt, value) => {
    if (redactTest(MARKER, value.trim()) || value.trim() === '') return all;
    const rule = secretKeyRule(local);
    if (rule === null) return all;
    count.n++;
    const start = lt.length + tag.length + attrs.length + gt.length;
    return `${redactSlice(all, 0, start)}[redacted:${rule}]${redactSlice(all, start + value.length)}`;
  });

  out = redactReplace(out, ATTRIBUTE, (all, key, dq, sq, esc) => {
    const value = dq ?? sq ?? esc;
    if (value === '' || redactTest(MARKER, value)) return all;
    const rule = secretKeyRule(key);
    if (rule === null) return all;
    count.n++;
    if (dq !== undefined) return `${key}="[redacted:${rule}]"`;
    if (sq !== undefined) return `${key}='[redacted:${rule}]'`;
    return `${key}=\\"[redacted:${rule}]\\"`;
  });

  // A value starting with a marker was masked already (a URL in text keeps a `:line:col` suffix after it).
  const formPair = (all, key, value) => {
    if (redactTest(MARKER_START, value)) return all;
    let rule = secretKeyRule(key);
    // A percent-encoded value (`payload=%7B%22password%22…`, review E3 N2) is checked decoded; a hit masks the whole value.
    if (rule === null && value.includes('%')) rule = encodedValueRule(value, opts);
    if (rule === null) return all;
    count.n++;
    return `${key}=[redacted:${rule}]`;
  };
  out = redactReplace(redactReplace(out, FORM_PAIR, formPair), PATH_PAIR, formPair);

  if (opts.colonPairs) {
    const colon = (all, _quote, key, value, offset, whole) => {
      // `[redacted:key-code]:44:15` (a marker before a stack position) is not a `key: value` pair.
      if (redactSlice(whole, Math.max(0, offset - 10), offset) === '[redacted:') return all;
      const rule = secretKeyRule(key);
      if (rule === null || redactTest(MARKER_START, value)) return all;
      const secret = redactReplace(value, TRAILING_BLANKS, '');
      if (secret === '' || redactTest(MARKER, secret)) return all;
      count.n++;
      return `${redactSlice(all, 0, all.length - value.length)}[redacted:${rule}]${redactSlice(value, secret.length)}`;
    };
    out = redactReplace(redactReplace(out, COOKIE_LINE, colon), COLON_PAIR, colon);
  }
  return tail === null ? out : out + tail[0];
}

// ---- value patterns -----------------------------------------------------------------------------------------------

const URL_CREDENTIALS = redactRegExp(/\b([A-Za-z][A-Za-z0-9+.-]{0,20}:\/\/)([^\s/?#@"'<>\\]+)@/g);
const BASIC = redactRegExp(/\b(Basic\s+)([A-Za-z0-9+/]{8,}={0,2})(?![A-Za-z0-9+/=])/g);
const BEARER = redactRegExp(/\b(Bearer\s+)([A-Za-z0-9._~+/=-]{16,})/gi);
const JWT = redactRegExp(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g);
// IBAN, plain or in groups of four separated by single spaces; validated by mod-97.
const IBAN = redactRegExp(/(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?(?![A-Za-z0-9])/g);
// 13–19 digits with optional single spaces or dashes between them; validated by IIN and Luhn. Not inside a word (no
// letter or digit before or after) nor inside a UUID (QA F-3; checked in maskCards). `order-id-<PAN>` is a card (N1).
const CARD = redactRegExp(/(?<![\dA-Za-z])(?:\d[ -]?){12,18}\d(?![\dA-Za-z])/g);
const UUID = redactRegExp(/(?<![\dA-Fa-f])[\dA-Fa-f]{8}-[\dA-Fa-f]{4}-[\dA-Fa-f]{4}-[\dA-Fa-f]{4}-[\dA-Fa-f]{12}(?![\dA-Fa-f])/g);

// True when [start, end) of `text` lies inside a UUID (looked for only in the 36 characters around it).
function insideUuid(text, start, end) {
  const from = Math.max(0, start - 36);
  const near = redactSlice(text, from, end + 36);
  for (let m = redactExecAt(UUID, near, 0); m !== null; m = redactExecAt(UUID, near, m.index + m[0].length)) {
    if (from + m.index <= start && from + m.index + m[0].length >= end) return true;
  }
  return false;
}
const PESEL = redactRegExp(/(?<!\d)\d{11}(?!\d)/g);
// Runs of ≥ 32 characters of the token alphabet; judged in the callback (entropy, letters and digits).
const LONG_RUN = redactRegExp(/(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{32,}/g);
// A path segment: a word, optionally capitalised, of lower-case letters, digits, `_` and `-` (base64 mixes case).
const PATH_SEGMENT = redactRegExp(/^[A-Za-z]?[a-z0-9_-]*$/);
const FILE_EXTENSION = redactRegExp(/^\.[A-Za-z][A-Za-z0-9]{0,7}(?![A-Za-z0-9])/);
// E-mail, also URL-encoded (`%40`); the domain ends with a letter-only TLD, so `react@18.2.0` is kept.
const EMAIL = redactRegExp(/(?<![\w.+%-])[\w.+-]+(?:@|%40)(?:[\w-]{1,63}\.){1,8}[A-Za-z]{2,24}(?![\w-])/g);
// PL phone: +48/0048 and 9 digits, 3-3-3 groups, or a bare 9-digit mobile number ([4-8]…).
const PHONE = redactRegExp(/(?<![\d+])(?<!\d[ -])(?:(?:\+48|0048)[ -]?\d{3}[ -]?\d{3}[ -]?\d{3}|\d{3}[ -]\d{3}[ -]\d{3}|[4-8]\d{8})(?!\d)(?![ -]\d)/g);
const DIGIT = redactRegExp(/\d/);
const LETTER = redactRegExp(/[A-Za-z]/);
const LOWER = redactRegExp(/[a-z]/);
const UPPER = redactRegExp(/[A-Z]/);
const WORD_SEPARATORS = redactRegExp(/[_\-/]/);
const SLASH = redactRegExp(/\//);
const SLASH_KEPT = redactRegExp(/(\/)/);
const INNER_EQUALS = redactRegExp(/(=+(?!=*$))/);
const CARD_SEPARATORS = redactRegExp(/[ -]/g);
const CARD_SEPARATOR = redactRegExp(/[ -]/);

function looksLikeSecret(run) {
  if (run.length < 32 || !redactTest(DIGIT, run) || !redactTest(LETTER, run)) return false;
  if (shannon(run) <= 4) return false;
  // Identifiers and words joined by `_`/`-` (snake_case, slugs) reach 4 bits too: a secret has mixed case
  // or a long separator-free piece.
  if (redactTest(LOWER, run) && redactTest(UPPER, run)) return true;
  return redactSplit(run, WORD_SEPARATORS).some((piece) => piece.length >= 20);
}

function maskLongSecret(text, count) {
  return redactReplace(text, LONG_RUN, (run, offset, whole) => {
    if (redactSlice(whole, Math.max(0, offset - 7), offset) === 'base64,') return run;
    // A path segment that ends with a file extension (`/static/abc….js`) is a file name.
    const after = redactSlice(whole, offset + run.length, offset + run.length + 10);
    // A path (`/a/b/c`, `com/org/repo/…` after a host) is judged segment by segment; other runs (base64 with `/`)
    // as a whole. Interior `=` splits too (`utm_campaign=…`); padding at the end stays with the run.
    const path = run.includes('/') && (run.startsWith('/') || redactSplit(run, SLASH).every((s) => redactTest(PATH_SEGMENT, s)));
    const parts = redactSplit(run, path ? SLASH_KEPT : INNER_EQUALS);
    let changed = false;
    const last = parts.length - 1;
    for (let i = 0; i < parts.length; i++) {
      if (i === last && redactTest(FILE_EXTENSION, after)) continue;
      if (looksLikeSecret(parts[i])) {
        parts[i] = '[redacted:long-secret]';
        changed = true;
        count.n++;
      }
    }
    return changed ? parts.join('') : run;
  });
}

function maskCards(text, count) {
  return redactReplace(text, CARD, (match, offset, whole) => {
    if (insideUuid(whole, offset, offset + match.length)) return match;
    // Try the whole run, then shorter prefixes ending at a group boundary (`4111 1111 1111 1111 22`).
    const positions = [];
    for (let i = 0; i < match.length; i++) if (match[i] >= '0' && match[i] <= '9') positions.push(i);
    const digits = redactReplace(match, CARD_SEPARATORS, '');
    if (!redactTest(CARD_IIN, digits)) return match;
    for (let n = positions.length; n >= 13; n--) {
      const endIndex = positions[n - 1] + 1;
      if (n < positions.length && !redactTest(CARD_SEPARATOR, match[endIndex])) continue;
      if (luhn(redactSlice(digits, 0, n))) {
        count.n++;
        return `[redacted:card]${redactSlice(match, endIndex)}`;
      }
    }
    return match;
  });
}

function maskPatterns(text, opts, count) {
  let out = redactReplace(text, URL_CREDENTIALS, (all, scheme, userinfo) => {
    if (redactTest(MARKER, userinfo)) return all;
    count.n++;
    return `${scheme}[redacted:url-credentials]@`;
  });
  out = redactReplace(out, BASIC, (_all, prefix) => {
    count.n++;
    return `${prefix}[redacted:basic]`;
  });
  out = redactReplace(out, BEARER, (_all, prefix) => {
    count.n++;
    return `${prefix}[redacted:bearer]`;
  });
  out = redactReplace(out, JWT, () => {
    count.n++;
    return '[redacted:jwt]';
  });
  // IBAN before card: a spaced IBAN contains a digit run that may pass Luhn.
  out = redactReplace(out, IBAN, (match) => {
    // The last group may be a following word (`… 2874 OK`): drop trailing groups until mod-97 holds.
    for (let candidate = match; redactReplace(candidate, SPACES, '').length >= 15;) {
      if (ibanValid(candidate)) {
        count.n++;
        return `[redacted:iban]${redactSlice(match, candidate.length)}`;
      }
      const space = candidate.lastIndexOf(' ');
      if (space < 0) break;
      candidate = redactSlice(candidate, 0, space);
    }
    return match;
  });
  out = maskCards(out, count);
  out = redactReplace(out, PESEL, (match) => {
    if (!peselValid(match)) return match;
    count.n++;
    return '[redacted:pesel]';
  });
  if (opts.longSecret) out = maskLongSecret(out, count);
  if (opts.email) {
    out = redactReplace(out, EMAIL, () => {
      count.n++;
      return '[redacted:email]';
    });
  }
  if (opts.phone) {
    out = redactReplace(out, PHONE, () => {
      count.n++;
      return '[redacted:phone]';
    });
  }
  return out;
}

// ---- URLs in text -------------------------------------------------------------------------------------------------

// An address in free text (stack frames, messages): scheme `://` up to white space, `)`, a quote or a separator. The
// `code`/`ticket` query keys (urlKeyRule) are sensitive only in a URL, so the query of each such address goes through
// maskQuery (E3-PD2). A stack position `:line:col` at its end is kept apart, so it is neither masked nor lost.
const TEXT_URL = redactRegExp(/(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{0,20}:\/\/[^\s()"'<>\\`,;{}|^]+/g);
const URL_POSITION = redactRegExp(/(?::\d+){1,2}$/);

function maskTextUrls(text, opts, count) {
  if (redactLastIndex(text, '://') < 0) return text;
  return redactReplace(text, TEXT_URL, (url) => {
    const q = url.indexOf('?');
    if (q < 0) return url;
    const position = redactExec(URL_POSITION, url);
    const address = position === null ? url : redactSlice(url, 0, position.index);
    const hash = address.indexOf('#', q);
    const query = redactSlice(address, q, hash < 0 ? address.length : hash);
    const masked = maskQuery(query, opts, count);
    if (masked === query) return url;
    return redactSlice(address, 0, q) + masked + redactSlice(url, q + query.length);
  });
}

// Rule for a percent-encoded value (a form or query value): the first marker the decoded value gets, or null.
function encodedValueRule(value, opts) {
  const nested = decodeKey(value);
  if (nested === value) return null;
  const masked = maskText(nested.includes('?') ? maskUrl(nested, opts).text : nested, opts).text;
  return masked === nested ? null : redactExec(FIRST_MARKER, masked)?.[1] ?? null;
}

// Fast path (D2): short strings and strings without any trigger character cannot hold a match.
const TRIGGER = redactRegExp(/[@=:<.\d%]|&lt;|B(?:asic|earer)\s|[A-Za-z0-9+/=_-]{32}/i);

function normalize(opts) {
  return {
    email: opts?.email === true,
    phone: opts?.phone === true,
    longSecret: opts?.longSecret !== false,
    jsonScalars: opts?.jsonScalars !== false,
    colonPairs: opts?.colonPairs !== false,
  };
}

/**
 * Masks secrets in free text: key/value forms (JSON strings, numbers and booleans, XML elements, attributes,
 * `k=v`, `k: v`), then `url-credentials`, `basic`, `bearer`, `jwt`, `iban`, `card`, `pesel`, `long-secret`
 * and, when enabled, `email` and `phone`.
 * @param {string} text non-strings give `{ text: '', applied: 0 }`
 * @param {{ email?: boolean, phone?: boolean, longSecret?: boolean, jsonScalars?: boolean, colonPairs?: boolean }} [opts]
 *   `email`/`phone` default off; `longSecret` off for selectors; `jsonScalars`/`colonPairs` off only for the E2 contract.
 * @returns {{ text: string, applied: number }} `applied` = number of replaced values
 */
export function maskText(text, opts) {
  if (typeof text !== 'string') return { text: '', applied: 0 };
  if (text.length < 6 || !redactTest(TRIGGER, text)) return { text, applied: 0 };
  const o = normalize(opts);
  const count = { n: 0 };
  const out = maskPatterns(maskPairs(maskTextUrls(text, o, count), o, count), o, count);
  return { text: out, applied: count.n };
}

// ---- URL fields ---------------------------------------------------------------------------------------------------

// Split by a regex (no URL parser), so the address is never normalised.
const URL_PARTS = redactRegExp(/^([^?#]*)(\?[^#]*)?(#.*)?$/s);
const PATH_PARAM = redactRegExp(/;([^;/?#=]{1,256})=([^;/?#]*)/g);
const PLUS = redactRegExp(/\+/g);
const QUERY_PAIR = redactRegExp(/([^?&=]+)=([^&]*)/g);
const FRAGMENT_SEPARATORS = redactRegExp(/[&;?/#]/);
const FRAGMENT_MARKER = '#[redacted:url-fragment]';

function decodeKey(key) {
  try {
    return decodeURIComponent(redactReplace(key, PLUS, ' '));
  } catch {
    return key;
  }
}

const FIRST_MARKER = redactRegExp(/\[redacted:([a-z0-9_*-]+)\]/);

function maskQuery(query, opts, count) {
  return redactReplace(query, QUERY_PAIR, (all, key, value) => {
    if (value === '' || redactTest(MARKER, value)) return all;
    let rule = urlKeyRule(decodeKey(key));
    // An encoded value (`redirect=https%3A%2F%2F…%3Ftoken%3D…`) is checked decoded; a hit masks the whole value.
    if (rule === null && value.includes('%')) rule = encodedValueRule(value, opts);
    if (rule === null) return all;
    count.n++;
    return `${key}=[redacted:${rule}]`;
  });
}

function fragmentIsSensitive(fragment, opts) {
  for (const pair of redactSplit(redactSlice(fragment, 1), FRAGMENT_SEPARATORS)) {
    const eq = pair.indexOf('=');
    if (eq > 0 && pair.length > eq + 1 && urlKeyRule(decodeKey(redactSlice(pair, 0, eq))) !== null) return true;
  }
  return maskText(redactSlice(fragment, 1), { email: opts.email, longSecret: opts.longSecret }).applied > 0;
}

/**
 * Masks a URL field (AC-3.3): `user:pass@` → `url-credentials`, `;jsessionid=` path parameters and query
 * parameters by key, a fragment holding a secret → the whole fragment `#[redacted:url-fragment]` (OAuth implicit),
 * then the value patterns on the whole address. `phone` is never applied to URLs.
 * @param {string} url
 * @param {{ email?: boolean, longSecret?: boolean }} [opts]
 * @returns {{ text: string, applied: number }}
 */
export function maskUrl(url, opts) {
  if (typeof url !== 'string') return { text: '', applied: 0 };
  if (url === '') return { text: url, applied: 0 };
  const o = { ...normalize(opts), phone: false };
  const count = { n: 0 };
  const [, base = '', query = '', fragment = ''] = redactExec(URL_PARTS, url) || [];
  let path = redactReplace(base, PATH_PARAM, (all, key, value) => {
    if (value === '' || redactTest(MARKER, value)) return all;
    const rule = secretKeyRule(key);
    if (rule === null) return all;
    count.n++;
    return `;${key}=[redacted:${rule}]`;
  });
  path = maskPatterns(path, o, count);
  const q = query ? maskPatterns(maskQuery(query, o, count), o, count) : '';
  let f = fragment;
  if (f && f !== FRAGMENT_MARKER && fragmentIsSensitive(f, o)) {
    f = FRAGMENT_MARKER;
    count.n++;
  }
  return { text: path + q + f, applied: count.n };
}

// ---- E2 contract --------------------------------------------------------------------------------------------------

/**
 * E2 API for MAIN (response previews, step URLs): the Always rules on text cut to `MASK_LIMITS.inputChars`,
 * without `email`/`phone`, without the E3-IN2 JSON-scalar and `k: v` forms (the background pass adds them).
 * @returns {{ text: string, masked: number }}
 */
export function maskSecrets(text) {
  if (typeof text !== 'string') return { text: '', masked: 0 };
  const cut = text.length > MASK_LIMITS.inputChars ? redactSlice(text, 0, MASK_LIMITS.inputChars) : text;
  const { text: out, applied } = maskText(cut, { jsonScalars: false, colonPairs: false });
  return { text: out, masked: applied };
}
