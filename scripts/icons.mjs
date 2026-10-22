// Neutral extension icons (E0-F6), drawn procedurally from one vector description and encoded
// as PNG by hand (fflate only for zlib). No native dependencies; output depends only on this file,
// so two runs produce identical bytes.
//
// CLI: `node scripts/icons.mjs` writes src/icons/icon{16,48,128}.png. Do not edit the PNGs by hand.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zlibSync } from 'fflate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const ICON_SIZES = [16, 48, 128];

// Supersampling grid per pixel (SS x SS samples) for anti-aliasing.
const SS = 8;

const NAVY = [0x1f, 0x29, 0x37];
const WHITE = [0xff, 0xff, 0xff];
const GREEN = [0x22, 0xc5, 0x5e];

// Shapes in unit coordinates (0..1). Background keeps a 12.5% transparent margin
// (16 px at 128 px, per Chrome Web Store image guidelines).
const BG = { min: 0.125, max: 0.875, radius: 0.16 };
// Multiples of 1/16 so edges land on whole pixels at 16, 48 and 128 px (crisp at the smallest size).
const BRACKET = { near: 0.25, far: 0.75, arm: 0.1875, stroke: 0.0625 };
const DOT = { cx: 0.5, cy: 0.5, r: 0.09 };

function inRoundedRect(x, y, { min, max, radius }) {
  if (x < min || x > max || y < min || y > max) return false;
  const dx = Math.max(min + radius - x, 0, x - (max - radius));
  const dy = Math.max(min + radius - y, 0, y - (max - radius));
  return dx * dx + dy * dy <= radius * radius;
}

// Four corner brackets (viewfinder): each is an L made of two bars pointing inwards.
function inBrackets(x, y) {
  const { near, far, arm, stroke } = BRACKET;
  for (const [cx, sx] of [[near, 1], [far, -1]]) {
    for (const [cy, sy] of [[near, 1], [far, -1]]) {
      const u = (x - cx) * sx; // distance from corner along the arm, inwards
      const v = (y - cy) * sy;
      if (u >= 0 && v >= 0 && ((u <= arm && v <= stroke) || (v <= arm && u <= stroke))) return true;
    }
  }
  return false;
}

function inDot(x, y) {
  const dx = x - DOT.cx;
  const dy = y - DOT.cy;
  return dx * dx + dy * dy <= DOT.r * DOT.r;
}

// Color of one sample, or null when transparent. Topmost shape first.
function sample(x, y) {
  if (!inRoundedRect(x, y, BG)) return null;
  if (inBrackets(x, y)) return WHITE;
  if (inDot(x, y)) return GREEN;
  return NAVY;
}

/** Renders the icon as straight (non-premultiplied) RGBA, `size * size * 4` bytes. */
export function renderRgba(size) {
  const rgba = new Uint8Array(size * size * 4);
  const total = SS * SS;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; n++;
        }
      }
      const i = (py * size + px) * 4;
      if (n === 0) continue;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = Math.round((n * 255) / total);
    }
  }
  return rgba;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encodes RGBA pixels as an 8-bit RGBA PNG (filter 0 on every row). */
export function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // bit depth 8, color type RGBA, deflate, filter set 0, no interlace
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * Writes icon{16,48,128}.png into `outDir`.
 * @param {{ outDir?: string }} [options]
 * @returns {Promise<Record<number, number>>} byte size per icon size
 */
export async function generateIcons({ outDir = join(ROOT, 'src', 'icons') } = {}) {
  await mkdir(outDir, { recursive: true });
  const sizes = {};
  for (const size of ICON_SIZES) {
    const png = encodePng(renderRgba(size), size, size);
    await writeFile(join(outDir, `icon${size}.png`), png);
    sizes[size] = png.length;
  }
  return sizes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const sizes = await generateIcons({ outDir });
  for (const [size, bytes] of Object.entries(sizes)) console.log(`icon${size}.png: ${bytes} B`);
}
