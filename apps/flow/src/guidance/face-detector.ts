/**
 * The in-browser face detector of the guidance (C46.1): YuNet on onnxruntime-web, in one
 * single-threaded WebAssembly session (`numThreads` 1, no proxy worker, `logLevel` error), with
 * explicit `wasmPaths` on the flow's own origin. Every file is checked against its pinned SHA-256
 * before ONNX Runtime sees it, and the WASM binary is handed over already verified.
 *
 * Loading never throws and never logs: when the model or the WASM cannot be loaded, the result
 * is `null` and the capture offers the manual shutter at once.
 */
import { ORT_WASM, ORT_WASM_LOADER, YUNET_MODEL, type GuidanceAsset } from './guidance-assets';
import {
  YUNET_STRIDES,
  decodeYunet,
  type DetectedFace,
  type YunetOutputName,
  type YunetOutputs,
} from './yunet-decode';
import { toYunetInput, type RgbaFrame } from './yunet-input';

export interface FaceDetector {
  /** The faces of one guidance frame, in its pixels. Rejects when the session fails. */
  detect(frame: RgbaFrame): Promise<DetectedFace[]>;
}

/** The parts of onnxruntime-web the detector uses. */
export interface OrtTensor {
  readonly data: unknown;
  readonly dims: readonly number[];
}

export interface OrtSession {
  run(feeds: Readonly<Record<string, OrtTensor>>): Promise<Readonly<Record<string, OrtTensor>>>;
}

export interface OrtModule {
  readonly env: {
    logLevel?: 'verbose' | 'info' | 'warning' | 'error' | 'fatal';
    readonly wasm: {
      numThreads?: number;
      proxy?: boolean;
      wasmPaths?: string | { readonly mjs?: string | URL; readonly wasm?: string | URL };
      wasmBinary?: ArrayBufferLike | Uint8Array;
    };
  };
  readonly InferenceSession: {
    create(
      model: Uint8Array,
      options: {
        readonly executionProviders: readonly string[];
        readonly graphOptimizationLevel: 'all';
        readonly logSeverityLevel: 0 | 1 | 2 | 3 | 4;
      },
    ): Promise<OrtSession>;
  };
  readonly Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => OrtTensor;
}

export interface LoadFaceDetectorOptions {
  /** The flow's base URL, which the guidance files are served under. */
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  /** Imports onnxruntime-web; only called once every file has passed its digest check. */
  readonly importOrt: () => Promise<OrtModule>;
  /** Lower-case hex SHA-256; defaults to `crypto.subtle`. */
  readonly sha256?: (bytes: ArrayBuffer) => Promise<string>;
}

/** YuNet's input name. */
const INPUT_NAME = 'input';
/**
 * Candidates the decoder keeps; the guidance itself only counts faces the vision service would
 * find (`GUIDANCE_FACE_SCORE_THRESHOLD`).
 */
const CANDIDATE_SCORE_THRESHOLD = 0.6;
/** OpenCV's and the vision service's NMS threshold. */
const NMS_THRESHOLD = 0.3;
/** ORT's `logSeverityLevel` for errors only (0 verbose ... 4 fatal). */
const LOG_ERRORS_ONLY = 3;

const OUTPUT_NAMES: readonly YunetOutputName[] = YUNET_STRIDES.flatMap((stride) =>
  (['cls', 'obj', 'bbox', 'kps'] as const).map(
    (head) => `${head}_${String(stride)}` as YunetOutputName,
  ),
);

/** Lower-case hex SHA-256 of `bytes`, with the Web Crypto API. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Fetches `asset` from the flow's origin and checks its digest. */
async function fetchVerified(
  asset: GuidanceAsset,
  { baseUrl, fetch }: LoadFaceDetectorOptions,
  sha256: (bytes: ArrayBuffer) => Promise<string>,
): Promise<ArrayBuffer> {
  const response = await fetch(new URL(asset.path, baseUrl).href, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`${asset.path}: HTTP ${String(response.status)}`);
  }
  const bytes = await response.arrayBuffer();
  if ((await sha256(bytes)) !== asset.sha256) {
    throw new Error(`${asset.path} does not match its pinned SHA-256`);
  }
  return bytes;
}

async function detectFaces(
  ort: OrtModule,
  session: OrtSession,
  frame: RgbaFrame,
): Promise<DetectedFace[]> {
  const input = toYunetInput(frame);
  const tensor = new ort.Tensor('float32', input.data, [
    1,
    3,
    input.paddedHeight,
    input.paddedWidth,
  ]);
  const results = await session.run({ [INPUT_NAME]: tensor });
  const outputs: Partial<Record<YunetOutputName, ArrayLike<number>>> = {};
  for (const name of OUTPUT_NAMES) {
    const data = results[name]?.data;
    if (!(data instanceof Float32Array)) {
      throw new TypeError(`YuNet returned no ${name}`);
    }
    outputs[name] = data;
  }
  return decodeYunet(outputs as YunetOutputs, {
    paddedWidth: input.paddedWidth,
    paddedHeight: input.paddedHeight,
    scoreThreshold: CANDIDATE_SCORE_THRESHOLD,
    nmsThreshold: NMS_THRESHOLD,
  });
}

/** Loads the detector, or resolves `null` when anything about it fails. */
export async function loadFaceDetector(
  options: LoadFaceDetectorOptions,
): Promise<FaceDetector | null> {
  const sha256 = options.sha256 ?? sha256Hex;
  const url = (asset: GuidanceAsset) => new URL(asset.path, options.baseUrl).href;
  try {
    const [model, wasm] = await Promise.all([
      fetchVerified(YUNET_MODEL, options, sha256),
      fetchVerified(ORT_WASM, options, sha256),
      // ONNX Runtime imports the loader itself, from wasmPaths; it is checked here first.
      fetchVerified(ORT_WASM_LOADER, options, sha256),
    ]);
    const ort = await options.importOrt();
    ort.env.logLevel = 'error';
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { mjs: url(ORT_WASM_LOADER), wasm: url(ORT_WASM) };
    ort.env.wasm.wasmBinary = new Uint8Array(wasm);
    const session = await ort.InferenceSession.create(new Uint8Array(model), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      logSeverityLevel: LOG_ERRORS_ONLY,
    });
    return { detect: (frame) => detectFaces(ort, session, frame) };
  } catch {
    // The capture falls back to the manual shutter; nothing about it is an error to report.
    return null;
  }
}
