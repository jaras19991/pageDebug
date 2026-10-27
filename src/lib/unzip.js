// Minimal ZIP reader for the package container (design E4 D4): EOCD → central directory → local headers, method 0 (stored)
// and 8 (deflate through the native DecompressionStream('deflate-raw')), CRC32 check, sizes from the central directory (so the
// data descriptor flag works too). No ZIP64, no encryption, no multi-disk archives: `ZipError('unsupported')`.
// Untrusted input (a file from disk): every size is bounded before anything is allocated, inflation stops at the declared size,
// and the compression ratio is capped (zip bomb).
// Pure: no chrome.*, no DOM. Runs in the viewer (file://) and in the MCP server (Node ≥ 18).

import { crc32 } from './zip.js';

export const UNZIP_LIMITS = Object.freeze({
  maxEntries: 64,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  // uncompressed / compressed, checked for entries above ratioMinBytes (tiny entries compress well and harm nobody)
  maxRatio: 200,
  ratioMinBytes: 1024 * 1024,
});

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const MAX_NAME_CHARS = 1024;

/** Error with `code` ∈ `not-zip | corrupt | unsupported | too-large`. */
export class ZipError extends Error {
  constructor(code, message) {
    super(`zip: ${message || code}`);
    this.name = 'ZipError';
    this.code = code;
  }
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new ZipError('not-zip', 'input is not binary data');
}

function startsWithLocalHeader(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// The last EOCD record whose comment ends inside the file (searched backwards, comment ≤ 64 KB).
function findEocd(bytes, view) {
  const last = bytes.length - EOCD_SIZE;
  const first = Math.max(0, last - MAX_COMMENT);
  for (let p = last; p >= first; p--) {
    if (view.getUint32(p, true) === SIG_EOCD && p + EOCD_SIZE + view.getUint16(p + 20, true) <= bytes.length) return p;
  }
  return -1;
}

function decodeName(raw, utf8) {
  if (utf8) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      throw new ZipError('corrupt', 'entry name is not valid UTF-8');
    }
  }
  // CP437 best-effort: bytes as latin1 (ASCII names, the common case, are identical)
  let s = '';
  for (let i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);
  return s;
}

function checkName(name) {
  if (name.length === 0 || name.length > MAX_NAME_CHARS) throw new ZipError('corrupt', 'bad entry name length');
  if (name[0] === '/' || name[0] === '\\' || /^[a-zA-Z]:/.test(name)) throw new ZipError('corrupt', 'absolute entry name');
  if (name.split(/[\\/]/).includes('..')) throw new ZipError('corrupt', 'entry name with ..');
  if (name.includes('\0')) throw new ZipError('corrupt', 'entry name with NUL');
}

// Inflates raw deflate, refusing to produce more than `size` bytes. @returns {Promise<Uint8Array>} exactly `size` bytes
async function inflateRaw(input, size) {
  if (typeof DecompressionStream !== 'function') throw new ZipError('unsupported', 'DecompressionStream is missing');
  let stream;
  try {
    stream = new DecompressionStream('deflate-raw');
  } catch {
    throw new ZipError('unsupported', 'deflate-raw is not supported');
  }
  const writer = stream.writable.getWriter();
  writer.write(input).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const out = new Uint8Array(size);
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > size) throw new ZipError('corrupt', 'entry is larger than declared');
      out.set(value, total);
      total += value.length;
    }
  } catch (e) {
    reader.cancel().catch(() => {});
    if (e instanceof ZipError) throw e;
    throw new ZipError('corrupt', 'invalid deflate data');
  }
  if (total !== size) throw new ZipError('corrupt', 'entry is smaller than declared');
  return out;
}

/**
 * Reads every entry of a zip archive into memory.
 * @param {Uint8Array|ArrayBuffer} input
 * @param {Partial<typeof UNZIP_LIMITS>} [limits]  overrides of UNZIP_LIMITS
 * @returns {Promise<Map<string, Uint8Array>>} entries in central directory order; directory entries (name ending in `/`) skipped
 * @throws {ZipError}
 */
export async function readZip(input, limits = {}) {
  const lim = { ...UNZIP_LIMITS, ...limits };
  const bytes = toBytes(input);
  const looksLikeZip = startsWithLocalHeader(bytes);
  if (bytes.length < EOCD_SIZE) throw new ZipError(looksLikeZip ? 'corrupt' : 'not-zip', 'file is too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocd = findEocd(bytes, view);
  if (eocd < 0) throw new ZipError(looksLikeZip ? 'corrupt' : 'not-zip', 'end of central directory not found');
  const disk = view.getUint16(eocd + 4, true);
  const cdDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError('unsupported', 'ZIP64');
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) throw new ZipError('unsupported', 'ZIP64');
  if (disk !== 0 || cdDisk !== 0 || diskEntries !== count) throw new ZipError('unsupported', 'multi-disk archive');
  if (count > lim.maxEntries) throw new ZipError('too-large', `more than ${lim.maxEntries} entries`);
  if (cdOffset + cdSize > eocd) throw new ZipError('corrupt', 'central directory outside the file');

  // Pass 1: central directory — names, sizes, flags; all checks before any inflation.
  const entries = [];
  const seen = new Set();
  let total = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cdOffset + cdSize || view.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError('corrupt', 'bad central directory entry');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const entryDisk = view.getUint16(p + 34, true);
    const localOffset = view.getUint32(p + 42, true);
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (next > cdOffset + cdSize) throw new ZipError('corrupt', 'central directory entry outside the directory');
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff || entryDisk === 0xffff) {
      throw new ZipError('unsupported', 'ZIP64');
    }
    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) throw new ZipError('unsupported', 'encrypted entry');
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) throw new ZipError('unsupported', `compression method ${method}`);
    const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), (flags & FLAG_UTF8) !== 0);
    p = next;
    checkName(name);
    if (seen.has(name)) throw new ZipError('corrupt', 'duplicate entry name');
    seen.add(name);
    if (name.endsWith('/') && size === 0) continue; // directory
    if (method === METHOD_STORED && compressedSize !== size) throw new ZipError('corrupt', 'stored entry with two sizes');
    if (size > lim.maxEntryBytes) throw new ZipError('too-large', 'entry is too large');
    total += size;
    if (total > lim.maxTotalBytes) throw new ZipError('too-large', 'archive content is too large');
    if (size > lim.ratioMinBytes && size > compressedSize * lim.maxRatio) throw new ZipError('too-large', 'compression ratio is too high');
    entries.push({ name, method, crc, compressedSize, size, localOffset });
  }

  // Pass 2: local headers and data.
  const files = new Map();
  for (const e of entries) {
    const h = e.localOffset;
    if (h + 30 > cdOffset || view.getUint32(h, true) !== SIG_LOCAL) throw new ZipError('corrupt', 'bad local header');
    const start = h + 30 + view.getUint16(h + 26, true) + view.getUint16(h + 28, true);
    const end = start + e.compressedSize;
    if (end > cdOffset) throw new ZipError('corrupt', 'entry data outside the file');
    const body = bytes.subarray(start, end);
    const data = e.method === METHOD_STORED ? body.slice() : await inflateRaw(body, e.size);
    if (crc32(data) !== e.crc) throw new ZipError('corrupt', `CRC mismatch in ${e.name}`);
    files.set(e.name, data);
  }
  return files;
}
