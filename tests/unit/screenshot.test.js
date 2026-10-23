import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  captureScreenshot,
  fitJpeg,
  bytesOfDataUrl,
  dataUrlToBlob,
  blobToDataUrl,
  jpegDimensions,
  createCanvasCodec,
  screenshotErrorReason,
  SCREENSHOT_LIMITS,
} from '../../src/lib/screenshot.js';

const source = readFileSync(fileURLToPath(new URL('../../src/lib/screenshot.js', import.meta.url)), 'utf8');
const MAX = 307200;

// Minimal JPEG: SOI, APP0 stub, SOF0 with the dimensions, filler, EOI. Exactly `size` bytes.
function fakeJpegBytes(width, height, size) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03];
  const bytes = new Uint8Array(Math.max(size, head.length + 2));
  bytes.set(head);
  bytes[bytes.length - 2] = 0xff;
  bytes[bytes.length - 1] = 0xd9;
  return bytes;
}

function toDataUrl(bytes) {
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
}

// Fake codec: encoded size = pixels × bytes-per-pixel(quality). Records every attempt.
function fakeCodec(bppByQuality = { 45: 0.07, 30: 0.05 }) {
  const calls = [];
  const codec = {
    calls,
    async decode(dataUrl) {
      const dims = jpegDimensions(dataUrl);
      return { bitmap: { close: vi.fn() }, ...dims };
    },
    async encode(_bitmap, width, height, quality) {
      calls.push({ width, height, quality });
      const size = Math.round(width * height * (bppByQuality[quality] ?? 1));
      // Oversized results are never read by the module, so they need no bytes (keeps the test cheap).
      if (size > 4 * MAX) return { size, type: 'image/jpeg' };
      return new Blob([fakeJpegBytes(width, height, size)], { type: 'image/jpeg' });
    },
  };
  return codec;
}

function fakeTabs(result) {
  return { captureVisibleTab: vi.fn(async () => (typeof result === 'function' ? result() : result)) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('data URL helpers', () => {
  it('bytes counts decoded JPEG bytes, not base64 length', () => {
    for (const size of [100, 101, 102, 1000, 81234]) {
      const url = toDataUrl(fakeJpegBytes(10, 10, size));
      expect(bytesOfDataUrl(url)).toBe(size);
      expect(url.length).toBeGreaterThan(size);
    }
    expect(bytesOfDataUrl('not a data url')).toBe(0);
    expect(bytesOfDataUrl(null)).toBe(0);
  });

  it('dataUrlToBlob and blobToDataUrl round-trip without fetch', async () => {
    const bytes = fakeJpegBytes(640, 480, 200000);
    const url = toDataUrl(bytes);
    const blob = dataUrlToBlob(url);
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBe(200000);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(await blobToDataUrl(blob)).toBe(url);
  });

  it('jpegDimensions reads the SOF segment', () => {
    expect(jpegDimensions(toDataUrl(fakeJpegBytes(1280, 720, 500)))).toEqual({ width: 1280, height: 720 });
    expect(jpegDimensions('data:image/jpeg;base64,AAAA')).toBeNull();
  });

  it('module source contains no fetch(', () => {
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\b(window|document)\b/);
  });
});

describe('fitJpeg (AC-6.1, AC-6.5)', () => {
  it('image under limit is returned unchanged (same dims)', async () => {
    const dataUrl = toDataUrl(fakeJpegBytes(1280, 720, 81234));
    const codec = fakeCodec();
    const fit = await fitJpeg({ dataUrl, maxBytes: MAX, codec });
    expect(fit).toEqual({ dataUrl, width: 1280, height: 720, bytes: 81234, mime: 'image/jpeg' });
    expect(codec.calls).toEqual([]);
  });

  it('4K image is recompressed/downscaled to ≤ 307200 bytes, never truncated', async () => {
    const dataUrl = toDataUrl(fakeJpegBytes(3840, 2160, Math.round(3840 * 2160 * 0.1)));
    const codec = fakeCodec();
    const fit = await fitJpeg({ dataUrl, maxBytes: MAX, codec });
    expect(fit.error).toBeUndefined();
    expect(fit.bytes).toBeLessThanOrEqual(MAX);
    expect(bytesOfDataUrl(fit.dataUrl)).toBe(fit.bytes);
    // The result is a whole JPEG of the reported size: dimensions readable, EOI at the end.
    expect(jpegDimensions(fit.dataUrl)).toEqual({ width: fit.width, height: fit.height });
    const bytes = new Uint8Array(await dataUrlToBlob(fit.dataUrl).arrayBuffer());
    expect([...bytes.slice(-2)]).toEqual([0xff, 0xd9]);
    expect(fit.width / fit.height).toBeCloseTo(3840 / 2160, 2);
    expect(codec.calls.length).toBeLessThanOrEqual(SCREENSHOT_LIMITS.attempts);
  });

  it('quality ladder before downscale', async () => {
    const dataUrl = toDataUrl(fakeJpegBytes(3840, 2160, 900000));
    const codec = fakeCodec();
    await fitJpeg({ dataUrl, maxBytes: MAX, codec });
    expect(codec.calls.map((c) => [c.quality, c.width])).toEqual([
      [45, 3840],
      [30, 3840],
      [30, 2880],
    ]);
  });

  it('stops at the first quality that fits', async () => {
    const dataUrl = toDataUrl(fakeJpegBytes(1000, 1000, 400000));
    const codec = fakeCodec({ 45: 0.3, 30: 0.2 });
    const fit = await fitJpeg({ dataUrl, maxBytes: MAX, codec });
    expect(codec.calls).toEqual([{ width: 1000, height: 1000, quality: 45 }]);
    expect(fit).toMatchObject({ width: 1000, height: 1000, bytes: 300000 });
  });

  it('gives up below 320 px with too-large', async () => {
    const dataUrl = toDataUrl(fakeJpegBytes(400, 300, 400000));
    const codec = fakeCodec({ 45: 10, 30: 10 });
    const fit = await fitJpeg({ dataUrl, maxBytes: MAX, codec });
    expect(fit).toEqual({ error: 'too-large' });
    expect(codec.calls.every((c) => c.width >= 320)).toBe(true);
    expect(codec.calls.map((c) => c.width)).toEqual([400, 400]);
  });

  it('never tries more than 8 encodings', async () => {
    const dataUrl = toDataUrl(fakeJpegBytes(16000, 9000, 400000));
    const codec = fakeCodec({ 45: 100, 30: 100 });
    expect(await fitJpeg({ dataUrl, maxBytes: MAX, codec })).toEqual({ error: 'too-large' });
    expect(codec.calls).toHaveLength(8);
  });

  it('codec failure or missing codec → too-large, bitmap closed', async () => {
    const dataUrl = toDataUrl(fakeJpegBytes(3840, 2160, 900000));
    const close = vi.fn();
    const broken = { decode: async () => ({ bitmap: { close }, width: 3840, height: 2160 }), encode: async () => { throw new Error('x'); } };
    expect(await fitJpeg({ dataUrl, maxBytes: MAX, codec: broken })).toEqual({ error: 'too-large' });
    expect(close).toHaveBeenCalled();
    expect(await fitJpeg({ dataUrl, maxBytes: MAX, codec: null })).toEqual({ error: 'too-large' });
  });
});

describe('captureScreenshot (AC-6.4)', () => {
  const tab = { id: 7, windowId: 3 };

  it('captures the visible tab as JPEG 60 and returns the shot', async () => {
    const dataUrl = toDataUrl(fakeJpegBytes(1280, 720, 81234));
    const tabs = fakeTabs(dataUrl);
    const res = await captureScreenshot({ tabs, tab, codec: fakeCodec(), now: () => 1768471209430, maxBytes: MAX });
    expect(tabs.captureVisibleTab).toHaveBeenCalledWith(3, { format: 'jpeg', quality: 60 });
    expect(res).toEqual({ shot: { epochMs: 1768471209430, mime: 'image/jpeg', width: 1280, height: 720, bytes: 81234, dataUrl } });
  });

  it('captureVisibleTab throwing → capture-failed', async () => {
    const tabs = fakeTabs(() => {
      throw new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.');
    });
    expect(await captureScreenshot({ tabs, tab, codec: fakeCodec(), maxBytes: MAX })).toEqual({ error: 'capture-failed' });
    expect(await captureScreenshot({ tabs: {}, tab, codec: fakeCodec(), maxBytes: MAX })).toEqual({ error: 'capture-failed' });
  });

  it('non-JPEG or empty result → capture-failed', async () => {
    for (const bad of [undefined, '', 'data:image/png;base64,iVBORw0KGgo=', 42]) {
      expect(await captureScreenshot({ tabs: fakeTabs(bad), tab, codec: fakeCodec(), maxBytes: MAX })).toEqual({ error: 'capture-failed' });
    }
  });

  it('hanging capture → timeout after 3 s', async () => {
    vi.useFakeTimers();
    const tabs = { captureVisibleTab: vi.fn(() => new Promise(() => {})) };
    let settled = null;
    const p = captureScreenshot({ tabs, tab, codec: fakeCodec(), maxBytes: MAX }).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toEqual({ error: 'timeout' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('too large to fit → too-large', async () => {
    const dataUrl = toDataUrl(fakeJpegBytes(400, 300, 400000));
    const res = await captureScreenshot({ tabs: fakeTabs(dataUrl), tab, codec: fakeCodec({ 45: 10, 30: 10 }), maxBytes: MAX });
    expect(res).toEqual({ error: 'too-large' });
  });

  it('failure reasons are mapped in one place', () => {
    expect(screenshotErrorReason('api-error')).toBe('capture-failed');
    expect(screenshotErrorReason('bad-result')).toBe('capture-failed');
    expect(screenshotErrorReason('timeout')).toBe('timeout');
    expect(screenshotErrorReason('no-fit')).toBe('too-large');
    expect(screenshotErrorReason('codec-error')).toBe('too-large');
    expect(screenshotErrorReason('anything-else')).toBe('capture-failed');
  });
});

describe('createCanvasCodec', () => {
  it('uses createImageBitmap and OffscreenCanvas of the given scope', async () => {
    const drawImage = vi.fn();
    const convertToBlob = vi.fn(async (opts) => new Blob([new Uint8Array(5)], { type: opts.type }));
    const scope = {
      createImageBitmap: vi.fn(async () => ({ width: 800, height: 600, close() {} })),
      OffscreenCanvas: class {
        constructor(w, h) {
          this.width = w;
          this.height = h;
        }
        getContext() {
          return { drawImage };
        }
        convertToBlob(opts) {
          return convertToBlob(opts);
        }
      },
    };
    const codec = createCanvasCodec(scope);
    const decoded = await codec.decode(toDataUrl(fakeJpegBytes(800, 600, 100)));
    expect(decoded).toMatchObject({ width: 800, height: 600 });
    expect(scope.createImageBitmap.mock.calls[0][0]).toBeInstanceOf(Blob);
    const blob = await codec.encode(decoded.bitmap, 400, 300, 45);
    expect(blob.size).toBe(5);
    expect(drawImage).toHaveBeenCalledWith(decoded.bitmap, 0, 0, 400, 300);
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.45 });
  });

  it('returns null when the scope lacks the APIs', () => {
    expect(createCanvasCodec({})).toBeNull();
  });
});
