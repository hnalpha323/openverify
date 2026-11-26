// @vitest-environment node
/**
 * Phase 12A F3 (Workflow 12A capture-12a): the pre-upload check of a document photo's guide
 * region. Sharp synthetic print scores above the bar, the same print under a σ 2 blur below it,
 * and a guide narrower than the size bar is too small. The bar's calibration on the generator's
 * phone captures is recorded in docs/tdd/phase12a-capture-12a.tdd.md.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_DOCUMENT_SHARPNESS,
  MIN_GUIDE_WIDTH_PX,
  SHARPNESS_WIDTH_PX,
  assessGuideCrop,
  guideInFrame,
  guideInView,
  photoRegion,
  resampleToWidth,
  sharpnessOf,
  toGrey,
  type GreyImage,
} from './photo-check';

/** A deterministic card-like page: dark text-like strokes on a light background. */
function printedText(width: number, height: number, seed = 7): GreyImage {
  const data = new Float32Array(width * height).fill(225);
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const lineHeight = Math.max(12, Math.round(height / 14));
  for (let top = lineHeight; top + lineHeight < height; top += Math.round(lineHeight * 1.6)) {
    let x = Math.round(width * 0.05);
    while (x < width * 0.9) {
      const glyph = 3 + Math.floor(next() * Math.max(4, lineHeight * 0.6));
      const stroke = Math.max(2, Math.round(lineHeight / 8));
      // A glyph: two vertical stems and a bar, each `stroke` pixels thick.
      for (let y = top; y < top + lineHeight; y += 1) {
        for (let s = 0; s < stroke; s += 1) {
          data[y * width + x + s] = 30;
          data[y * width + x + glyph - s] = 30;
        }
      }
      const bar = top + Math.floor(next() * lineHeight);
      for (let dx = 0; dx <= glyph; dx += 1) {
        for (let s = 0; s < stroke && bar + s < height; s += 1) {
          data[(bar + s) * width + x + dx] = 30;
        }
      }
      x += glyph + Math.round(lineHeight * 0.4);
    }
  }
  return { data, width, height };
}

/** A separable Gaussian blur of standard deviation `sigma`, edges clamped. */
function gaussianBlur(image: GreyImage, sigma: number): GreyImage {
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) =>
    Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)),
  );
  const total = kernel.reduce((sum, value) => sum + value, 0);
  const weights = kernel.map((value) => value / total);
  const { width, height } = image;
  const pass = (source: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(source.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const sx = horizontal ? Math.min(width - 1, Math.max(0, x + k)) : x;
          const sy = horizontal ? y : Math.min(height - 1, Math.max(0, y + k));
          sum += (weights[k + radius] ?? 0) * (source[sy * width + sx] ?? 0);
        }
        out[y * width + x] = sum;
      }
    }
    return out;
  };
  return { data: pass(pass(image.data, true), false), width, height };
}

/** A horizontal motion blur: the mean of `length` neighbours along each row, edges clamped. */
function motionBlur(image: GreyImage, length: number): GreyImage {
  const { width, height } = image;
  const out = new Float32Array(image.data.length);
  const half = Math.floor(length / 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -half; k < length - half; k += 1) {
        sum += image.data[y * width + Math.min(width - 1, Math.max(0, x + k))] ?? 0;
      }
      out[y * width + x] = sum / length;
    }
  }
  return { data: out, width, height };
}

describe('toGrey', () => {
  it('weighs red, green and blue as luma and ignores alpha', () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128, 10, 10, 10, 255,
    ]);

    const grey = toGrey(rgba, 2, 2);

    expect(grey.width).toBe(2);
    expect(grey.height).toBe(2);
    expect(Array.from(grey.data).map((value) => Math.round(value))).toEqual([76, 150, 29, 10]);
  });
});

describe('resampleToWidth', () => {
  it('averages areas when it scales down, keeping the aspect ratio', () => {
    const image: GreyImage = {
      data: Float32Array.from([0, 100, 200, 0, 100, 200, 0, 100, 200, 0, 100, 200]),
      width: 3,
      height: 4,
    };

    const half = resampleToWidth(image, 2);

    expect(half.width).toBe(2);
    expect(half.height).toBe(3);
    // Each output column covers 1.5 source columns: (0 + 0.5·100)/1.5 and (0.5·100 + 200)/1.5.
    expect(Array.from(half.data).map((value) => Math.round(value))).toEqual([
      33, 167, 33, 167, 33, 167,
    ]);
  });

  it('never scales up', () => {
    const image = printedText(300, 200);

    expect(resampleToWidth(image, 800)).toBe(image);
  });

  it('keeps a flat image flat', () => {
    const flat: GreyImage = {
      data: new Float32Array(1000 * 600).fill(90),
      width: 1000,
      height: 600,
    };

    const small = resampleToWidth(flat, SHARPNESS_WIDTH_PX);

    expect(small.width).toBe(SHARPNESS_WIDTH_PX);
    expect(small.height).toBe(480);
    const values = Array.from(small.data);
    expect(values.reduce((most, value) => Math.max(most, value), 0)).toBeCloseTo(90, 3);
    expect(values.reduce((least, value) => Math.min(least, value), 255)).toBeCloseTo(90, 3);
  });
});

describe('sharpnessOf', () => {
  it('is zero on a flat image and on an image too small to have an interior', () => {
    expect(sharpnessOf({ data: new Float32Array(25).fill(50), width: 5, height: 5 })).toBe(0);
    expect(sharpnessOf({ data: Float32Array.from([0, 255, 0, 255]), width: 2, height: 2 })).toBe(0);
  });

  it('falls as the print blurs, and is zero once no edge is left', () => {
    const sharp = printedText(800, 500);

    const scores = [0, 1.2, 2, 3].map((sigma) =>
      sharpnessOf(sigma === 0 ? sharp : gaussianBlur(sharp, sigma)),
    );

    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(new Set(scores).size).toBe(4);
    expect(sharpnessOf(gaussianBlur(sharp, 12))).toBe(0);
  });

  it('does not depend on the print’s contrast', () => {
    const blurred = gaussianBlur(printedText(800, 500), 1.2);
    const faint: GreyImage = {
      ...blurred,
      data: blurred.data.map((value) => 120 + (value - 120) / 2),
    };

    const ratio = sharpnessOf(faint) / sharpnessOf(blurred);

    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });

  it('does not depend on how much of the image is print', () => {
    const blurred = gaussianBlur(printedText(800, 500), 1.2);
    // The lower half wiped blank: half the edges, the same focus.
    const sparse: GreyImage = {
      ...blurred,
      data: blurred.data.map((value, index) => (index >= 800 * 250 ? 225 : value)),
    };

    const ratio = sharpnessOf(sparse) / sharpnessOf(blurred);

    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });
});

describe('assessGuideCrop', () => {
  it('passes sharp print in a guide wide enough', () => {
    const crop = printedText(1600, 1000);

    const check = assessGuideCrop(crop);

    expect(check.problem).toBeNull();
    expect(check.guideWidthPx).toBe(1600);
    expect(check.sharpness).toBeGreaterThan(MIN_DOCUMENT_SHARPNESS);
  });

  it('calls the same print blurry under a σ 2 blur', () => {
    const crop = gaussianBlur(printedText(800, 500), 2 * (800 / SHARPNESS_WIDTH_PX));

    const check = assessGuideCrop(crop);

    expect(check.sharpness).toBeLessThan(MIN_DOCUMENT_SHARPNESS);
    expect(check.problem).toBe('blurry');
  });

  it('calls a motion blur along one axis blurry, though the other axis is sharp', () => {
    const crop = motionBlur(printedText(800, 500), 6);

    const check = assessGuideCrop(crop);

    expect(check.problem).toBe('blurry');
  });

  it('calls a guide narrower than the size bar too small, before judging its sharpness', () => {
    const crop = printedText(MIN_GUIDE_WIDTH_PX - 1, 400);

    const check = assessGuideCrop(crop);

    expect(check.problem).toBe('too-small');
    expect(check.guideWidthPx).toBe(MIN_GUIDE_WIDTH_PX - 1);
  });

  it('measures sharpness at a fixed width, so frame size does not move the score much', () => {
    const big = printedText(3200, 2000);
    const small = resampleToWidth(big, 1600);

    const ratio = assessGuideCrop(big).sharpness / assessGuideCrop(small).sharpness;

    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(1.25);
  });
});

describe('the guide geometry', () => {
  it('places the card guide at 85% of the view width, ID-1 shaped and centred', () => {
    const guide = guideInView({ width: 400, height: 300 });

    expect(guide.width).toBeCloseTo(340, 6);
    expect(guide.height).toBeCloseTo((340 * 54) / 86, 6);
    expect(guide.x).toBeCloseTo(30, 6);
    expect(guide.y).toBeCloseTo((300 - guide.height) / 2, 6);
  });

  it('maps the guide into the frame the view letterboxes (object-contain)', () => {
    // A 4:3 landscape frame in a 3:4 view: shown 360 wide and 270 high, letterboxed vertically.
    const view = { width: 360, height: 480 };
    const frame = { width: 4000, height: 3000 };

    const region = guideInFrame(view, frame);
    const scale = 4000 / 360;

    expect(region.width).toBeCloseTo(0.85 * 360 * scale, 3);
    expect(region.x).toBeCloseTo(0.075 * 360 * scale, 3);
    expect(region.y + region.height / 2).toBeCloseTo(1500, 3);
  });

  it('clamps a guide wider than the frame shown (a tall frame in a 3:4 view)', () => {
    const region = guideInFrame({ width: 360, height: 480 }, { width: 1080, height: 1920 });

    expect(region.x).toBe(0);
    expect(region.width).toBe(1080);
    expect(region.y + region.height / 2).toBeCloseTo(960, 3);
  });

  it('is the whole frame when the view has no size yet', () => {
    expect(guideInFrame({ width: 0, height: 0 }, { width: 640, height: 480 })).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 480,
    });
  });

  it('maps a stream region onto a still of another shape, as a centred crop of it', () => {
    // A 16:9 stream is the full width of a 4:3 still with its top and bottom cut off.
    const stream = { width: 1920, height: 1080 };
    const still = { width: 4000, height: 3000 };

    const region = photoRegion(
      { x: 960 - 400, y: 540 - 200, width: 800, height: 400 },
      stream,
      still,
    );
    const scale = 4000 / 1920;

    expect(region.width).toBeCloseTo(800 * scale, 3);
    expect(region.height).toBeCloseTo(400 * scale, 3);
    expect(region.x + region.width / 2).toBeCloseTo(2000, 3);
    expect(region.y + region.height / 2).toBeCloseTo(1500, 3);
  });

  it('keeps a mapped region inside the still', () => {
    const region = photoRegion(
      { x: 0, y: 0, width: 1080, height: 1920 },
      { width: 1080, height: 1920 },
      { width: 3000, height: 4000 },
    );

    expect(region.x).toBeGreaterThanOrEqual(0);
    expect(region.y).toBeGreaterThanOrEqual(0);
    expect(region.x + region.width).toBeLessThanOrEqual(3000);
    expect(region.y + region.height).toBeLessThanOrEqual(4000);
  });
});
