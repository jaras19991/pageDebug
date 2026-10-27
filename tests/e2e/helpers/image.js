// Decodes an image in a throwaway tab (an <img> plus a canvas), so e2e can check the size, the colours and the
// brightness of regions of a screenshot from the package without extra dependencies (E2-TEST5, AC-6.1, 6.2;
// E3-TEST0: JPEG bytes from the zip, luma statistics of rectangles for the field mask in TEST4).

/**
 * @param {Uint8Array | ArrayBuffer | string} source JPEG/PNG bytes (e.g. `files['screenshot.jpg']`) or a data URL
 * @returns {string} a data URL
 */
function toDataUrl(source) {
  if (typeof source === 'string') return source;
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  return `data:image/${isPng ? 'png' : 'jpeg'};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect image pixels (not CSS pixels: multiply by dpr)
 * @typedef {{ pixels: number, mean: number, stddev: number, min: number, max: number }} LumaStats
 *   luma 0–255 (Rec. 601: 0.299 R + 0.587 G + 0.114 B); `pixels` 0 when the rect is outside the image.
 */

/**
 * @param {import('@playwright/test').BrowserContext} context
 * @param {Uint8Array | ArrayBuffer | string} source JPEG bytes or a data URL
 * @param {{ cornerSize?: number, regions?: Rect[] }} [options] cornerSize: side of the square averaged in every
 *   corner (default 6 px); regions: rectangles to measure (clipped to the image, coordinates rounded outwards).
 * @returns {Promise<{ width: number, height: number, corners: { topLeft: number[], topRight: number[], bottomLeft: number[],
 *   bottomRight: number[] }, regions: LumaStats[] }>} corners: mean [r, g, b] of each corner square.
 */
export async function decodeImage(context, source, { cornerSize = 6, regions = [] } = {}) {
  const page = await context.newPage();
  try {
    await page.goto('about:blank');
    return await page.evaluate(
      async ({ url, size, rects }) => {
        const img = new globalThis.Image();
        img.src = url;
        await img.decode();
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const w = canvas.width;
        const h = canvas.height;
        const mean = (x, y) => {
          const { data } = ctx.getImageData(x, y, size, size);
          const sum = [0, 0, 0];
          for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
          return sum.map((v) => Math.round(v / (data.length / 4)));
        };
        const luma = (r) => {
          const x0 = Math.max(0, Math.floor(r.x));
          const y0 = Math.max(0, Math.floor(r.y));
          const x1 = Math.min(w, Math.ceil(r.x + r.width));
          const y1 = Math.min(h, Math.ceil(r.y + r.height));
          if (x1 <= x0 || y1 <= y0) return { pixels: 0, mean: 0, stddev: 0, min: 0, max: 0 };
          const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
          let sum = 0;
          let sq = 0;
          let min = 255;
          let max = 0;
          const n = data.length / 4;
          for (let i = 0; i < data.length; i += 4) {
            const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            sum += l;
            sq += l * l;
            if (l < min) min = l;
            if (l > max) max = l;
          }
          const m = sum / n;
          return { pixels: n, mean: m, stddev: Math.sqrt(Math.max(0, sq / n - m * m)), min, max };
        };
        return {
          width: w,
          height: h,
          corners: {
            topLeft: mean(0, 0),
            topRight: mean(w - size, 0),
            bottomLeft: mean(0, h - size),
            bottomRight: mean(w - size, h - size),
          },
          regions: rects.map(luma),
        };
      },
      { url: toDataUrl(source), size: cornerSize, rects: regions },
    );
  } finally {
    await page.close();
  }
}

/**
 * Luma statistics of `rects` in the image (TEST4: a masked field is uniform, stddev ≤ 2% of 255).
 * @param {import('@playwright/test').BrowserContext} context
 * @param {Uint8Array | ArrayBuffer | string} source
 * @param {Rect[]} rects
 * @returns {Promise<LumaStats[]>}
 */
export async function regionLuma(context, source, rects) {
  return (await decodeImage(context, source, { regions: rects })).regions;
}

/**
 * Mean absolute luma difference (0–255) between the same rectangle of two images of equal size (E4-TEST4b: the label
 * above a masked field must look as in an unmasked capture; JPEG against PNG leaves a small residue).
 * @param {import('@playwright/test').BrowserContext} context
 * @param {Uint8Array | ArrayBuffer | string} a
 * @param {Uint8Array | ArrayBuffer | string} b
 * @param {Rect} rect image pixels
 * @returns {Promise<{ widthA: number, heightA: number, widthB: number, heightB: number, pixels: number, meanDiff: number }>}
 */
export async function lumaDiff(context, a, b, rect) {
  const page = await context.newPage();
  try {
    await page.goto('about:blank');
    return await page.evaluate(
      async ({ urlA, urlB, r }) => {
        const load = async (url) => {
          const img = new globalThis.Image();
          img.src = url;
          await img.decode();
          const canvas = globalThis.document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          return { w: canvas.width, h: canvas.height, ctx };
        };
        const A = await load(urlA);
        const B = await load(urlB);
        const x0 = Math.max(0, Math.floor(r.x));
        const y0 = Math.max(0, Math.floor(r.y));
        const x1 = Math.min(A.w, B.w, Math.ceil(r.x + r.width));
        const y1 = Math.min(A.h, B.h, Math.ceil(r.y + r.height));
        const out = { widthA: A.w, heightA: A.h, widthB: B.w, heightB: B.h, pixels: 0, meanDiff: 0 };
        if (x1 <= x0 || y1 <= y0) return out;
        const da = A.ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        const db = B.ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        let sum = 0;
        for (let i = 0; i < da.length; i += 4) {
          const la = 0.299 * da[i] + 0.587 * da[i + 1] + 0.114 * da[i + 2];
          const lb = 0.299 * db[i] + 0.587 * db[i + 1] + 0.114 * db[i + 2];
          sum += Math.abs(la - lb);
        }
        out.pixels = da.length / 4;
        out.meanDiff = sum / out.pixels;
        return out;
      },
      { urlA: toDataUrl(a), urlB: toDataUrl(b), r: rect },
    );
  } finally {
    await page.close();
  }
}
