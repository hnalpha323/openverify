// @vitest-environment node
/**
 * C204.1, C221.8 (Workflow 10B, selfie-guidance): `contracts/fixtures/flow/selfie-guidance-vectors.json`,
 * the vectors the Android SDK's Kotlin port of this folder (`commonMain/.../capture/selfie/`) passes in
 * `commonTest`, written from the web flow's own modules over this file's own case table:
 *
 * - `letterbox`: a camera frame's guidance frame at `preview-width-px` (`previewSize`) and the model
 *   input padded to multiples of 32 (`paddedSize`); two tiny frames also carry their RGBA pixels and
 *   every non-zero value of the BGR planar tensor `toYunetInput` builds from them;
 * - `decode`: synthetic YuNet outputs (never a face: anchors set by hand, plus the vision service's
 *   outputs on its drawn synthetic face, `contracts/fixtures/vision/yunet-decode.json`) and the faces the
 *   web's detector returns for them, through `loadFaceDetector`'s own decoding with a fake ONNX Runtime,
 *   so its unexported candidate and NMS thresholds are the ones exercised;
 * - `yaw`: five landmarks and their `yawRatio` (`null` when the eyes coincide);
 * - `machine`: a prompt and a stream of guidance frames, each a single well-placed face whose landmarks
 *   read the step's `ratio` (or no face at all when `ratio` is null), with the message after each step
 *   and the step at which the machine fires its one auto-capture (`captures`).
 *
 * Assert-only (C221.8, rule 26): the test fails when the committed file differs from what the modules
 * give, and writes the file only under `UPDATE_CONTRACT_FIXTURES=1` (then run Prettier over it), so a
 * plain `pnpm test` never changes the working tree. It imports only the implementation, never another
 * test file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadFaceDetector, type OrtModule, type OrtTensor } from './face-detector';
import { ORT_WASM, ORT_WASM_LOADER, YUNET_MODEL } from './guidance-assets';
import {
  GUIDANCE_FACE_SCORE_THRESHOLD,
  GUIDANCE_LIMITS,
  guidanceThresholds,
  startGuidance,
  updateGuidance,
  type GuidanceThresholds,
} from './guidance-machine';
import { yawRatio } from './head-pose';
import {
  YUNET_STRIDES,
  decodeYunet,
  type DetectedFace,
  type Point,
  type YunetOutputName,
  type YunetStride,
} from './yunet-decode';
import { paddedSize, previewSize, toYunetInput } from './yunet-input';

const FIXTURES = new URL('../../../../contracts/fixtures/', import.meta.url);
const VECTORS = new URL('flow/selfie-guidance-vectors.json', FIXTURES);

const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8')) as unknown;

/** `contracts/fixtures/flow/selfie-capture.json` (C40.11), the constants the machine runs on. */
const SHARED = readJson(new URL('flow/selfie-capture.json', FIXTURES)) as {
  readonly client: {
    readonly 'hold-ms': number;
    readonly 'side-trigger-factor': number;
    readonly 'center-trigger-factor': number;
    readonly 'manual-shutter-after-ms': number;
    readonly 'guidance-hz': number;
    readonly 'preview-width-px': number;
  };
  readonly server: {
    readonly 'max-center-yaw-ratio': number;
    readonly 'min-side-yaw-ratio-change': number;
  };
};

/** The vision service's YuNet outputs on its drawn synthetic face (C46.1). */
const VISION_GOLDEN = readJson(new URL('vision/yunet-decode.json', FIXTURES)) as {
  readonly input: { readonly width: number; readonly height: number };
  readonly outputs: Readonly<Record<YunetOutputName, readonly number[]>>;
};

const THRESHOLDS: GuidanceThresholds = guidanceThresholds(
  {
    'max-center-yaw-ratio': SHARED.server['max-center-yaw-ratio'],
    'min-side-yaw-ratio-change': SHARED.server['min-side-yaw-ratio-change'],
    'hold-ms': SHARED.client['hold-ms'],
  },
  SHARED.client,
);

/**
 * What `face-detector.ts` decodes with (its unexported `CANDIDATE_SCORE_THRESHOLD` and
 * `NMS_THRESHOLD`). The `decode` cases on either side of each value pin it: the test below checks that
 * `decodeYunet` with these values gives exactly the detector's faces on every case.
 */
const CANDIDATE_SCORE_THRESHOLD = 0.6;
const NMS_THRESHOLD = 0.3;

/** The machine's guidance frame, and the user's own centre yaw ratio its side prompts are judged from. */
const MACHINE_FRAME = { width: 320, height: 240 } as const;
const MACHINE_CENTRE_YAW_RATIO = 0.01;
/** `guidance-hz` (8): one guidance frame every 125 ms. */
const FRAME_MS = 1000 / SHARED.client['guidance-hz'];

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

/** The value with every `-0` written as `0`, as JSON writes it, so the file and the value compare equal. */
function normalised(value: Json): Json {
  if (typeof value === 'number') {
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return (value as readonly Json[]).map(normalised);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalised(item)]));
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// letterbox

interface LetterboxCase {
  readonly name: string;
  readonly source: { readonly width: number; readonly height: number };
  /** A tiny frame's pixels (RGBA, by formula), whose tensor is exported too. */
  readonly pixels?: boolean;
}

const LETTERBOX_CASES: readonly LetterboxCase[] = [
  { name: 'a 4:3 landscape camera frame', source: { width: 640, height: 480 } },
  { name: 'a 16:9 landscape camera frame', source: { width: 1280, height: 720 } },
  { name: 'a 3:4 portrait camera frame', source: { width: 480, height: 640 } },
  { name: 'a 9:16 portrait camera frame', source: { width: 720, height: 1280 } },
  { name: 'a frame already at the preview width', source: { width: 320, height: 240 } },
  { name: 'a frame one pixel wider than the preview', source: { width: 321, height: 241 } },
  {
    name: 'a frame narrower than the preview is not enlarged',
    source: { width: 200, height: 150 },
  },
  { name: 'a height that rounds half up', source: { width: 640, height: 361 } },
  { name: 'a one-pixel frame', source: { width: 1, height: 1 } },
  { name: 'a tiny frame and its tensor', source: { width: 3, height: 2 }, pixels: true },
  { name: 'a tiny frame across a padding edge', source: { width: 33, height: 1 }, pixels: true },
];

/** A tiny frame's RGBA bytes, by formula (no image). */
function tinyPixels(width: number, height: number): number[] {
  const data: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.push(
        (x * 37 + y * 11 + 5) % 256,
        (x * 13 + y * 101 + 7) % 256,
        (x * 7 + y * 3 + 200) % 256,
        255,
      );
    }
  }
  return data;
}

function letterboxCase({ name, source, pixels = false }: LetterboxCase): Json {
  const preview = previewSize(source.width, source.height, SHARED.client['preview-width-px']);
  const input: Record<string, Json> = {
    width: preview.width,
    height: preview.height,
    'padded-width': paddedSize(preview.width),
    'padded-height': paddedSize(preview.height),
  };
  if (pixels) {
    const rgba = tinyPixels(preview.width, preview.height);
    const tensor = toYunetInput({ data: rgba, width: preview.width, height: preview.height });
    const nonZero: [number, number][] = [];
    tensor.data.forEach((value, index) => {
      if (value !== 0) {
        nonZero.push([index, value]);
      }
    });
    input.rgba = rgba;
    input['tensor-length'] = tensor.data.length;
    input['tensor-nonzero'] = nonZero;
  }
  return { name, source, input };
}

// ---------------------------------------------------------------------------------------------
// decode

type Outputs = Record<YunetOutputName, number[]>;

interface Anchor {
  readonly stride: YunetStride;
  readonly row: number;
  readonly col: number;
  readonly cls: number;
  readonly obj: number;
  /** Centre offsets in anchor units, then log width and height over the stride. */
  readonly bbox: readonly [number, number, number, number];
  /** Ten landmark offsets in anchor units; a fixed spread when absent. */
  readonly kps?: readonly number[];
}

interface DecodeCase {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly anchors: readonly Anchor[];
}

const outputKey = (head: 'cls' | 'obj' | 'bbox' | 'kps', stride: YunetStride): YunetOutputName =>
  `${head}_${String(stride)}` as YunetOutputName;

/** The twelve tensors of a `width` x `height` input with no face, then the case's anchors set. */
function outputsOf({ width, height, anchors }: DecodeCase): Outputs {
  const outputs = {} as Outputs;
  const paddedWidth = paddedSize(width);
  const paddedHeight = paddedSize(height);
  for (const stride of YUNET_STRIDES) {
    const count = Math.floor(paddedWidth / stride) * Math.floor(paddedHeight / stride);
    outputs[outputKey('cls', stride)] = new Array<number>(count).fill(0);
    outputs[outputKey('obj', stride)] = new Array<number>(count).fill(0);
    outputs[outputKey('bbox', stride)] = new Array<number>(count * 4).fill(0);
    outputs[outputKey('kps', stride)] = new Array<number>(count * 10).fill(0);
  }
  for (const { stride, row, col, cls, obj, bbox, kps } of anchors) {
    const index = row * Math.floor(paddedWidth / stride) + col;
    outputs[outputKey('cls', stride)][index] = cls;
    outputs[outputKey('obj', stride)][index] = obj;
    outputs[outputKey('bbox', stride)].splice(index * 4, 4, ...bbox);
    outputs[outputKey('kps', stride)].splice(
      index * 10,
      10,
      ...(kps ?? [0.2, 0.3, 0.8, 0.3, 0.5, 0.55, 0.3, 0.8, 0.7, 0.8]),
    );
  }
  return outputs;
}

/** `ln(width / stride)`, as a bbox member, for a box `width` pixels wide. */
const logSize = (width: number, stride: number): number => Math.log(width / stride);

/**
 * Two faces on neighbouring stride-8 anchors, 8 pixels apart, each `size` pixels square: their IoU is
 * `(size - 8) / (size + 8)`.
 */
function neighbours(size: number, scores: readonly [number, number]): Anchor[] {
  const log = logSize(size, 8);
  return scores.map((score, k) => ({
    stride: 8 as const,
    row: 3,
    col: 3 + k,
    cls: score,
    obj: score,
    bbox: [0.5, 0.5, log, log] as const,
  }));
}

const DECODE_CASES: readonly DecodeCase[] = [
  { name: 'no face anywhere', width: 64, height: 64, anchors: [] },
  {
    name: 'one face at stride 8',
    width: 64,
    height: 64,
    anchors: [{ stride: 8, row: 2, col: 5, cls: 0.97, obj: 0.95, bbox: [0.4, 0.6, 1.1, 1.3] }],
  },
  {
    name: 'one face at stride 16 with its own landmarks',
    width: 64,
    height: 64,
    anchors: [
      {
        stride: 16,
        row: 1,
        col: 2,
        cls: 0.99,
        obj: 0.98,
        bbox: [0.5, 0.45, 0.9, 1.05],
        kps: [0.1, -0.2, 0.9, -0.15, 0.55, 0.4, 0.2, 0.85, 0.75, 0.9],
      },
    ],
  },
  {
    name: 'one face at stride 32',
    width: 64,
    height: 64,
    anchors: [{ stride: 32, row: 1, col: 0, cls: 0.93, obj: 0.91, bbox: [-0.25, 0.75, 0.2, 0.35] }],
  },
  {
    name: 'scores either side of the candidate threshold',
    width: 64,
    height: 64,
    anchors: [
      { stride: 8, row: 0, col: 0, cls: 0.58, obj: 0.58, bbox: [0.5, 0.5, 0, 0] },
      { stride: 8, row: 7, col: 7, cls: 0.62, obj: 0.62, bbox: [0.5, 0.5, 0, 0] },
    ],
  },
  {
    name: 'scores clamped to 0..1 before their geometric mean',
    width: 64,
    height: 64,
    anchors: [
      { stride: 8, row: 0, col: 7, cls: 1.6, obj: 0.81, bbox: [0.5, 0.5, 0, 0] },
      { stride: 8, row: 7, col: 0, cls: 0.99, obj: -0.4, bbox: [0.5, 0.5, 0, 0] },
    ],
  },
  {
    name: 'overlap below the NMS threshold keeps both faces',
    width: 64,
    height: 64,
    anchors: neighbours(13, [0.95, 0.9]),
  },
  {
    name: 'overlap above the NMS threshold keeps the better face',
    width: 64,
    height: 64,
    anchors: neighbours(17, [0.9, 0.95]),
  },
  {
    name: 'equal scores keep the first decoded face',
    width: 64,
    height: 64,
    anchors: neighbours(24, [0.92, 0.92]),
  },
  {
    name: 'faces at every stride, best first',
    width: 90,
    height: 50,
    anchors: [
      { stride: 8, row: 5, col: 10, cls: 0.7, obj: 0.75, bbox: [0.5, 0.5, 0.3, 0.4] },
      { stride: 16, row: 0, col: 1, cls: 0.96, obj: 0.97, bbox: [0.2, 0.3, 0.6, 0.7] },
      { stride: 32, row: 1, col: 2, cls: 0.85, obj: 0.8, bbox: [0.6, 0.1, -0.1, 0.05] },
    ],
  },
];

/** A fake onnxruntime-web whose one session answers every run with `next`'s outputs. */
function fakeOrt(next: { outputs: Outputs | null }): OrtModule {
  const session = {
    run: () => {
      const outputs: Partial<Outputs> = next.outputs ?? {};
      return Promise.resolve(
        Object.fromEntries(
          Object.entries(outputs).map(([name, values]: [string, number[]]): [string, OrtTensor] => [
            name,
            { data: Float32Array.from(values), dims: [1, values.length] },
          ]),
        ),
      );
    },
  };
  return {
    env: { wasm: {} },
    InferenceSession: { create: () => Promise.resolve(session) },
    Tensor: class {
      constructor(
        readonly type: 'float32',
        readonly data: Float32Array,
        readonly dims: readonly number[],
      ) {}
    },
  };
}

/** The web's detector over a fake runtime: every guidance file served and accepted. */
async function webDetector(next: { outputs: Outputs | null }) {
  const files = new Map<string, string>([
    [YUNET_MODEL.path, YUNET_MODEL.sha256],
    [ORT_WASM.path, ORT_WASM.sha256],
    [ORT_WASM_LOADER.path, ORT_WASM_LOADER.sha256],
  ]);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const detector = await loadFaceDetector({
    baseUrl: 'https://flow.example/',
    fetch: (input) => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(href).pathname.slice(1);
      return Promise.resolve(new Response(encoder.encode(files.get(path) ?? '')));
    },
    importOrt: () => Promise.resolve(fakeOrt(next)),
    sha256: (bytes) => Promise.resolve(decoder.decode(bytes)),
  });
  if (detector === null) {
    throw new Error('the web detector did not load over the fake runtime');
  }
  return detector;
}

const faceJson = (face: DetectedFace): Json => ({
  box: [...face.box],
  score: face.score,
  landmarks: face.landmarks.map(([x, y]) => [x, y]),
});

interface BuiltDecodeCase {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly outputs: Outputs;
  readonly faces: readonly DetectedFace[];
}

async function decodeCases(): Promise<BuiltDecodeCase[]> {
  const next: { outputs: Outputs | null } = { outputs: null };
  const detector = await webDetector(next);
  const golden: DecodeCase & { readonly outputs: Outputs } = {
    name: "the vision service's outputs on its drawn synthetic face",
    width: VISION_GOLDEN.input.width,
    height: VISION_GOLDEN.input.height,
    anchors: [],
    outputs: Object.fromEntries(
      Object.entries(VISION_GOLDEN.outputs).map(([name, values]) => [name, [...values]]),
    ) as Outputs,
  };
  const built: BuiltDecodeCase[] = [];
  const entries: readonly (DecodeCase & { readonly outputs?: Outputs })[] = [
    ...DECODE_CASES,
    golden,
  ];
  for (const entry of entries) {
    const outputs = entry.outputs ?? outputsOf(entry);
    next.outputs = outputs;
    const frame = {
      data: new Uint8ClampedArray(entry.width * entry.height * 4),
      width: entry.width,
      height: entry.height,
    };
    built.push({
      name: entry.name,
      width: entry.width,
      height: entry.height,
      outputs,
      faces: await detector.detect(frame),
    });
  }
  return built;
}

// ---------------------------------------------------------------------------------------------
// yaw

/** The canonical five landmarks of a face at the origin reading `yaw`, eyes 40 pixels apart. */
function canonical(yaw: number): Point[] {
  return [
    [-20, -10],
    [20, -10],
    [yaw * 40, 6],
    [-16, 22],
    [16, 22],
  ];
}

/** `points` rolled by `degrees` about the origin, then moved to (`x`, `y`). */
function placed(points: readonly Point[], degrees: number, x: number, y: number): Point[] {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map(([px, py]) => [x + px * cos - py * sin, y + px * sin + py * cos]);
}

function yawCases(decoded: readonly BuiltDecodeCase[]): Json[] {
  const cases: { name: string; landmarks: Point[] }[] = [];
  for (const yaw of [0, 0.05, -0.12, 0.25]) {
    for (const roll of [0, 20, -35, 90, 180]) {
      cases.push({
        name: `yaw ${String(yaw)} rolled ${String(roll)} degrees`,
        landmarks: placed(canonical(yaw), roll, 160, 120),
      });
    }
  }
  cases.push({
    name: 'the eyes coincide',
    landmarks: [
      [100, 80],
      [100, 80],
      [104, 95],
      [92, 110],
      [108, 110],
    ],
  });
  cases.push({
    name: 'the eyes nearly coincide',
    landmarks: [
      [100, 80],
      [100.000_000_1, 80],
      [104, 95],
      [92, 110],
      [108, 110],
    ],
  });
  cases.push({
    name: 'the left eye left of the right one in the image',
    landmarks: [
      [140, 100],
      [100, 100],
      [125, 115],
      [135, 130],
      [105, 130],
    ],
  });
  for (const entry of decoded) {
    entry.faces.forEach((face, index) => {
      cases.push({
        name: `${entry.name}: face ${String(index + 1)}`,
        landmarks: face.landmarks.map(([x, y]): Point => [x, y]),
      });
    });
  }
  return cases.map(({ name, landmarks }) => ({
    name,
    landmarks: landmarks.map(([x, y]) => [x, y]),
    ratio: yawRatio(landmarks),
  }));
}

// ---------------------------------------------------------------------------------------------
// machine

/**
 * A single face in the machine's frame whose landmarks read `yaw` (the web's own test face): centred,
 * half the frame high, scored 0.95.
 */
function machineFace(yaw: number): DetectedFace {
  const cx = MACHINE_FRAME.width / 2;
  const cy = MACHINE_FRAME.height / 2;
  const h = 0.5 * MACHINE_FRAME.height;
  const w = h * 0.75;
  const eye = w * 0.2;
  return {
    box: [cx - w / 2, cy - h / 2, w, h],
    landmarks: [
      [cx - eye, cy - h * 0.1],
      [cx + eye, cy - h * 0.1],
      [cx + yaw * 2 * eye, cy + h * 0.05],
      [cx - eye * 0.8, cy + h * 0.25],
      [cx + eye * 0.8, cy + h * 0.25],
    ],
    score: 0.95,
  };
}

interface MachineCase {
  readonly name: string;
  readonly prompt: 'center' | 'left' | 'right';
  /** One `[t-ms, ratio]` per guidance frame. */
  readonly frames: readonly (readonly [number, number | null])[];
}

/** `count` frames at `guidance-hz` from `from` ms, each reading `ratio`. */
function steady(from: number, count: number, ratio: number | null): [number, number | null][] {
  return Array.from({ length: count }, (_, k) => [from + Math.round(k * FRAME_MS), ratio]);
}

const CENTRE_TRIGGER = THRESHOLDS.centerTriggerFactor * THRESHOLDS.maxCenterYawRatio;
const SIDE_TRIGGER = THRESHOLDS.sideTriggerFactor * THRESHOLDS.minSideYawRatioChange;

const MACHINE_CASES: readonly MachineCase[] = [
  {
    name: 'the centre held straight auto-captures after hold-ms',
    prompt: 'center',
    frames: steady(125, 8, 0.004),
  },
  {
    name: 'the centre turned away never captures',
    prompt: 'center',
    frames: steady(125, 10, 0.05),
  },
  {
    name: 'the centre either side of its trigger',
    prompt: 'center',
    frames: [...steady(125, 3, CENTRE_TRIGGER * 1.05), ...steady(500, 6, -CENTRE_TRIGGER * 0.95)],
  },
  {
    name: 'a face that comes and goes restarts the hold',
    prompt: 'center',
    frames: [
      [125, 0],
      [250, null],
      [375, 0],
      [500, 0],
      [625, 0],
      [750, null],
      [875, 0],
      [1000, 0],
      [1125, 0],
      [1250, 0],
      [1375, 0],
    ],
  },
  {
    name: 'frames that arrive late still hold for hold-ms of the clock',
    prompt: 'center',
    frames: [
      [90, 0.001],
      [400, 0.002],
      [589, -0.003],
      [591, 0.001],
      [1300, 0.001],
    ],
  },
  {
    name: 'a left turn from the centre frame auto-captures',
    prompt: 'left',
    frames: [
      ...steady(125, 3, MACHINE_CENTRE_YAW_RATIO),
      ...steady(500, 6, MACHINE_CENTRE_YAW_RATIO + 0.12),
    ],
  },
  {
    name: 'a left turn short of the trigger waits',
    prompt: 'left',
    frames: steady(125, 8, MACHINE_CENTRE_YAW_RATIO + SIDE_TRIGGER * 0.97),
  },
  {
    name: 'a turn to the right at the left prompt never captures',
    prompt: 'left',
    frames: steady(125, 8, MACHINE_CENTRE_YAW_RATIO - 0.15),
  },
  {
    name: 'a right turn from the centre frame auto-captures',
    prompt: 'right',
    frames: steady(125, 8, MACHINE_CENTRE_YAW_RATIO - SIDE_TRIGGER * 1.03),
  },
  {
    name: 'a right turn that drifts back restarts the hold',
    prompt: 'right',
    frames: [
      ...steady(125, 3, MACHINE_CENTRE_YAW_RATIO - 0.11),
      [500, MACHINE_CENTRE_YAW_RATIO - 0.05],
      ...steady(625, 6, MACHINE_CENTRE_YAW_RATIO - 0.11),
    ],
  },
  {
    name: 'after the capture the machine stays fired',
    prompt: 'center',
    frames: [...steady(125, 6, 0), ...steady(875, 3, 0.2)],
  },
];

function machineCase({ name, prompt, frames }: MachineCase): Json {
  let state = startGuidance({
    pose: prompt,
    now: 0,
    detector: 'ready',
    centreYawRatio: prompt === 'center' ? null : MACHINE_CENTRE_YAW_RATIO,
  });
  const steps = frames.map(([now, ratio]): Json => {
    const fired = state.autoCapture;
    state = updateGuidance(state, THRESHOLDS, {
      type: 'faces',
      now,
      faces: ratio === null ? [] : [machineFace(ratio)],
      frame: MACHINE_FRAME,
    });
    const step: Record<string, Json> = { 't-ms': now, ratio, state: state.message };
    if (state.autoCapture && !fired) {
      step.captures = true;
    }
    return step;
  });
  return { name, prompt, steps };
}

// ---------------------------------------------------------------------------------------------

async function vectors(): Promise<Json> {
  const decoded = await decodeCases();
  return normalised({
    format: 1,
    description:
      "C204.1, C221.8: the web flow's selfie guidance (apps/flow/src/guidance/: yunet-input, the detector's decoding through yunet-decode, head-pose, guidance-machine) over a fixed case table, written by apps/flow/src/guidance/export-vectors.test.ts under UPDATE_CONTRACT_FIXTURES=1 and asserted by it otherwise; the Android SDK's port (commonMain capture/selfie/) passes every case. Synthetic data only: the outputs are anchors set by hand and the vision service's outputs on its drawn synthetic face (contracts/fixtures/vision/yunet-decode.json), never a person. Each output value is rounded to float32 before decoding, as ONNX Runtime returns it. The faces are compared within 1e-9 pixels and the yaw ratios within 1e-12, since exp and the trigonometry may differ in their last bit across platforms. A machine case starts its prompt at t-ms 0 with a ready detector; a left or right prompt is judged against machine-centre-yaw-ratio; each step is one guidance frame of machine-frame-width x machine-frame-height holding no face (ratio null) or one face scored 0.95, centred, half the frame high, three quarters as wide, whose eyes sit at x = cx -/+ 0.2 w and y = cy - 0.1 h, nose at (cx + ratio * 0.4 w, cy + 0.05 h) and mouth corners at x = cx -/+ 0.16 w and y = cy + 0.25 h; state is the message after the step, and captures marks the step at which the machine fires its one auto-capture.",
    constants: {
      strides: [...YUNET_STRIDES],
      'candidate-score-threshold': CANDIDATE_SCORE_THRESHOLD,
      'nms-threshold': NMS_THRESHOLD,
      'face-score-threshold': GUIDANCE_FACE_SCORE_THRESHOLD,
      'min-face-height-ratio': GUIDANCE_LIMITS.minFaceHeightRatio,
      'max-face-height-ratio': GUIDANCE_LIMITS.maxFaceHeightRatio,
      'max-centre-offset': GUIDANCE_LIMITS.maxCentreOffset,
      'min-secondary-face-area-ratio': GUIDANCE_LIMITS.minSecondaryFaceAreaRatio,
      'announce-after-ms': GUIDANCE_LIMITS.announceAfterMs,
      'preview-width-px': SHARED.client['preview-width-px'],
      'max-center-yaw-ratio': THRESHOLDS.maxCenterYawRatio,
      'min-side-yaw-ratio-change': THRESHOLDS.minSideYawRatioChange,
      'hold-ms': THRESHOLDS.holdMs,
      'side-trigger-factor': THRESHOLDS.sideTriggerFactor,
      'center-trigger-factor': THRESHOLDS.centerTriggerFactor,
      'manual-shutter-after-ms': THRESHOLDS.manualShutterAfterMs,
      'machine-frame-width': MACHINE_FRAME.width,
      'machine-frame-height': MACHINE_FRAME.height,
      'machine-centre-yaw-ratio': MACHINE_CENTRE_YAW_RATIO,
    },
    letterbox: LETTERBOX_CASES.map(letterboxCase),
    decode: decoded.map((entry): Json => ({
      name: entry.name,
      'input-width': entry.width,
      'input-height': entry.height,
      outputs: entry.outputs,
      faces: entry.faces.map(faceJson),
    })),
    yaw: yawCases(decoded),
    machine: MACHINE_CASES.map(machineCase),
  });
}

describe('selfie-guidance-vectors.json (C204.1, C221.8)', () => {
  it('is what the web modules give over this case table', async () => {
    const built = await vectors();
    if (process.env.UPDATE_CONTRACT_FIXTURES === '1') {
      writeFileSync(VECTORS, `${JSON.stringify(built, null, 2)}\n`);
    }
    expect(readJson(VECTORS)).toEqual(built);
  });

  it("names the detector's own thresholds: decodeYunet with them gives the detector's faces", async () => {
    const decoded = await decodeCases();
    for (const entry of decoded) {
      const faces = decodeYunet(
        Object.fromEntries(
          Object.entries(entry.outputs).map(([name, values]) => [name, Float32Array.from(values)]),
        ) as Record<YunetOutputName, Float32Array>,
        {
          paddedWidth: paddedSize(entry.width),
          paddedHeight: paddedSize(entry.height),
          scoreThreshold: CANDIDATE_SCORE_THRESHOLD,
          nmsThreshold: NMS_THRESHOLD,
        },
      );
      expect(faces, entry.name).toEqual(entry.faces);
    }
  });

  it('pins each threshold with a case on either side of it', async () => {
    const decoded = await decodeCases();
    const facesOf = (name: string) => decoded.find((entry) => entry.name === name)?.faces ?? [];
    const candidates = facesOf('scores either side of the candidate threshold');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.score).toBeGreaterThan(CANDIDATE_SCORE_THRESHOLD);
    expect(facesOf('overlap below the NMS threshold keeps both faces')).toHaveLength(2);
    expect(facesOf('overlap above the NMS threshold keeps the better face')).toHaveLength(1);
    // The IoU of each pair, from neighbours(): (size - 8) / (size + 8).
    expect((13 - 8) / (13 + 8)).toBeLessThan(NMS_THRESHOLD);
    expect((17 - 8) / (17 + 8)).toBeGreaterThan(NMS_THRESHOLD);
  });

  it('exercises every message the machine gives a ratio stream, and an auto-capture of each prompt', async () => {
    const built = (await vectors()) as {
      readonly machine: readonly {
        readonly prompt: string;
        readonly steps: readonly { readonly state: string; readonly captures?: boolean }[];
      }[];
    };
    const states = new Set(built.machine.flatMap((entry) => entry.steps.map((step) => step.state)));
    expect([...states].sort()).toEqual([
      'hold-still',
      'look-straight',
      'no-face',
      'turn-left',
      'turn-right',
    ]);
    for (const prompt of ['center', 'left', 'right']) {
      expect(
        built.machine.some(
          (entry) => entry.prompt === prompt && entry.steps.some((step) => step.captures === true),
        ),
        prompt,
      ).toBe(true);
    }
  });
});
