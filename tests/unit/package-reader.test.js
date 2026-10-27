// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { readPackage, readErrorMessage, READ_ERRORS_PL, READER_LIMITS } from '../../src/lib/package-reader.js';
import { PackageError } from '../../src/lib/migrate.js';
import { createZip } from '../../src/lib/zip.js';
import { exportPackage } from '../../src/lib/export.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const fixtureBytes = (v) => readFileSync(new URL(`../fixtures/snapshots/v${v}.json`, import.meta.url));
const fixture = (v) => JSON.parse(dec.decode(fixtureBytes(v)));

const STARTED = Date.UTC(2026, 9, 26, 8, 0, 0);
const DATE = new Date(2026, 9, 26, 14, 5, 9);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

// Smallest exportPackage input with one error, one request and a screenshot (shape as in export.test.js).
function exportInput() {
  return {
    meta: {
      extensionVersion: '0.6.0', source: 'extension', startedAt: STARTED, collectedAt: STARTED + 60_000, stopReason: null,
      screenshots: [{ epochMs: STARTED + 35_000, mime: 'image/jpeg', width: 1, height: 1, bytes: JPEG.length,
        dataUrl: `data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`, maskedFields: 0 }],
    },
    current: {
      protocol: 3, docId: 1, url: 'https://app.example.test/page', timeOrigin: STARTED + 30_000, navigationType: 'navigate', stopReason: null,
      environment: { location: { href: 'https://app.example.test/page', hostname: 'app.example.test', pathname: '/page' } },
      performance: { timeOrigin: STARTED + 30_000, navigation: null, resources: [] },
      storage: { cookies: 'consent=1', localStorage: {}, sessionStorage: {} },
      dom: { counts: { totalElements: 3, forms: 0 }, html: { lang: 'pl' }, forms: [], structure: '<html></html>', structureTruncated: false, omittedElements: 0 },
      consoleLogs: [{ t: 11, level: 'error', args: ['save failed'] }],
      runtimeErrors: [{ t: 12, type: 'error', message: 'TypeError: x is undefined', filename: 'https://app.example.test/a.js', lineno: 1, colno: 2 }],
      network: [{ t: 5, type: 'fetch', method: 'POST', url: 'https://app.example.test/api', status: 500, ok: false, durationMs: 3, error: null }],
      steps: [{ t: 2, type: 'click', selector: '#save', text: 'Zapisz' }],
      truncated: {},
      counts: { consoleLogs: 1, runtimeErrors: 1, network: 1, steps: 1 },
    },
    priorDocs: [],
    docs: [{ id: 1, url: 'https://app.example.test/page' }],
  };
}

async function readError(bytes) {
  try {
    await readPackage(bytes);
  } catch (err) {
    return err;
  }
  throw new Error('readPackage did not throw');
}

describe('readPackage — zip (E4-T8, AC-4.1)', () => {
  it('zip from exportPackage(v4 input) → snapshot deep-equals snapshot.json, summaryMd present, screenshot bytes present', async () => {
    const { bytes } = await exportPackage({ input: exportInput(), date: DATE });
    const files = unzipSync(bytes);
    const out = await readPackage(bytes);
    expect(out.format).toBe('zip');
    expect(out.snapshot).toEqual(JSON.parse(dec.decode(files['snapshot.json'])));
    expect(out.sourceVersion).toBe(4);
    expect(out.newer).toBe(false);
    expect(out.warnings).toEqual([]);
    expect(out.summaryMd).toBe(dec.decode(files['summary.md']));
    expect(out.screenshot.mime).toBe('image/jpeg');
    expect(out.screenshot.bytes).toEqual(JPEG);
  });

  it('accepts ArrayBuffer and a zip without summary.md and screenshot', async () => {
    const { bytes } = await createZip([{ name: 'snapshot.json', data: fixtureBytes(4), compress: true }]);
    const out = await readPackage(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(out.snapshot).toEqual(fixture(4));
    expect(out.summaryMd).toBeNull();
    expect(out.screenshot).toBeNull();
  });
});

describe('readPackage — JSON (E4-T8, AC-4.1, AC-4.7)', () => {
  it('v2.json / v3.json bytes → normalized', async () => {
    const v2 = await readPackage(fixtureBytes(2));
    expect(v2.format).toBe('json');
    expect(v2.sourceVersion).toBe(2);
    expect(v2.snapshot.schemaVersion).toBe(4);
    expect(v2.snapshot.steps).toEqual([]);
    expect(v2.summaryMd).toBeNull();

    const v3 = await readPackage(fixtureBytes(3));
    expect(v3.sourceVersion).toBe(3);
    expect(v3.snapshot.schemaVersion).toBe(4);
    expect(Array.isArray(v3.snapshot.storage.cookies)).toBe(true);
    // v3 keeps the image as a data URL in `attachments` (136 bytes of JPEG in the fixture)
    expect(v3.screenshot.mime).toBe('image/jpeg');
    expect(v3.screenshot.bytes.length).toBe(136);
    expect([...v3.screenshot.bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  });

  it('sourceVersion < 4 → warning "unredacted" in Polish; v4 has none (E4-FIX2)', async () => {
    for (const v of [2, 3]) {
      const out = await readPackage(fixtureBytes(v));
      expect(out.warnings).toContainEqual({ code: 'unredacted', message: 'Paczka sprzed automatycznej redakcji — może zawierać hasła i tokeny' });
    }
    expect((await readPackage(fixtureBytes(4))).warnings).toEqual([]);
  });

  it('v4 JSON with a UTF-8 BOM and leading whitespace', async () => {
    const body = fixtureBytes(4);
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x0a, 0x20, ...body]);
    const out = await readPackage(withBom);
    expect(out.snapshot).toEqual(fixture(4));
    expect(out.screenshot).toBeNull();
  });

  it('schemaVersion 5 → newer with a warning, data untouched', async () => {
    const raw = { ...fixture(4), schemaVersion: 5, futureField: { a: 1 } };
    const out = await readPackage(enc.encode(JSON.stringify(raw)));
    expect(out.newer).toBe(true);
    expect(out.warnings.map((w) => w.code)).toContain('newer');
    expect(out.snapshot).toEqual(raw);

    const { bytes } = await createZip([{ name: 'snapshot.json', data: enc.encode(JSON.stringify(raw)), compress: true }]);
    expect((await readPackage(bytes)).newer).toBe(true);
  });
});

describe('readPackage — errors (E4-T8, AC-4.7, AC-5.2)', () => {
  it('random bytes, truncated zip, zip without snapshot.json, invalid JSON → PackageError with code; every code has a Polish message', async () => {
    const random = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 251);
    const { bytes: good } = await createZip([{ name: 'snapshot.json', data: fixtureBytes(4), compress: true }]);
    const { bytes: noSnapshot } = await createZip([{ name: 'other.txt', data: enc.encode('hello'), compress: false }]);
    const { bytes: badJsonZip } = await createZip([{ name: 'snapshot.json', data: enc.encode('{"schemaVersion": 4,'), compress: true }]);
    const cases = [
      [random, 'not-package'],
      [good.subarray(0, good.length - 30), 'corrupt'],
      [noSnapshot, 'not-package'],
      [badJsonZip, 'corrupt'],
      [enc.encode('{"schemaVersion": 4, "network": ['), 'corrupt'],
      [enc.encode('[1, 2, 3]'), 'not-package'],
      [enc.encode('{"hello": "world"}'), 'not-package'],
      [enc.encode('plain text, not json'), 'not-package'],
      [new Uint8Array(0), 'not-package'],
      [Uint8Array.from([0xff, 0xfe, 0x7b, 0x00]), 'not-package'],
    ];
    for (const [bytes, code] of cases) {
      const err = await readError(bytes);
      expect(err, code).toBeInstanceOf(PackageError);
      expect(err.code).toBe(code);
      expect(readErrorMessage(err)).toBe(READ_ERRORS_PL[code]);
    }
    expect(READ_ERRORS_PL).toEqual({
      'not-package': 'To nie jest plik paczki.',
      corrupt: 'Plik paczki jest uszkodzony.',
      'too-large': 'Plik jest za duży.',
      unsupported: 'Nieobsługiwany format pliku.',
    });
  });

  it('zip limits map to too-large and unsupported; non-binary input is not a package', async () => {
    const { bytes } = await createZip([{ name: 'snapshot.json', data: fixtureBytes(4), compress: false }]);
    const encrypted = bytes.slice();
    // general purpose flag bit 0 (encrypted) in the central directory entry
    const cd = encrypted.findLastIndex((_, i) => encrypted[i] === 0x50 && encrypted[i + 1] === 0x4b && encrypted[i + 2] === 0x01 && encrypted[i + 3] === 0x02);
    encrypted[cd + 8] |= 1;
    expect((await readError(encrypted)).code).toBe('unsupported');
    expect((await readError('{"schemaVersion":4}')).code).toBe('not-package');
    expect((await readError(null)).code).toBe('not-package');
  });

  it('JSON above the limit → too-large before parsing', async () => {
    const big = new Uint8Array(READER_LIMITS.maxJsonBytes + 1).fill(0x20);
    big[0] = 0x7b;
    expect((await readError(big)).code).toBe('too-large');
  });

  it('readErrorMessage: unknown errors read as a damaged file', () => {
    expect(readErrorMessage(new TypeError('boom'))).toBe(READ_ERRORS_PL.corrupt);
    expect(readErrorMessage(new PackageError('weird'))).toBe(READ_ERRORS_PL.corrupt);
    expect(readErrorMessage(null)).toBe(READ_ERRORS_PL.corrupt);
  });
});
