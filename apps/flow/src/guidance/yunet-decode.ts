/**
 * YuNet's output decoding (C46.1), reimplemented in TypeScript for the in-browser guidance: the
 * anchor grid of each stride, the face score, the box and the five landmarks, then greedy
 * non-maximum suppression. It reproduces OpenCV's `FaceDetectorYN` on the same raw outputs
 * (`contracts/fixtures/vision/yunet-decode.json`, recorded by the vision service's reference
 * decoder). The guidance only helps the user frame the pose: the server re-detects every face.
 */

/** The strides of YuNet's three output heads. */
export const YUNET_STRIDES = [8, 16, 32] as const;
export type YunetStride = (typeof YUNET_STRIDES)[number];

/** The model's output tensors by name (`cls_8`, `bbox_16`, ...), flattened row-major. */
export type YunetOutputName = `${'cls' | 'obj' | 'bbox' | 'kps'}_${YunetStride}`;
export type YunetOutputs = Readonly<Record<YunetOutputName, ArrayLike<number>>>;

export type Point = readonly [x: number, y: number];

/** A face in the input's pixels: `box` is `[x, y, width, height]`; landmarks in YuNet order. */
export interface DetectedFace {
  readonly box: readonly [x: number, y: number, width: number, height: number];
  /** Right eye, left eye, nose tip, right mouth corner, left mouth corner (the subject's sides). */
  readonly landmarks: readonly Point[];
  readonly score: number;
}

export interface YunetDecodeOptions {
  /** The input's size after padding to multiples of 32. */
  readonly paddedWidth: number;
  readonly paddedHeight: number;
  /** Faces scoring below this are dropped. */
  readonly scoreThreshold: number;
  /** A face overlapping a better one by more than this IoU is dropped. */
  readonly nmsThreshold: number;
}

const LANDMARKS = 5;

type Head = 'cls' | 'obj' | 'bbox' | 'kps';

function output(outputs: YunetOutputs, head: Head, stride: YunetStride): ArrayLike<number> {
  return outputs[`${head}_${String(stride)}` as YunetOutputName];
}

const unit = (value: number | undefined): number => Math.min(Math.max(value ?? 0, 0), 1);

const at = (values: ArrayLike<number>, offset: number): number => values[offset] ?? 0;

/** The intersection over union of two `[x, y, width, height]` boxes. */
function iou(a: DetectedFace['box'], b: DetectedFace['box']): number {
  const width = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const height = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const intersection = width * height;
  const union = a[2] * a[3] + b[2] * b[3] - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Greedy NMS: best first, each face kept unless it overlaps a kept one by more than `threshold`. */
function suppress(faces: readonly DetectedFace[], threshold: number): DetectedFace[] {
  const kept: DetectedFace[] = [];
  for (const face of [...faces].sort((a, b) => b.score - a.score)) {
    if (kept.every((other) => iou(face.box, other.box) <= threshold)) {
      kept.push(face);
    }
  }
  return kept;
}

/** Decodes YuNet's raw outputs into faces, best first. */
export function decodeYunet(outputs: YunetOutputs, options: YunetDecodeOptions): DetectedFace[] {
  const faces: DetectedFace[] = [];
  for (const stride of YUNET_STRIDES) {
    const cols = Math.floor(options.paddedWidth / stride);
    const rows = Math.floor(options.paddedHeight / stride);
    const cls = output(outputs, 'cls', stride);
    const obj = output(outputs, 'obj', stride);
    const bbox = output(outputs, 'bbox', stride);
    const kps = output(outputs, 'kps', stride);
    for (let index = 0; index < rows * cols; index += 1) {
      // The score is the geometric mean of the class and objectness scores, each in [0, 1].
      const score = Math.sqrt(unit(cls[index]) * unit(obj[index]));
      if (score < options.scoreThreshold) {
        continue;
      }
      const row = Math.floor(index / cols);
      const col = index % cols;
      const width = Math.exp(at(bbox, index * 4 + 2)) * stride;
      const height = Math.exp(at(bbox, index * 4 + 3)) * stride;
      const cx = (col + at(bbox, index * 4)) * stride;
      const cy = (row + at(bbox, index * 4 + 1)) * stride;
      const landmarks: Point[] = [];
      for (let k = 0; k < LANDMARKS; k += 1) {
        landmarks.push([
          (col + at(kps, index * 10 + 2 * k)) * stride,
          (row + at(kps, index * 10 + 2 * k + 1)) * stride,
        ]);
      }
      faces.push({ box: [cx - width / 2, cy - height / 2, width, height], landmarks, score });
    }
  }
  return suppress(faces, options.nmsThreshold);
}
