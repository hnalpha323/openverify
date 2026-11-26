/**
 * Builds PNG images at test time, so no image (and never a face) is committed. The default
 * picture is a plain "card": a light background, a grey box where a portrait would go and a
 * few dark bars for text lines. It only needs to be a well-formed PNG; the mocked API never
 * analyses it.
 */
import { crc32, deflateSync } from 'node:zlib';

export interface SyntheticCardOptions {
  readonly width?: number;
  readonly height?: number;
  /** Background colour as [r, g, b]. */
  readonly background?: readonly [number, number, number];
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function inside(x: number, y: number, box: readonly [number, number, number, number]): boolean {
  const [left, top, right, bottom] = box;
  return x >= left && x < right && y >= top && y < bottom;
}

/** An 8-bit RGB PNG of a synthetic ID-1 shaped card. */
export function syntheticCardPng({
  width = 428,
  height = 270,
  background = [226, 236, 248],
}: SyntheticCardOptions = {}): Buffer {
  const portrait = [24, 40, 140, 190] as const;
  const lines = [0, 1, 2, 3].map(
    (index) => [170, 52 + index * 34, width - 30, 64 + index * 34] as const,
  );
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      let colour: readonly [number, number, number] = background;
      if (inside(x, y, portrait)) {
        colour = [150, 150, 150];
      } else if (lines.some((line) => inside(x, y, line))) {
        colour = [40, 48, 64];
      }
      row.set(colour, 1 + x * 3);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
