import { inflateSync } from 'node:zlib';

/**
 * Minimal PNG reader for exactly the encoding NASA GIBS serves these layers
 * with: 8-bit palette (colour type 3), non-interlaced, with a tRNS transparency
 * chunk. Supporting only that shape keeps this small and honest — anything else
 * is reported as unsupported rather than guessed at.
 *
 * Node has no canvas here and we are not adding a dependency to read 65 KB of
 * indexed pixels, so the scanline filters are implemented directly.
 */

export interface IndexedPng {
  width: number;
  height: number;
  /** One palette index per pixel, row-major. */
  indices: Uint8Array;
  palette: { r: number; g: number; b: number }[];
  /** Alpha from tRNS; 0 means the publisher marked the pixel as no-data. */
  alpha: number[];
}

export type PngDecodeResult = { ok: true; image: IndexedPng } | { ok: false; reason: string };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodeIndexedPng(bytes: Uint8Array): PngDecodeResult {
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== SIGNATURE[i]) return { ok: false, reason: 'Not a PNG file' };

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  const palette: IndexedPng['palette'] = [];
  let alpha: number[] = [];
  const idat: Uint8Array[] = [];

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    if (dataStart + length > bytes.length) return { ok: false, reason: 'Truncated PNG chunk' };

    if (type === 'IHDR') {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === 'PLTE') {
      for (let i = 0; i + 2 < length; i += 3) {
        palette.push({ r: bytes[dataStart + i], g: bytes[dataStart + i + 1], b: bytes[dataStart + i + 2] });
      }
    } else if (type === 'tRNS') {
      alpha = Array.from(bytes.slice(dataStart, dataStart + length));
    } else if (type === 'IDAT') {
      idat.push(bytes.slice(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }

    offset = dataStart + length + 4; // skip CRC
  }

  if (colorType !== 3) return { ok: false, reason: `Unsupported PNG colour type ${colorType} (expected 8-bit palette)` };
  if (bitDepth !== 8) return { ok: false, reason: `Unsupported bit depth ${bitDepth}` };
  if (interlace !== 0) return { ok: false, reason: 'Interlaced (Adam7) tiles are not supported' };
  if (!width || !height) return { ok: false, reason: 'Missing IHDR dimensions' };
  if (palette.length === 0) return { ok: false, reason: 'Missing palette' };
  if (idat.length === 0) return { ok: false, reason: 'Missing image data' };

  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateSync(Buffer.concat(idat.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength)))));
  } catch {
    return { ok: false, reason: 'IDAT stream failed to decompress' };
  }

  // bytes per pixel is 1 for an 8-bit palette image, so each scanline is 1 filter
  // byte followed by `width` indices.
  const stride = width + 1;
  if (raw.length < stride * height) return { ok: false, reason: 'Decompressed data shorter than expected' };

  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    const filter = raw[rowStart];
    const outRow = y * width;
    const prevRow = (y - 1) * width;

    for (let x = 0; x < width; x += 1) {
      const value = raw[rowStart + 1 + x];
      const a = x > 0 ? indices[outRow + x - 1] : 0;
      const b = y > 0 ? indices[prevRow + x] : 0;
      const c = y > 0 && x > 0 ? indices[prevRow + x - 1] : 0;

      let decoded: number;
      switch (filter) {
        case 0:
          decoded = value;
          break;
        case 1:
          decoded = value + a;
          break;
        case 2:
          decoded = value + b;
          break;
        case 3:
          decoded = value + ((a + b) >> 1);
          break;
        case 4:
          decoded = value + paeth(a, b, c);
          break;
        default:
          return { ok: false, reason: `Unknown scanline filter ${filter}` };
      }
      indices[outRow + x] = decoded & 0xff;
    }
  }

  // tRNS lists alpha for the first N palette entries; the rest are opaque.
  const fullAlpha = Array.from({ length: palette.length }, (_, i) => (i < alpha.length ? alpha[i] : 255));

  return { ok: true, image: { width, height, indices, palette, alpha: fullAlpha } };
}
