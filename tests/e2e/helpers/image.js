// Decodes a data URL image in a throwaway tab (an <img> plus a canvas), so e2e can check the size and the colours of a
// screenshot from the package without extra dependencies (E2-TEST5, AC-6.1, 6.2).

/**
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} dataUrl
 * @param {{ cornerSize?: number }} [options] cornerSize: side of the square averaged in every corner (default 6 px).
 * @returns {Promise<{ width: number, height: number, corners: { topLeft: number[], topRight: number[], bottomLeft: number[], bottomRight: number[] } }>}
 *   corners: mean [r, g, b] of each corner square.
 */
export async function decodeImage(context, dataUrl, { cornerSize = 6 } = {}) {
  const page = await context.newPage();
  try {
    await page.goto('about:blank');
    return await page.evaluate(
      async ({ url, size }) => {
        const img = new globalThis.Image();
        img.src = url;
        await img.decode();
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const mean = (x, y) => {
          const { data } = ctx.getImageData(x, y, size, size);
          const sum = [0, 0, 0];
          for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
          return sum.map((v) => Math.round(v / (data.length / 4)));
        };
        const w = canvas.width;
        const h = canvas.height;
        return {
          width: w,
          height: h,
          corners: {
            topLeft: mean(0, 0),
            topRight: mean(w - size, 0),
            bottomLeft: mean(0, h - size),
            bottomRight: mean(w - size, h - size),
          },
        };
      },
      { url: dataUrl, size: cornerSize },
    );
  } finally {
    await page.close();
  }
}
