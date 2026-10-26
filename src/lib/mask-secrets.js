// Masking of secrets in text at the source (E2 D3a): response body previews and step URLs are masked in MAIN
// before they reach a buffer, and the background redacts the whole package again (E3 D1). Since E3 the rules
// live in redact-rules.js (rulesVersion 1); this module keeps the E2 API (`maskSecrets`, `MASK_LIMITS`) for the
// hooks and package.js and adds `cutPreview`. Pure, no DOM, bundled into MAIN as well.

export * from './redact-rules.js';

// Characters of a "word" (`[A-Za-z0-9._~+/=-]`) that a cut may leave half-kept (D3): a token fragment must not stay
// at the end. Checked by char code, not by a regex, so page-replaced String/RegExp built-ins do not matter (AC-3.6).
const WORD_PUNCTUATION = '._~+/=-';

function isWordChar(ch) {
  if (typeof ch !== 'string' || ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || WORD_PUNCTUATION.indexOf(ch) >= 0;
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
  if (isWordChar(s[limit])) {
    let end = preview.length;
    while (end > 0 && isWordChar(preview[end - 1])) end--;
    preview = preview.slice(0, end);
  }
  const last = preview.charCodeAt(preview.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) preview = preview.slice(0, -1);
  return { preview, truncated: true };
}
