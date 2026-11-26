/**
 * Phase 12A F3 (Workflow 12A capture-12a): measures the pre-upload photo check
 * (`apps/flow/src/lib/photo-check.ts`, loaded as it is) on grey copies of the synthetic
 * Quebec-format captures, so its bars can be calibrated and the numbers recorded.
 *
 *   node apps/flow/scripts/calibrate-photo-check.ts <dir> [view-width view-height]
 *
 * `<dir>` holds binary PGM files (P5, 8-bit) named `<front|back>-<capture>.pgm`, made from the
 * generator's JPEGs (`services/vision/tools/synthetic_quebec.py images`) with Pillow's `L`
 * conversion, which is the same Rec. 601 luma as `toGrey`. The guide region is the one a phone's
 * 3:4 preview (360 x 480 CSS px by default) frames over each capture, as the flow computes it.
 * The images are synthetic and specimen-marked; nothing here reads a real photo.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface GreyImage {
  readonly data: Float32Array;
  readonly width: number;
  readonly height: number;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface PhotoCheckModule {
  readonly MIN_DOCUMENT_SHARPNESS: number;
  readonly MIN_GUIDE_WIDTH_PX: number;
  guideInFrame(
    view: { width: number; height: number },
    frame: { width: number; height: number },
  ): Rect;
  assessGuideCrop(crop: GreyImage): {
    guideWidthPx: number;
    sharpness: number;
    problem: string | null;
  };
}

const check = (await import(
  new URL('../src/lib/photo-check.ts', import.meta.url).href
)) as PhotoCheckModule;

/** Reads a binary PGM (P5, maxval 255): its header's three numbers, then one byte a pixel. */
function readPgm(path: string): GreyImage {
  const bytes = readFileSync(path);
  const fields: number[] = [];
  let offset = 2;
  while (fields.length < 3) {
    while (/\s/.test(String.fromCharCode(bytes[offset] ?? 0))) {
      offset += 1;
    }
    let token = '';
    while (!/\s/.test(String.fromCharCode(bytes[offset] ?? 32))) {
      token += String.fromCharCode(bytes[offset] ?? 0);
      offset += 1;
    }
    fields.push(Number(token));
  }
  offset += 1;
  const [width = 0, height = 0] = fields;
  return {
    data: Float32Array.from(bytes.subarray(offset, offset + width * height)),
    width,
    height,
  };
}

function crop(image: GreyImage, rect: Rect): GreyImage {
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    data.set(
      image.data.subarray((y0 + y) * image.width + x0, (y0 + y) * image.width + x0 + width),
      y * width,
    );
  }
  return { data, width, height };
}

const [dir = '.', viewWidth = '360', viewHeight = '480'] = process.argv.slice(2);
const view = { width: Number(viewWidth), height: Number(viewHeight) };

console.log(
  `bars: sharpness >= ${String(check.MIN_DOCUMENT_SHARPNESS)}, guide >= ${String(check.MIN_GUIDE_WIDTH_PX)} px; view ${String(view.width)}x${String(view.height)}`,
);
console.log('| Side | Capture | Frame | Guide region (px) | Sharpness | Verdict |');
console.log('|---|---|---|---|---|---|');
for (const name of readdirSync(dir)
  .filter((file) => file.endsWith('.pgm'))
  .sort()) {
  const image = readPgm(join(dir, name));
  const region = check.guideInFrame(view, image);
  const result = check.assessGuideCrop(crop(image, region));
  const [side, ...capture] = name.replace(/\.pgm$/, '').split('-');
  console.log(
    `| ${side ?? ''} | ${capture.join('-')} | ${String(image.width)}x${String(image.height)} | ${String(Math.round(region.width))}x${String(Math.round(region.height))} | ${result.sharpness.toFixed(3)} | ${result.problem ?? 'pass'} |`,
  );
}
