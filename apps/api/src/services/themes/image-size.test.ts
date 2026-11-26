/**
 * C160.6 (`api-themes`): a logo's size from its header, before vision decodes it, so a logo over
 * 2,048 px a side is refused first. Every header is a few bytes made here.
 */
import { describe, expect, it } from 'vitest';
import { imageSizeOf } from './image-size.js';
import { isWoff2 } from './assets.js';

const u16be = (value: number) => [(value >>> 8) & 0xff, value & 0xff];
const u16le = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
const ascii = (text: string) => Array.from(new TextEncoder().encode(text));

/** A JPEG: SOI, an APP0 segment, then a SOF0 of `width` x `height`. */
const jpeg = (width: number, height: number, marker = 0xc0) =>
  new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, ...u16be(16), ...new Array<number>(14).fill(0),
    0xff, marker, ...u16be(17), 8, ...u16be(height), ...u16be(width), 3,
    ...new Array<number>(9).fill(0),
  ]);

const riff = (chunk: string, data: number[]) =>
  new Uint8Array([
    ...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), 0, 0, 0, 0, ...data,
    ...new Array<number>(16).fill(0),
  ]);

describe('imageSizeOf (C160.6)', () => {
  it('reads a PNG’s IHDR', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii('IHDR'),
      0, 0, 0x08, 0x01, 0, 0, 0, 0x20, 8, 6, 0, 0, 0,
    ]);
    expect(imageSizeOf(png, 'image/png')).toEqual({ width: 2049, height: 32 });
    expect(imageSizeOf(png.slice(0, 20), 'image/png')).toBeNull();
  });

  it('reads a JPEG’s first frame header, past other segments', () => {
    expect(imageSizeOf(jpeg(640, 480), 'image/jpeg')).toEqual({ width: 640, height: 480 });
    expect(imageSizeOf(jpeg(3000, 10, 0xc2), 'image/jpeg')).toEqual({ width: 3000, height: 10 });
    // DHT (C4) carries no frame size.
    expect(imageSizeOf(jpeg(640, 480, 0xc4), 'image/jpeg')).toBeNull();
    expect(imageSizeOf(new Uint8Array([0xff, 0xd8, 0x00, 0x00]), 'image/jpeg')).toBeNull();
  });

  it('reads the three WebP headers', () => {
    const lossy = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(320), ...u16le(240)]);
    expect(imageSizeOf(lossy, 'image/webp')).toEqual({ width: 320, height: 240 });

    const bits = (100 - 1) | ((50 - 1) << 14);
    const lossless = riff('VP8L', [0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff]);
    expect(imageSizeOf(lossless, 'image/webp')).toEqual({ width: 100, height: 50 });

    const extended = riff('VP8X', [0, 0, 0, 0, 0xff, 0x0f, 0, 0x01, 0, 0]);
    expect(imageSizeOf(extended, 'image/webp')).toEqual({ width: 4096, height: 2 });

    expect(imageSizeOf(riff('ALPH', []), 'image/webp')).toBeNull();
    expect(imageSizeOf(riff('VP8 ', [0, 0, 0, 1, 2, 3]), 'image/webp')).toBeNull();
  });

  it('answers null for a zero size', () => {
    expect(imageSizeOf(jpeg(0, 10), 'image/jpeg')).toBeNull();
  });
});

describe('isWoff2 (C160.6)', () => {
  const header = (length: number, tables: number, size = length) => {
    const bytes = new Uint8Array(size);
    bytes.set([...ascii('wOF2'), 0, 1, 0, 0, 0, 0, (length >>> 8) & 0xff, length & 0xff, 0, tables]);
    return bytes;
  };

  it('takes a wOF2 header stating the file’s own length and a table', () => {
    expect(isWoff2(header(64, 1))).toBe(true);
  });

  it.each([
    ['a length that is not the file’s', header(80, 1, 64)],
    ['no table', header(64, 0)],
    ['fewer bytes than the header', header(40, 1)],
    ['another signature', new Uint8Array(64).fill(0x41)],
  ])('refuses %s', (_what, bytes) => {
    expect(isWoff2(bytes)).toBe(false);
  });
});
