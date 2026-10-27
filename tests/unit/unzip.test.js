// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { zipSync, Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import { createZip } from '../../src/lib/zip.js';
import { readZip, ZipError, UNZIP_LIMITS } from '../../src/lib/unzip.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function randomBytes(n, seed = 7) {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

function jsonText(chars) {
  const rows = [];
  let len = 2;
  for (let i = 0; len < chars; i++) {
    const row = JSON.stringify({ t: i * 1.5, doc: i % 3, level: 'log', args: [`"message ${i} ${(i * 7919) % 104729}"`] });
    rows.push(row);
    len += row.length + 2;
  }
  return `[\n${rows.join(',\n')}\n]`;
}

// Offsets of the EOCD and the first central directory entry of a zip written without a comment.
function layout(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  return { view, eocd, central: view.getUint32(eocd + 16, true) };
}

async function expectCode(promise, code) {
  const err = await promise.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(ZipError);
  expect(err.code).toBe(code);
}

async function sample() {
  const json = enc.encode(jsonText(50_000));
  const jpeg = randomBytes(5000);
  const summary = enc.encode('# Podsumowanie\n\nŻółć — zażółcona gęślą jaźń.\n');
  const { bytes } = await createZip([
    { name: 'snapshot.json', data: json, compress: true },
    { name: 'summary.md', data: summary, compress: true },
    { name: 'screenshot.jpg', data: jpeg, compress: false },
  ]);
  return { bytes, json, jpeg, summary };
}

describe('readZip — valid archives', () => {
  it('reads zip from createZip (snapshot.json deflated, screenshot.jpg stored) byte-identical', async () => {
    const { bytes, json, jpeg, summary } = await sample();
    const files = await readZip(bytes);
    expect(files).toBeInstanceOf(Map);
    expect([...files.keys()]).toEqual(['snapshot.json', 'summary.md', 'screenshot.jpg']);
    expect(files.get('snapshot.json')).toEqual(json);
    expect(files.get('summary.md')).toEqual(summary);
    expect(files.get('screenshot.jpg')).toEqual(jpeg);
    // stored entries are copies, not views into the input
    files.get('screenshot.jpg')[0] ^= 0xff;
    expect((await readZip(bytes)).get('screenshot.jpg')).toEqual(jpeg);
  });

  it('accepts an ArrayBuffer and an empty entry', async () => {
    const { bytes } = await createZip([
      { name: 'empty.txt', data: new Uint8Array(0), compress: true },
      { name: 'a.txt', data: enc.encode('abc'), compress: false },
    ]);
    const files = await readZip(bytes.buffer.slice(0));
    expect(files.get('empty.txt').length).toBe(0);
    expect(dec.decode(files.get('a.txt'))).toBe('abc');
  });

  it('reads fflate.zipSync output', async () => {
    const json = enc.encode(jsonText(20_000));
    const bytes = zipSync({ 'snapshot.json': json, 'dir/ł.txt': [strToU8('zażółć'), { level: 0 }] });
    const files = await readZip(bytes);
    expect(files.get('snapshot.json')).toEqual(json);
    expect(dec.decode(files.get('dir/ł.txt'))).toBe('zażółć');
  });

  it('reads a zip with the data descriptor flag (sizes only in the central directory)', async () => {
    const json = enc.encode(jsonText(30_000));
    const raw = randomBytes(3000, 3);
    const chunks = [];
    const zip = new Zip((err, chunk) => {
      if (err) throw err;
      chunks.push(chunk);
    });
    const a = new ZipDeflate('snapshot.json', { level: 6 });
    zip.add(a);
    a.push(json.subarray(0, 1000));
    a.push(json.subarray(1000), true);
    const b = new ZipPassThrough('screenshot.jpg');
    zip.add(b);
    b.push(raw, true);
    zip.end();
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let p = 0;
    for (const c of chunks) {
      bytes.set(c, p);
      p += c.length;
    }
    expect(new DataView(bytes.buffer).getUint16(6, true) & 0x08).toBe(0x08);
    const files = await readZip(bytes);
    expect(files.get('snapshot.json')).toEqual(json);
    expect(files.get('screenshot.jpg')).toEqual(raw);
  });

  it('reads a zip with an archive comment', async () => {
    const { bytes, json } = await sample();
    const comment = enc.encode('archive comment');
    const withComment = new Uint8Array(bytes.length + comment.length);
    withComment.set(bytes);
    withComment.set(comment, bytes.length);
    new DataView(withComment.buffer).setUint16(bytes.length - 2, comment.length, true);
    expect((await readZip(withComment)).get('snapshot.json')).toEqual(json);
  });

  it('decodes names without the UTF-8 flag as latin1 (CP437 best-effort)', async () => {
    const { bytes } = await createZip([{ name: 'café.txt', data: enc.encode('x'), compress: false }]);
    const { view, central } = layout(bytes);
    view.setUint16(6, 0, true);
    view.setUint16(central + 8, 0, true);
    const files = await readZip(bytes);
    expect([...files.keys()]).toEqual(['cafÃ©.txt']);
  });
});

describe('readZip — errors', () => {
  it('not a zip → not-zip', async () => {
    await expectCode(readZip(enc.encode('{"schemaVersion":4}')), 'not-zip');
    await expectCode(readZip(new Uint8Array(0)), 'not-zip');
    await expectCode(readZip(randomBytes(4096)), 'not-zip');
    await expectCode(readZip('PK'), 'not-zip');
  });

  it('bad CRC → corrupt', async () => {
    const { bytes } = await sample();
    const { view, central } = layout(bytes);
    view.setUint32(central + 16, view.getUint32(central + 16, true) ^ 1, true);
    await expectCode(readZip(bytes), 'corrupt');
  });

  it('bad CRC of a stored entry → corrupt', async () => {
    const { bytes } = await createZip([{ name: 'a.bin', data: randomBytes(100), compress: false }]);
    bytes[30 + 5 + 10] ^= 0xff; // a byte of the data
    await expectCode(readZip(bytes), 'corrupt');
  });

  it('truncated file → corrupt', async () => {
    const { bytes } = await sample();
    await expectCode(readZip(bytes.subarray(0, Math.floor(bytes.length / 2))), 'corrupt');
    await expectCode(readZip(bytes.subarray(0, bytes.length - 10)), 'corrupt');
  });

  it('central directory pointing outside the file → corrupt', async () => {
    const { bytes } = await sample();
    const { view, eocd } = layout(bytes);
    view.setUint32(eocd + 16, bytes.length + 100, true);
    await expectCode(readZip(bytes), 'corrupt');
  });

  it('garbage deflate stream → corrupt', async () => {
    const { bytes } = await createZip([{ name: 'a.json', data: enc.encode(jsonText(5000)), compress: true }]);
    for (let i = 30 + 6; i < 30 + 6 + 40; i++) bytes[i] = 0xff;
    await expectCode(readZip(bytes), 'corrupt');
  });

  it('ZIP64 → unsupported', async () => {
    const { bytes } = await sample();
    const a = layout(bytes);
    a.view.setUint32(a.central + 20, 0xffffffff, true);
    await expectCode(readZip(bytes), 'unsupported');

    const b = await sample();
    const lb = layout(b.bytes);
    lb.view.setUint16(lb.eocd + 8, 0xffff, true);
    lb.view.setUint16(lb.eocd + 10, 0xffff, true);
    await expectCode(readZip(b.bytes), 'unsupported');
  });

  it('encrypted entry → unsupported; unknown method → unsupported', async () => {
    const { bytes } = await sample();
    const { view, central } = layout(bytes);
    view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
    await expectCode(readZip(bytes), 'unsupported');

    const other = await sample();
    const lo = layout(other.bytes);
    lo.view.setUint16(lo.central + 10, 12, true); // bzip2
    await expectCode(readZip(other.bytes), 'unsupported');
  });

  it('zip bomb ratio → too-large', async () => {
    const { bytes } = await createZip([{ name: 'zeros.json', data: new Uint8Array(4 * 1024 * 1024), compress: true }]);
    await expectCode(readZip(bytes), 'too-large');
  });

  it('declared size smaller than the inflated data → corrupt (inflation stops at the declared size)', async () => {
    const data = enc.encode(jsonText(200_000));
    const { bytes } = await createZip([{ name: 'a.json', data, compress: true }]);
    const { view, central } = layout(bytes);
    view.setUint32(central + 24, 1000, true);
    view.setUint32(22, 1000, true);
    await expectCode(readZip(bytes), 'corrupt');
  });

  it('limits: entries, entry size, total size → too-large', async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, data: enc.encode('x'.repeat(100)), compress: false }));
    const { bytes } = await createZip(files);
    await expectCode(readZip(bytes, { maxEntries: 4 }), 'too-large');
    await expectCode(readZip(bytes, { maxEntryBytes: 99 }), 'too-large');
    await expectCode(readZip(bytes, { maxTotalBytes: 450 }), 'too-large');
    expect((await readZip(bytes, { maxEntries: 5, maxEntryBytes: 100, maxTotalBytes: 500 })).size).toBe(5);
    expect(UNZIP_LIMITS).toMatchObject({
      maxEntries: 64,
      maxEntryBytes: 64 * 1024 * 1024,
      maxTotalBytes: 128 * 1024 * 1024,
      maxRatio: 200,
    });
    expect(Object.isFrozen(UNZIP_LIMITS)).toBe(true);
  });

  it('names with .. or a leading slash, and duplicate names → corrupt', async () => {
    for (const name of ['../evil.txt', 'a/../../b.txt', '/etc/passwd', '\\win.ini', 'a\\..\\b']) {
      const { bytes } = await createZip([{ name, data: enc.encode('x'), compress: false }]);
      await expectCode(readZip(bytes), 'corrupt');
    }
    const { bytes } = await createZip([
      { name: 'a.txt', data: enc.encode('1'), compress: false },
      { name: 'a.txt', data: enc.encode('2'), compress: false },
    ]);
    await expectCode(readZip(bytes), 'corrupt');
  });

  it('ZipError carries a code and a message', () => {
    const e = new ZipError('corrupt', 'bad crc');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ZipError');
    expect(e.code).toBe('corrupt');
    expect(e.message).toContain('bad crc');
  });
});

describe('readZip — performance', () => {
  it('10 MB JSON entry inflated ≤ 300 ms', async () => {
    const json = enc.encode(jsonText(10 * 1024 * 1024));
    const { bytes } = await createZip([{ name: 'snapshot.json', data: json, compress: true }]);
    await readZip(bytes); // warm-up (JIT, stream setup)
    const t0 = performance.now();
    const files = await readZip(bytes);
    const elapsed = performance.now() - t0;
    expect(files.get('snapshot.json').length).toBe(json.length);
    expect(elapsed).toBeLessThan(300);
  }, 30_000);
});
