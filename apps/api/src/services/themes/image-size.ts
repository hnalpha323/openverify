/**
 * C160.6 (`api-themes`): a raster logo's size in pixels, read from its header before any decoding,
 * so a logo over 2,048 px a side is refused before vision renders it. Pure; `null` when the header
 * cannot be read, which the upload refuses as not an image of that type.
 *
 * - PNG: the `IHDR` chunk's width and height (big-endian, bytes 16 to 23).
 * - JPEG: the first start-of-frame marker (`SOF0` to `SOF15`, except `DHT`, `JPG` and `DAC`).
 * - WebP: the `VP8 ` key frame, the `VP8L` header or the `VP8X` canvas size.
 */
export interface ImageSize {
  width: number;
  height: number;
}

type RasterType = 'image/png' | 'image/jpeg' | 'image/webp';

const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + length));

function pngSize(view: DataView, bytes: Uint8Array): ImageSize | null {
  if (bytes.byteLength < 24 || ascii(bytes, 12, 4) !== 'IHDR') {
    return null;
  }
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** SOF markers carry the frame size; DHT (C4), JPG (C8) and DAC (CC) do not. */
const isStartOfFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpegSize(view: DataView, bytes: Uint8Array): ImageSize | null {
  let at = 2;
  while (at + 9 <= bytes.byteLength) {
    if (bytes[at] !== 0xff) {
      return null;
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = view.getUint16(at + 2);
    if (length < 2) {
      return null;
    }
    if (isStartOfFrame(marker)) {
      return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

function webpSize(view: DataView, bytes: Uint8Array): ImageSize | null {
  if (bytes.byteLength < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return null;
  }
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8 ') {
    // The key frame's start code, then 14-bit width and height (little-endian).
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null;
    }
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) {
      return null;
    }
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
    const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
    return { width, height };
  }
  return null;
}

/** The size `bytes` (already sniffed as `type`) states in its header, or `null`. */
export function imageSizeOf(bytes: Uint8Array, type: RasterType): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size =
    type === 'image/png'
      ? pngSize(view, bytes)
      : type === 'image/jpeg'
        ? jpegSize(view, bytes)
        : webpSize(view, bytes);
  return size === null || size.width < 1 || size.height < 1 ? null : size;
}
