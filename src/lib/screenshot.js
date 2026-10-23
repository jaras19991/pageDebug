// Screenshot at *Zapisz paczkę* (E2 D5): `captureVisibleTab` in the background (activeTab granted by the popup
// click), JPEG 60, fitted to `limits.screenshotBytes` by re-encoding, never by cutting the file.
// Runs in the Chrome service worker and the Firefox event page: no DOM, and no network call of any kind
// (AC-4.9) — data URLs are decoded by hand with `atob`, not by loading them.

export const SCREENSHOT_LIMITS = Object.freeze({
  bytes: 307200,
  timeoutMs: 3000,
  captureQuality: 60,
  // Re-encoding ladder at full size; after it the image is scaled down at the last quality.
  qualities: Object.freeze([45, 30]),
  scaleStep: 0.75,
  minWidth: 320,
  attempts: 8,
  // A 4K JPEG at quality 60 is a few MB; anything far beyond is not a screenshot we can use.
  dataUrlChars: 50 * 1024 * 1024,
  // SOF is in the first segments; this many base64 characters (48 KB of JPEG) are read to find it.
  headerChars: 65536,
});

const MIME = 'image/jpeg';
const JPEG_PREFIX = 'data:image/jpeg;base64,';

// The single place that maps failures to the reasons in `screenshotNote` (spike E2-T0/S1 may refine it,
// e.g. a separate reason for the per-second call quota). Keys are internal failure kinds.
const FAILURE_REASONS = Object.freeze({
  'api-error': 'capture-failed', // captureVisibleTab threw or is missing (permission, quota, hidden tab)
  'bad-result': 'capture-failed', // API answered with something that is not a JPEG data URL
  timeout: 'timeout',
  'no-fit': 'too-large', // nothing at ≥ 320 px width fits into the limit
  'codec-error': 'too-large', // decoding/encoding not available or failed, so the image cannot be shrunk
});

/** @returns {'capture-failed'|'timeout'|'too-large'} */
export function screenshotErrorReason(kind) {
  return FAILURE_REASONS[kind] || 'capture-failed';
}

function fail(kind) {
  return { error: screenshotErrorReason(kind) };
}

function base64Of(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > SCREENSHOT_LIMITS.dataUrlChars) return null;
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0 || !dataUrl.slice(0, comma).endsWith(';base64')) return null;
  return dataUrl.slice(comma + 1);
}

function mimeOf(dataUrl) {
  return dataUrl.slice(5, dataUrl.indexOf(';'));
}

function decodeBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Decoded size in bytes of a base64 data URL (what `limits.screenshotBytes` counts), 0 if not one. */
export function bytesOfDataUrl(dataUrl) {
  const b64 = base64Of(dataUrl);
  if (!b64) return 0;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/** Data URL → Blob by decoding base64 by hand (no network API). */
export function dataUrlToBlob(dataUrl) {
  const b64 = base64Of(dataUrl);
  if (b64 === null) throw new TypeError('not a base64 data URL');
  return new Blob([decodeBase64(b64)], { type: mimeOf(dataUrl) });
}

/** Blob → base64 data URL (`arrayBuffer` + `btoa` in chunks, so large images do not overflow the stack). */
export async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return `data:${blob.type || MIME};base64,${btoa(bin)}`;
}

/**
 * Width and height from the JPEG SOF segment, without decoding pixels.
 * @returns {{ width: number, height: number } | null}
 */
export function jpegDimensions(dataUrl) {
  const b64 = base64Of(dataUrl);
  if (!b64) return null;
  let bytes;
  try {
    const head = b64.slice(0, SCREENSHOT_LIMITS.headerChars);
    bytes = decodeBase64(head.slice(0, head.length - (head.length % 4)));
  } catch {
    return null;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

/**
 * Fits a JPEG data URL into `maxBytes` (D5): unchanged when it already fits (exact dimensions, AC-6.1);
 * otherwise re-encoded at quality 45 and 30, then scaled by 0.75 per step while the width stays ≥ 320 px,
 * at most 8 encodings. The file is never cut (AC-6.5).
 * @param {{ dataUrl: string, maxBytes?: number, codec: ReturnType<typeof createCanvasCodec> }} options
 * @returns {Promise<{ dataUrl: string, width: number, height: number, bytes: number, mime: string } | { error: string }>}
 */
export async function fitJpeg({ dataUrl, maxBytes = SCREENSHOT_LIMITS.bytes, codec }) {
  const bytes = bytesOfDataUrl(dataUrl);
  if (bytes === 0) return fail('bad-result');
  if (bytes <= maxBytes) {
    let dims = jpegDimensions(dataUrl);
    if (!dims && codec) {
      try {
        const decoded = await codec.decode(dataUrl);
        dims = { width: decoded.width, height: decoded.height };
        decoded.bitmap?.close?.();
      } catch {
        dims = null;
      }
    }
    if (!dims) return fail('bad-result');
    return { dataUrl, width: dims.width, height: dims.height, bytes, mime: MIME };
  }
  if (!codec) return fail('codec-error');

  let decoded;
  try {
    decoded = await codec.decode(dataUrl);
  } catch {
    return fail('codec-error');
  }
  try {
    const { bitmap, width, height } = decoded;
    const plan = SCREENSHOT_LIMITS.qualities.map((quality) => ({ scale: 1, quality }));
    const lastQuality = SCREENSHOT_LIMITS.qualities[SCREENSHOT_LIMITS.qualities.length - 1];
    for (let scale = SCREENSHOT_LIMITS.scaleStep; plan.length < SCREENSHOT_LIMITS.attempts; scale *= SCREENSHOT_LIMITS.scaleStep) {
      if (Math.round(width * scale) < SCREENSHOT_LIMITS.minWidth) break;
      plan.push({ scale, quality: lastQuality });
    }
    for (const { scale, quality } of plan) {
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const blob = await codec.encode(bitmap, w, h, quality);
      if (blob.size <= maxBytes) {
        return { dataUrl: await blobToDataUrl(blob), width: w, height: h, bytes: blob.size, mime: MIME };
      }
    }
    return fail('no-fit');
  } catch {
    return fail('codec-error');
  } finally {
    try {
      decoded.bitmap?.close?.();
    } catch {
      // Closing is best effort.
    }
  }
}

/**
 * Captures the visible part of `tab` (JPEG 60) and fits it into `maxBytes`. Failures never throw: they give
 * `{ error }` and the save goes on without a screenshot (AC-6.4). `timeoutMs` bounds capture and fitting.
 * @param {{ tabs: { captureVisibleTab: Function }, tab: { windowId?: number }, codec: object | null,
 *   now?: () => number, maxBytes?: number, timeoutMs?: number }} options
 * @returns {Promise<{ shot: { epochMs: number, mime: string, width: number, height: number, bytes: number,
 *   dataUrl: string } } | { error: 'capture-failed' | 'timeout' | 'too-large' }>}
 */
export async function captureScreenshot({ tabs, tab, codec, now = Date.now, maxBytes = SCREENSHOT_LIMITS.bytes, timeoutMs = SCREENSHOT_LIMITS.timeoutMs }) {
  const run = async () => {
    const epochMs = now();
    let dataUrl;
    try {
      dataUrl = await tabs.captureVisibleTab(tab && tab.windowId, { format: 'jpeg', quality: SCREENSHOT_LIMITS.captureQuality });
    } catch {
      return fail('api-error');
    }
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(JPEG_PREFIX)) return fail('bad-result');
    const fit = await fitJpeg({ dataUrl, maxBytes, codec });
    if (fit.error) return fit;
    return { shot: { epochMs, mime: fit.mime, width: fit.width, height: fit.height, bytes: fit.bytes, dataUrl: fit.dataUrl } };
  };
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fail('timeout')), timeoutMs);
  });
  try {
    return await Promise.race([run().catch(() => fail('api-error')), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Codec on `createImageBitmap` + `OffscreenCanvas` (Chrome SW, Firefox event page). Covered by e2e:
 * jsdom/Node have neither API. `null` when the scope lacks them (the screenshot is then kept only if it fits).
 */
export function createCanvasCodec(scope = globalThis) {
  if (!scope || typeof scope.createImageBitmap !== 'function' || typeof scope.OffscreenCanvas !== 'function') return null;
  return {
    async decode(dataUrl) {
      const bitmap = await scope.createImageBitmap(dataUrlToBlob(dataUrl));
      return { bitmap, width: bitmap.width, height: bitmap.height };
    },
    async encode(bitmap, width, height, quality) {
      const canvas = new scope.OffscreenCanvas(width, height);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      return canvas.convertToBlob({ type: MIME, quality: quality / 100 });
    },
  };
}
