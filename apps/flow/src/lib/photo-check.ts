/**
 * Phase 12A F3 (Workflow 12A capture-12a): the check a document photo passes before it is
 * uploaded. It looks at the guide region only (the card the user framed, not the desk around it):
 * its width in photo pixels, and its sharpness ([sharpnessOf]: second-derivative energy over
 * first-derivative energy on the edges of a grey copy scaled down to a fixed width), so the score
 * depends on focus, not on the camera's size, the card's contrast or how much text it carries.
 *
 * Pure functions on pixel arrays, with no import, so the calibration script
 * (`apps/flow/scripts/calibrate-photo-check.ts`) runs this very file under Node. The bars are
 * calibrated on the synthetic Quebec-format captures of `services/vision/tools/synthetic_quebec.py`
 * (the numbers are in `docs/tdd/phase12a-capture-12a.tdd.md`): `phone-1080` and `-soft` pass,
 * `-blur` and `-motion` fail. The check is a hint to retake, never a verdict: the server judges
 * the photo again, and after two prompts the user may send it anyway.
 */

/** A single-channel image, row by row. */
export interface GreyImage {
  readonly data: Float32Array;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect extends Size {
  readonly x: number;
  readonly y: number;
}

export type PhotoProblem = 'blurry' | 'too-small';

export const PHOTO_PROBLEMS: readonly PhotoProblem[] = ['blurry', 'too-small'];

export interface PhotoCheck {
  /** The guide region's width in photo pixels. */
  readonly guideWidthPx: number;
  /** The guide region's sharpness ([sharpnessOf]) at [SHARPNESS_WIDTH_PX]. */
  readonly sharpness: number;
  /** Why the user should retake the photo, or `null` when it looks usable. */
  readonly problem: PhotoProblem | null;
}

/** The share of the view's width the card guide spans (the `w-[85%]` of `camera-capture.tsx`). */
export const GUIDE_WIDTH_SHARE = 0.85;

/** The guide's shape: an ID-1 card, 85.6 x 54 mm (the `aspect-[86/54]` of the guide). */
export const GUIDE_ASPECT = 86 / 54;

/**
 * The width the guide region is scaled down to before its sharpness is measured. It is the size
 * bar too, so an accepted region is only ever scaled down, never up.
 */
export const SHARPNESS_WIDTH_PX = 800;

/**
 * The narrowest guide region, in photo pixels, that is not called too small: about 9 px a
 * millimetre across a card. A 1080-pixel-wide portrait frame (918 px of guide) passes; a 720p
 * stream (612 px) does not.
 */
export const MIN_GUIDE_WIDTH_PX = 800;

/**
 * The slope, in stretched grey levels a pixel (a central difference), from which a pixel counts as
 * an edge of its axis: one eighth of the stretched range.
 */
export const EDGE_GRADIENT_MIN = 32;

/**
 * The sharpness ([sharpnessOf]) under which a guide region is called blurry. Calibrated on the
 * synthetic captures (see the file comment): the lowest passing capture scores 0.339 (the soft
 * back) and the highest failing one 0.172 (the motion-blurred front), so the bar is their
 * geometric mean, a factor of about 1.4 from each.
 */
export const MIN_DOCUMENT_SHARPNESS = 0.24;

/** Rec. 601 luma of RGBA pixels; alpha is ignored. */
export function toGrey(rgba: Uint8ClampedArray, width: number, height: number): GreyImage {
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i += 1) {
    const o = i * 4;
    data[i] = 0.299 * (rgba[o] ?? 0) + 0.587 * (rgba[o + 1] ?? 0) + 0.114 * (rgba[o + 2] ?? 0);
  }
  return { data, width, height };
}

/**
 * Area-averages one axis from `length` samples down to `target`: output sample `j` is the mean of
 * the source over `[j·f, (j+1)·f)`, `f = length / target`, fractional samples weighted.
 */
function resampleAxis(
  read: (index: number) => number,
  length: number,
  target: number,
  write: (index: number, value: number) => void,
): void {
  const factor = length / target;
  for (let j = 0; j < target; j += 1) {
    const start = j * factor;
    const end = start + factor;
    let sum = 0;
    for (let i = Math.floor(start); i < Math.min(length, Math.ceil(end)); i += 1) {
      const cover = Math.min(end, i + 1) - Math.max(start, i);
      sum += cover * read(i);
    }
    write(j, sum / factor);
  }
}

/**
 * The image scaled down to `width` (aspect kept) by area averaging; the image itself when it is
 * that narrow already, since scaling up adds no detail.
 */
export function resampleToWidth(image: GreyImage, width: number): GreyImage {
  if (image.width <= width) {
    return image;
  }
  const height = Math.max(1, Math.round((image.height * width) / image.width));
  const rows = new Float32Array(width * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const offset = y * image.width;
    resampleAxis(
      (x) => image.data[offset + x] ?? 0,
      image.width,
      width,
      (x, value) => {
        rows[y * width + x] = value;
      },
    );
  }
  const data = new Float32Array(width * height);
  for (let x = 0; x < width; x += 1) {
    resampleAxis(
      (y) => rows[y * width + x] ?? 0,
      image.height,
      height,
      (y, value) => {
        data[y * width + x] = value;
      },
    );
  }
  return { data, width, height };
}

/**
 * The image's grey levels stretched linearly so its 1st percentile maps to 0 and its 99th to
 * 255 (not clipped), so a faint card in dim light is judged like a crisp one.
 */
export function stretchContrast(image: GreyImage): GreyImage {
  const histogram = new Uint32Array(256);
  for (const value of image.data) {
    const level = Math.min(255, Math.max(0, Math.round(value)));
    histogram[level] = (histogram[level] ?? 0) + 1;
  }
  const percentile = (share: number) => {
    const rank = share * image.data.length;
    let seen = 0;
    let level = 0;
    // The last level holds whatever is left, so the walk stops there at the latest.
    while (level < 255 && (seen += histogram[level] ?? 0) <= rank) {
      level += 1;
    }
    return level;
  };
  const low = percentile(0.01);
  const scale = 255 / Math.max(1, percentile(0.99) - low);
  return { ...image, data: image.data.map((value) => (value - low) * scale) };
}

/** One axis's second-derivative energy over its first-derivative energy, on its edge pixels. */
function axisSharpness({ data, width, height }: GreyImage, step: number): number {
  let second = 0;
  let first = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const before = data[i - step] ?? 0;
      const after = data[i + step] ?? 0;
      const slope = (after - before) / 2;
      if (Math.abs(slope) >= EDGE_GRADIENT_MIN) {
        const curve = before + after - 2 * (data[i] ?? 0);
        second += curve * curve;
        first += slope * slope;
      }
    }
  }
  return first === 0 ? 0 : second / first;
}

/**
 * The sharpness of an image, independent of its contrast and of how much it shows: after
 * [stretchContrast], along each axis, the energy of the second derivative over the energy of the
 * first on that axis's edge pixels (a slope of at least [EDGE_GRADIENT_MIN] grey levels a pixel);
 * the lower axis wins, since a photo is as readable as its worst direction. An edge blurred by a
 * Gaussian of width σ scores about 1/σ² whatever its contrast, and both energies grow with the
 * number of edges, so a busy front and a sparse back are judged alike; a motion blur shows on its
 * own axis. Plain Laplacian variance cannot do this: on the synthetic captures a motion-blurred
 * back (124) outscored a soft front (80). 0 for an image without an interior or without edges.
 */
export function sharpnessOf(image: GreyImage): number {
  if (image.width < 3 || image.height < 3) {
    return 0;
  }
  const stretched = stretchContrast(image);
  return Math.min(axisSharpness(stretched, 1), axisSharpness(stretched, image.width));
}

/**
 * Judges a grey copy of the guide region. `guideWidthPx` is the region's width in the uploaded
 * photo, which the copy may be narrower than (the browser reads a large region back scaled down).
 */
export function assessGuideCrop(crop: GreyImage, guideWidthPx: number = crop.width): PhotoCheck {
  const sharpness = sharpnessOf(resampleToWidth(crop, SHARPNESS_WIDTH_PX));
  const problem: PhotoProblem | null =
    guideWidthPx < MIN_GUIDE_WIDTH_PX
      ? 'too-small'
      : sharpness < MIN_DOCUMENT_SHARPNESS
        ? 'blurry'
        : null;
  return { guideWidthPx, sharpness, problem };
}

/** The card guide in the preview, in the preview's own pixels. */
export function guideInView(view: Size): Rect {
  const width = view.width * GUIDE_WIDTH_SHARE;
  const height = width / GUIDE_ASPECT;
  return { x: (view.width - width) / 2, y: (view.height - height) / 2, width, height };
}

function clampRect(rect: Rect, bounds: Size): Rect {
  const x = Math.min(bounds.width, Math.max(0, rect.x));
  const y = Math.min(bounds.height, Math.max(0, rect.y));
  const right = Math.min(bounds.width, Math.max(x, rect.x + rect.width));
  const bottom = Math.min(bounds.height, Math.max(y, rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * The guide region in the camera frame a `view` shows with `object-contain` (the whole frame,
 * scaled to fit and centred), clamped to the frame. The whole frame while the view has no size.
 */
export function guideInFrame(view: Size, frame: Size): Rect {
  const whole = { x: 0, y: 0, width: frame.width, height: frame.height };
  if (view.width <= 0 || view.height <= 0 || frame.width <= 0 || frame.height <= 0) {
    return whole;
  }
  const scale = Math.min(view.width / frame.width, view.height / frame.height);
  const left = (view.width - frame.width * scale) / 2;
  const top = (view.height - frame.height * scale) / 2;
  const guide = guideInView(view);
  return clampRect(
    {
      x: (guide.x - left) / scale,
      y: (guide.y - top) / scale,
      width: guide.width / scale,
      height: guide.height / scale,
    },
    frame,
  );
}

/**
 * A region of the preview stream on a still of another size, which the camera takes over the
 * same field of view: the stream is read as a centred crop of the still that spans its width or
 * its height, whichever it fills (a 16:9 stream is a 4:3 still's full width). Clamped to the still.
 */
export function photoRegion(region: Rect, stream: Size, still: Size): Rect {
  const scale = Math.min(still.width / stream.width, still.height / stream.height);
  const centreX = still.width / 2 + (region.x + region.width / 2 - stream.width / 2) * scale;
  const centreY = still.height / 2 + (region.y + region.height / 2 - stream.height / 2) * scale;
  const width = region.width * scale;
  const height = region.height * scale;
  return clampRect({ x: centreX - width / 2, y: centreY - height / 2, width, height }, still);
}
