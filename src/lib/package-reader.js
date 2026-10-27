// Package reader for the viewer and the MCP server (design E4 D4, E4-T8): a saved zip (`snapshot.json` required,
// `summary.md` and `screenshot.jpg` optional) or a bare snapshot JSON (v1–v3 files, a hand-extracted snapshot.json) →
// the snapshot in the v4 shape (migrate.js). Every failure is a PackageError with a code; READ_ERRORS_PL holds the
// Polish texts the viewer shows (MCP turns them into a tool error).
// Untrusted input: sizes are checked before decoding, the zip limits live in unzip.js.
// Pure: no chrome.*, no DOM, no clock. Not reachable from the extension.

import { readZip, ZipError } from './unzip.js';
import { normalizeSnapshot, PackageError } from './migrate.js';
import { fromBase64 } from './zip.js';

export const READER_LIMITS = Object.freeze({
  // Largest snapshot JSON decoded (bare file or zip entry), bytes.
  maxJsonBytes: 64 * 1024 * 1024,
});

/** Polish message per PackageError code (shown to the developer in the viewer). */
export const READ_ERRORS_PL = Object.freeze({
  'not-package': 'To nie jest plik paczki.',
  corrupt: 'Plik paczki jest uszkodzony.',
  'too-large': 'Plik jest za duży.',
  unsupported: 'Nieobsługiwany format pliku.',
});

const SNAPSHOT_FILE = 'snapshot.json';
const SUMMARY_FILE = 'summary.md';
const SCREENSHOT_FILE = 'screenshot.jpg'; // = SCREENSHOT_FILE in package.js (not imported: the reader does not pull the writer in)
const DATA_URL_IMAGE = /^data:(image\/(?:jpeg|png|webp));base64,/;
const WARNING_SCREENSHOT = { code: 'screenshot', message: 'Nie udało się odczytać zrzutu ekranu z paczki.' };

/** Polish text for any read error; an unknown error reads as a damaged file. */
export function readErrorMessage(err) {
  const code = err instanceof PackageError ? err.code : null;
  return Object.hasOwn(READ_ERRORS_PL, code) ? READ_ERRORS_PL[code] : READ_ERRORS_PL.corrupt;
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new PackageError('not-package', 'input is not binary data');
}

function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// UTF-8 (BOM allowed) → parsed JSON. `inZip`: the entry is ours by name, so any decode or parse failure is damage;
// a bare file that does not even look like a JSON object is not a package.
function parseJson(bytes, inZip) {
  if (bytes.length > READER_LIMITS.maxJsonBytes) throw new PackageError('too-large', 'snapshot JSON is too large');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new PackageError(inZip ? 'corrupt' : 'not-package', 'not UTF-8 text');
  }
  const start = text.search(/\S/);
  if (!inZip && start >= 0 && text[start] !== '{' && text[start] !== '[') throw new PackageError('not-package', 'not JSON');
  if (start < 0) throw new PackageError(inZip ? 'corrupt' : 'not-package', 'empty file');
  try {
    return JSON.parse(text);
  } catch {
    throw new PackageError('corrupt', 'invalid JSON');
  }
}

async function unzip(bytes) {
  try {
    return await readZip(bytes);
  } catch (err) {
    if (err instanceof ZipError) throw new PackageError(err.code === 'not-zip' ? 'not-package' : err.code, err.message);
    throw new PackageError('corrupt', err?.message);
  }
}

// v3 keeps the image as a data URL; decoded to bytes so both formats give the viewer the same shape.
function screenshotFromDataUrl(dataUrl, warnings) {
  if (typeof dataUrl !== 'string') return null;
  const head = dataUrl.match(DATA_URL_IMAGE);
  try {
    if (!head) throw new Error('not an image data URL');
    return { mime: head[1], bytes: fromBase64(dataUrl.slice(head[0].length)) };
  } catch {
    warnings.push(WARNING_SCREENSHOT);
    return null;
  }
}

/**
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView} input  file contents
 * @returns {Promise<{ format: 'zip'|'json', snapshot: object, sourceVersion: number, newer: boolean,
 *   warnings: { code: string, message: string }[], summaryMd: string|null, screenshot: { mime: string, bytes: Uint8Array }|null }>}
 *   `summaryMd`: summary.md from the zip as saved (tests only; consumers rebuild the summary from `snapshot`)
 * @throws {PackageError} code `not-package` | `corrupt` | `too-large` | `unsupported`
 */
export async function readPackage(input) {
  const bytes = toBytes(input);
  if (!isZip(bytes)) {
    const { snapshot, sourceVersion, newer, warnings, extras } = normalizeSnapshot(parseJson(bytes, false));
    const screenshot = screenshotFromDataUrl(extras.screenshotDataUrl, warnings);
    return { format: 'json', snapshot, sourceVersion, newer, warnings, summaryMd: null, screenshot };
  }

  const files = await unzip(bytes);
  const json = files.get(SNAPSHOT_FILE);
  if (!json) throw new PackageError('not-package', 'zip without snapshot.json');
  const { snapshot, sourceVersion, newer, warnings, extras } = normalizeSnapshot(parseJson(json, true));
  const summary = files.get(SUMMARY_FILE);
  let summaryMd = null;
  if (summary) {
    try {
      summaryMd = new TextDecoder('utf-8', { fatal: true }).decode(summary);
    } catch {
      summaryMd = null; // only used for equality checks; the snapshot is what counts
    }
  }
  const image = files.get(SCREENSHOT_FILE);
  const screenshot = image && image.length > 0
    ? { mime: 'image/jpeg', bytes: image }
    : screenshotFromDataUrl(extras.screenshotDataUrl, warnings);
  return { format: 'zip', snapshot, sourceVersion, newer, warnings, summaryMd, screenshot };
}
