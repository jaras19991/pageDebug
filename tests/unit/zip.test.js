// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { unzipSync } from 'fflate';
import { crc32, deflateRaw, createZip, toBase64, fromBase64, ZIP_LIMITS } from '../../src/lib/zip.js';

const enc = new TextEncoder();

function hasUnzip() {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function randomBytes(n, seed = 1) {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

// Fake JPEG: SOI marker + incompressible noise.
function fakeJpeg(n = 20000) {
  const bytes = randomBytes(n, 7);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  return bytes;
}

function sampleFiles() {
  const json = JSON.stringify({ schemaVersion: 4, notes: ['zażółć gęślą jaźń'], list: Array.from({ length: 500 }, (_, i) => ({ i, msg: 'hello world' })) }, null, 2);
  return [
    { name: 'snapshot.json', data: enc.encode(json), compress: true },
    { name: 'summary.md', data: enc.encode(`# Paczka diagnostyczna — example.com\n\n${'- Zamaskowano 3 wartości w 2 sekcjach.\n'.repeat(20)}`), compress: true },
    { name: 'screenshot.jpg', data: fakeJpeg(), compress: false },
  ];
}

// Minimal independent reader of the central directory: name, method, sizes, local header offset, flags.
function readCentral(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let k = 0; k < count; k++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    entries.push({
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      time: view.getUint16(p + 12, true),
      date: view.getUint16(p + 14, true),
      crc: view.getUint32(p + 16, true),
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      offset: view.getUint32(p + 42, true),
      name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function entryData(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const o = entry.offset;
  expect(view.getUint32(o, true)).toBe(0x04034b50);
  const start = o + 30 + view.getUint16(o + 26, true) + view.getUint16(o + 28, true);
  const raw = bytes.subarray(start, start + entry.compressedSize);
  return entry.method === 8 ? new Uint8Array(zlib.inflateRawSync(raw)) : raw;
}

describe('crc32', () => {
  it('crc32 matches zlib.crc32 on random buffers', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    for (const n of [1, 7, 100, 4096, 100003]) {
      const buf = randomBytes(n, n);
      expect(crc32(buf)).toBe(zlib.crc32(buf));
    }
  });
});

describe('createZip (D7, AC-1.2, AC-6.4)', () => {
  it.skipIf(!process.env.CI && !hasUnzip())('zip with snapshot.json, summary.md, screenshot.jpg passes unzip -t (No errors)', async () => {
    const { bytes } = await createZip(sampleFiles(), { date: new Date(2026, 9, 26, 14, 5, 9) });
    const dir = mkdtempSync(join(tmpdir(), 'pds-zip-'));
    try {
      const file = join(dir, 'snapshot-example.com-20261026-140509.zip');
      writeFileSync(file, bytes);
      const out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
      expect(out).toMatch(/No errors detected/);
      const list = execFileSync('unzip', ['-l', file], { encoding: 'utf8' });
      expect(list).toMatch(/(10-26-2026|2026-10-26) 14:05/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fflate.unzipSync and zlib.inflateRawSync read identical bytes; snapshot.json is first entry', async () => {
    const files = sampleFiles();
    const { bytes, compressed } = await createZip(files, { date: new Date(2026, 0, 2, 3, 4, 6) });
    expect(compressed).toBe(true);
    const viaFflate = unzipSync(bytes);
    expect(Object.keys(viaFflate)).toEqual(['snapshot.json', 'summary.md', 'screenshot.jpg']);
    const entries = readCentral(bytes);
    expect(entries.map((e) => e.name)).toEqual(['snapshot.json', 'summary.md', 'screenshot.jpg']);
    expect(entries[0].offset).toBe(0);
    for (const [i, f] of files.entries()) {
      expect(viaFflate[f.name]).toEqual(f.data);
      const data = entryData(bytes, entries[i]);
      expect(data).toEqual(f.data);
      expect(entries[i].crc).toBe(zlib.crc32(f.data));
      expect(entries[i].size).toBe(f.data.length);
      // UTF-8 names, no data descriptor (bit 3), no encryption (bit 0).
      expect(entries[i].flags & 0x0800).toBe(0x0800);
      expect(entries[i].flags & 0x0009).toBe(0);
    }
    // DOS date/time from local fields: 2026-01-02 03:04:06.
    expect(entries[0].date).toBe(((2026 - 1980) << 9) | (1 << 5) | 2);
    expect(entries[0].time).toBe((3 << 11) | (4 << 5) | 3);
  });

  it('jpeg entry stored (method 0), json deflated (method 8)', async () => {
    const { bytes } = await createZip(sampleFiles(), { date: new Date() });
    const [json, md, jpg] = readCentral(bytes);
    expect(json.method).toBe(8);
    expect(json.compressedSize).toBeLessThan(json.size);
    expect(md.method).toBe(8);
    expect(jpg.method).toBe(0);
    expect(jpg.compressedSize).toBe(jpg.size);
  });

  it('without CompressionStream entries are stored and zip still valid', async () => {
    const original = globalThis.CompressionStream;
    globalThis.CompressionStream = undefined;
    try {
      expect(await deflateRaw(enc.encode('abc'))).toBeNull();
      const files = sampleFiles();
      const { bytes, compressed } = await createZip(files, { date: new Date() });
      expect(compressed).toBe(false);
      expect(readCentral(bytes).every((e) => e.method === 0)).toBe(true);
      const out = unzipSync(bytes);
      for (const f of files) expect(out[f.name]).toEqual(f.data);
    } finally {
      globalThis.CompressionStream = original;
    }
  });

  it('empty file and keeps input order', async () => {
    const files = [
      { name: 'b.txt', data: new Uint8Array(0), compress: true },
      { name: 'a.txt', data: enc.encode('x'), compress: true },
    ];
    const { bytes } = await createZip(files, { date: new Date() });
    expect(Object.keys(unzipSync(bytes))).toEqual(['b.txt', 'a.txt']);
  });

  it('rejects entries over the 32-bit limit (no ZIP64)', async () => {
    const huge = { length: ZIP_LIMITS.maxBytes + 1 };
    await expect(createZip([{ name: 'x', data: huge, compress: false }], { date: new Date() })).rejects.toThrow(/too large/);
  });

  it('date before 1980 is clamped to the DOS epoch', async () => {
    const { bytes } = await createZip([{ name: 'a', data: enc.encode('a'), compress: false }], { date: new Date(1970, 0, 1) });
    const [e] = readCentral(bytes);
    expect(e.date).toBe((0 << 9) | (1 << 5) | 1);
  });

  it('5 MB JSON compressed in ≤ 500 ms', async () => {
    const rows = [];
    let size = 0;
    for (let i = 0; size < 5 * 1024 * 1024; i++) {
      const row = `{"t":${i * 1.5},"level":"log","args":["message ${i} ${(i * 2654435761) % 1000003}"]}`;
      rows.push(row);
      size += row.length + 2;
    }
    const data = enc.encode(`[${rows.join(',\n')}]`);
    const start = performance.now();
    const { bytes } = await createZip([{ name: 'snapshot.json', data, compress: true }], { date: new Date() });
    const ms = performance.now() - start;
    expect(bytes.length).toBeLessThan(data.length / 3);
    expect(ms).toBeLessThanOrEqual(500);
  });
});

describe('base64', () => {
  it('toBase64 / fromBase64 round-trip in chunks, equal to Buffer', () => {
    for (const n of [0, 1, 2, 3, 0x8000, 0x8001, 200000]) {
      const bytes = randomBytes(n, n + 3);
      const b64 = toBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect(fromBase64(b64)).toEqual(bytes);
    }
  });
});
