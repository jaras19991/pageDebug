// Masking of secrets in text at the source (E2 D3a): response body previews are masked in MAIN before they
// reach a buffer, and again in the background when the package is assembled (the page may have patched
// String/RegExp in MAIN). Pure, idempotent, no DOM and no imports, so it is bundled into MAIN as well.
// Rules (skill privacy-redaction, rulesVersion 1): key list in JSON and `key=value` form, Bearer, JWT.
// Every regex is linear: no nested quantifiers over overlapping classes; runs start only at a run boundary.
// E3 grows this into the full redact.js.

export const MASK_LIMITS = Object.freeze({
  // Longer input is cut before masking: an unmasked tail must never pass through.
  inputChars: 65536,
  keyChars: 256,
});

// Skill privacy-redaction, "Klucze". The first token found in a key names the rule: `access_token` → key-token.
const SECRET_KEYS = Object.freeze([
  'token', 'access_token', 'refresh_token', 'id_token', 'auth', 'authorization', 'session', 'sessionid', 'sid', 'jwt',
  'secret', 'api_key', 'apikey', 'key', 'password', 'passwd', 'pwd', 'csrf', 'xsrf', 'cookie', 'set-cookie', 'bearer',
  'credential', 'private', 'signature', 'sig', 'otp', 'pin',
]);

// Word boundaries in a key: start/end, `_`, `-`, `.`, white space or brackets (`user[password]`).
const KEY_EDGE = '[_\\-.\\s\\[\\]]';
const KEY_MATCHERS = SECRET_KEYS.map((token) => ({
  token,
  re: new RegExp(`(?:^|${KEY_EDGE})${token.replace(/[.-]/g, '\\$&')}(?:$|${KEY_EDGE})`),
}));

// `"key" : "value"` with JSON escapes. Non-string values (numbers, booleans, null, objects) are kept.
const JSON_PAIR = /"((?:[^"\\\n]|\\.){1,256})"(\s*:\s*)"((?:[^"\\]|\\.)*)"/g;
// `key=value` in forms, query strings, fragments and plain text; the value ends at `&`, `#`, white space,
// a quote, a backslash (escaped quote inside a JSON string), `;`, `,`, `<` or `>`.
const FORM_PAIR = /(?<![A-Za-z0-9_.\-[\]])([A-Za-z0-9_.\-[\]]{1,256})=([^&#\s"'\\;,<>]+)/g;
const BEARER = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{16,})/gi;
const JWT = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g;

const MARKER = /^\[redacted:[a-z0-9_-]+\]$/;

// Trailing "word" that a cut may leave half-kept (D3): a token fragment must not stay at the end.
const WORD_CHAR = /[A-Za-z0-9._~+/=-]/;
const TRAILING_WORD = /[A-Za-z0-9._~+/=-]+$/;

function secretKeyToken(rawKey) {
  if (rawKey.length > MASK_LIMITS.keyChars) return null;
  // camelCase → snake_case, so `accessToken` matches `token` as a word.
  const key = rawKey.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  for (const { token, re } of KEY_MATCHERS) if (re.test(key)) return token;
  return null;
}

/**
 * Replaces secret values in `text` with `[redacted:<rule>]` (rules `key-<token>`, `bearer`, `jwt`).
 * JSON stays valid: string values are replaced inside their quotes. Values that are already markers are
 * left alone, so `maskSecrets(maskSecrets(x).text)` changes nothing and reports `masked: 0`.
 * @param {string} text non-strings give `{ text: '', masked: 0 }`
 * @returns {{ text: string, masked: number }} `masked` = number of replaced values
 */
export function maskSecrets(text) {
  if (typeof text !== 'string') return { text: '', masked: 0 };
  let masked = 0;
  let out = text.length > MASK_LIMITS.inputChars ? text.slice(0, MASK_LIMITS.inputChars) : text;

  out = out.replace(JSON_PAIR, (all, key, colon, value) => {
    if (value === '' || MARKER.test(value)) return all;
    const token = secretKeyToken(key);
    if (token === null) return all;
    masked++;
    return `"${key}"${colon}"[redacted:key-${token}]"`;
  });

  out = out.replace(FORM_PAIR, (all, key, value) => {
    if (MARKER.test(value)) return all;
    const token = secretKeyToken(key);
    if (token === null) return all;
    masked++;
    return `${key}=[redacted:key-${token}]`;
  });

  out = out.replace(BEARER, (_all, prefix) => {
    masked++;
    return `${prefix}[redacted:bearer]`;
  });

  out = out.replace(JWT, () => {
    masked++;
    return '[redacted:jwt]';
  });

  return { text: out, masked };
}

/**
 * Cuts `text` to at most `max` characters for a preview (D3). A word (`[A-Za-z0-9._~+/=-]+`) that the cut
 * splits is dropped entirely, so half of a token never stays at the end; a split surrogate pair is dropped too.
 * @returns {{ preview: string, truncated: boolean }}
 */
export function cutPreview(text, max) {
  const s = typeof text === 'string' ? text : '';
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
  if (s.length <= limit) return { preview: s, truncated: false };
  let preview = s.slice(0, limit);
  if (WORD_CHAR.test(s[limit])) preview = preview.replace(TRAILING_WORD, '');
  const last = preview.charCodeAt(preview.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) preview = preview.slice(0, -1);
  return { preview, truncated: true };
}
