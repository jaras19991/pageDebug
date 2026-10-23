/* global chrome, createImageBitmap, OffscreenCanvas */
// E2-T0 spike background: service worker in Chrome, module event page in Firefox.
// capture(): captureVisibleTab jpeg 60 → decode (manual base64, no fetch) → dims + 4 corner colours.
// With the `webRequest` overlay (S5) it records onCompleted/onErrorOccurred URLs.
const seen = [];

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function decode(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
  const w = bitmap.width, h = bitmap.height;
  return { bitmap, canvas, width: w, height: h, corners: [px(2, 2), px(w - 3, 2), px(2, h - 3), px(w - 3, h - 3)] };
}

async function capture({ windowId, summary = false }) {
  const t0 = performance.now();
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 });
    const ms = Math.round(performance.now() - t0);
    const blob = dataUrlToBlob(dataUrl);
    if (summary) return { ok: true, ms, bytes: blob.size };
    const d = await decode(blob);
    // Re-encode probe (fitJpeg path): quality 0.45 and 0.75 scale.
    const q45 = await d.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.45 });
    const small = new OffscreenCanvas(Math.round(d.width * 0.75), Math.round(d.height * 0.75));
    small.getContext('2d').drawImage(d.bitmap, 0, 0, small.width, small.height);
    const scaled = await small.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
    return {
      ok: true, ms, prefix: dataUrl.slice(0, 23), base64Chars: dataUrl.length, bytes: blob.size,
      width: d.width, height: d.height, corners: d.corners,
      reencode: { q45: q45.size, q45type: q45.type, scaled: scaled.size, scaledDims: [small.width, small.height] },
    };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t0), error: String(e?.message ?? e) };
  }
}

async function codecProbe() {
  const c = new OffscreenCanvas(64, 32);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(200,10,10)';
  ctx.fillRect(0, 0, 64, 32);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
  const bm = await createImageBitmap(blob);
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { type: blob.type, size: blob.size, dims: [bm.width, bm.height], dataUrlPrefix: `data:${blob.type};base64,${btoa(bin)}`.slice(0, 30) };
}

async function handle(msg) {
  switch (msg?.type) {
    case 'capture': return capture(msg);
    case 'codecProbe': return codecProbe().catch((e) => ({ error: String(e?.message ?? e) }));
    case 'seen': return seen.slice();
    default: return { error: 'unknown' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg).then(sendResponse, (e) => sendResponse({ error: String(e?.message ?? e) }));
  return true;
});

if (chrome.webRequest) {
  const filter = { urls: ['<all_urls>'] };
  chrome.webRequest.onCompleted.addListener((d) => seen.push({ ev: 'completed', url: d.url, type: d.type, status: d.statusCode, initiator: d.initiator ?? d.originUrl ?? null }), filter);
  chrome.webRequest.onErrorOccurred.addListener((d) => seen.push({ ev: 'error', url: d.url, type: d.type, error: d.error }), filter);
}

globalThis.spike = { capture, codecProbe, seen };
