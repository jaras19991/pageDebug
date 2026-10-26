// Minimal ZIP writer for the package container (design E3 D7): PKZIP 2.0, local headers + central directory + EOCD,
// method 8 (deflate) through the native CompressionStream('deflate-raw') or method 0 (stored), CRC32, UTF-8 names
// (flag bit 11), DOS date/time from the local clock. No ZIP64, no data descriptor, no extra fields, no encryption:
// those are what Windows Explorer and macOS Archive Utility read badly (AC-1.2).
// Pure: no chrome.*, no DOM. Runs in the service worker, the event page, the page realm (console fallback) and Node.

export const ZIP_LIMITS = Object.freeze({
  // Sizes and offsets are 32-bit fields; anything larger would need ZIP64.
  maxBytes: 0xffffffff,
  maxEntries: 0xffff,
  // String.fromCharCode.apply argument count per call in toBase64.
  base64Chunk: 0x8000,
});

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const VERSION = 20; // 2.0: deflate; "made by" upper byte 0 = MS-DOS attributes
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

let crcTable = null;

function table() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** CRC-32 (IEEE 802.3, as in ZIP and zlib). @returns {number} unsigned 32-bit */
export function crc32(bytes) {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Raw deflate (no zlib header) with the native CompressionStream.
 * @returns {Promise<Uint8Array|null>} null when the API is missing (old browser in console mode)
 */
export async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  let stream;
  try {
    stream = new CompressionStream('deflate-raw');
  } catch {
    return null; // the format is not supported
  }
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const chunk of chunks) {
    out.set(chunk, p);
    p += chunk.length;
  }
  return out;
}

// DOS date/time from the local fields of `date` (the same fields as the file name, D7); clamped to 1980–2107.
function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = d.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
  if (year > 2107) return { time: (23 << 11) | (59 << 5) | 29, date: (127 << 9) | (12 << 5) | 31 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * @param {{ name: string, data: Uint8Array, compress: boolean }[]} files  written in this order (snapshot.json first, AC-6.4)
 * @param {{ date?: Date }} [options]  modification time of every entry (local time)
 * @returns {Promise<{ bytes: Uint8Array, compressed: boolean }>} `compressed: false` when an entry asked for compression
 *          but the browser cannot compress (all such entries are stored; the zip is still valid, only larger)
 * @throws {Error} when an entry or the archive does not fit the 32-bit fields (no ZIP64)
 */
export async function createZip(files, { date } = {}) {
  if (files.length > ZIP_LIMITS.maxEntries) throw new Error('zip: too many entries');
  const stamp = dosDateTime(date);
  const encoder = new TextEncoder();
  const entries = [];
  let compressed = true;
  for (const file of files) {
    const data = file.data;
    if (data.length > ZIP_LIMITS.maxBytes) throw new Error(`zip: entry ${file.name} is too large`);
    let method = METHOD_STORED;
    let body = data;
    if (file.compress && data.length > 0) {
      const deflated = await deflateRaw(data);
      if (deflated === null) compressed = false;
      else if (deflated.length < data.length) {
        method = METHOD_DEFLATE;
        body = deflated;
      }
    }
    entries.push({ name: encoder.encode(file.name), method, body, size: data.length, crc: crc32(data) });
  }

  let localSize = 0;
  let centralSize = 0;
  for (const e of entries) {
    localSize += 30 + e.name.length + e.body.length;
    centralSize += 46 + e.name.length;
  }
  const total = localSize + centralSize + 22;
  if (total > ZIP_LIMITS.maxBytes) throw new Error('zip: archive is too large');

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let p = 0;
  const offsets = [];
  for (const e of entries) {
    offsets.push(p);
    view.setUint32(p, SIG_LOCAL, true);
    view.setUint16(p + 4, VERSION, true);
    view.setUint16(p + 6, FLAG_UTF8, true);
    view.setUint16(p + 8, e.method, true);
    view.setUint16(p + 10, stamp.time, true);
    view.setUint16(p + 12, stamp.date, true);
    view.setUint32(p + 14, e.crc, true);
    view.setUint32(p + 18, e.body.length, true);
    view.setUint32(p + 22, e.size, true);
    view.setUint16(p + 26, e.name.length, true);
    view.setUint16(p + 28, 0, true);
    out.set(e.name, p + 30);
    out.set(e.body, p + 30 + e.name.length);
    p += 30 + e.name.length + e.body.length;
  }
  const centralStart = p;
  entries.forEach((e, i) => {
    view.setUint32(p, SIG_CENTRAL, true);
    view.setUint16(p + 4, VERSION, true);
    view.setUint16(p + 6, VERSION, true);
    view.setUint16(p + 8, FLAG_UTF8, true);
    view.setUint16(p + 10, e.method, true);
    view.setUint16(p + 12, stamp.time, true);
    view.setUint16(p + 14, stamp.date, true);
    view.setUint32(p + 16, e.crc, true);
    view.setUint32(p + 20, e.body.length, true);
    view.setUint32(p + 24, e.size, true);
    view.setUint16(p + 28, e.name.length, true);
    // extra, comment, disk number, internal and external attributes: 0
    view.setUint32(p + 42, offsets[i], true);
    out.set(e.name, p + 46);
    p += 46 + e.name.length;
  });
  view.setUint32(p, SIG_EOCD, true);
  view.setUint16(p + 8, entries.length, true);
  view.setUint16(p + 10, entries.length, true);
  view.setUint32(p + 12, p - centralStart, true);
  view.setUint32(p + 16, centralStart, true);
  return { bytes: out, compressed };
}

/** Bytes → base64 in chunks (the `collect` answer to the popup, D7). */
export function toBase64(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += ZIP_LIMITS.base64Chunk) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + ZIP_LIMITS.base64Chunk)));
  }
  return btoa(parts.join(''));
}

/** base64 → bytes (popup side). @throws on invalid base64 (atob) */
export function fromBase64(text) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
