/**
 * Pure functions over the C40 capture context: the device snapshot's flags, the image-mirrored
 * yaw sign, and the order and timing flags of `selfie_liveness_detection` (C43). Order and timing
 * are client-controlled, so they never fail a check; they only lower liveness's confidence.
 */
import type {
  SelfieCaptureInput,
  SelfieDeviceFlags,
  SelfiePose,
  SelfiePromptTimingInput,
} from './inputs.js';
import { virtualCameraOf } from './virtual-cameras.js';

/** The C40.4 device snapshot members the flags read (a structural subset). */
export interface SelfieDeviceSnapshotInput {
  label?: string | undefined;
  webdriver?: boolean | undefined;
  'image-mirrored'?: boolean | undefined;
}

/** Absolute POSIX or home paths, Windows drive and UNC paths, and `file:` URLs. */
const PATH_PREFIX = /^(?:\/|~\/|[a-z]:[\\/]|\\\\|file:)/i;
/** Video and still-clip files a fake camera plays (Chromium reads Y4M and MJPEG). */
const CLIP_EXTENSION = /\.(?:y4m|mjpe?g|mp4|webm|mkv|avi|mov)$/i;

/** Whether a camera label is a file path (Chromium's file-backed fake camera reports the path). */
export function isFilePathLabel(label: string): boolean {
  const trimmed = label.trim();
  return PATH_PREFIX.test(trimmed) || CLIP_EXTENSION.test(trimmed);
}

/** The flags of a device snapshot; `null` without one. The label itself is never kept. */
export function captureDeviceFlags(
  snapshot: SelfieDeviceSnapshotInput | null | undefined,
): SelfieDeviceFlags | null {
  if (snapshot == null) {
    return null;
  }
  const label = snapshot.label ?? '';
  return {
    labelIsFilePath: isFilePathLabel(label),
    virtualCamera: virtualCameraOf(label) !== null,
    webdriver: snapshot.webdriver === true,
    imageMirrored: snapshot['image-mirrored'] === true,
  };
}

/** The yaw ratio in the unmirrored convention (C41.1): the sign flips for a mirrored image. */
export function orientedYawRatio(yawRatio: number, imageMirrored: boolean): number {
  return imageMirrored && yawRatio !== 0 ? -yawRatio : yawRatio;
}

/**
 * The provisional timing rules (not fitted to any fixture): the shortest server-clock interval
 * between consecutive prompts a person can turn and hold in (research §11.3's 0.3 s dwell floor),
 * and the largest difference between the client's and the server's interval that upload latency
 * explains.
 */
export const CAPTURE_TIMING_RULES = Object.freeze({
  minPoseIntervalMs: 300,
  maxClockSkewMs: 5000,
});

/** The timing flags, in this order. */
export const CAPTURE_TIMING_FLAGS = Object.freeze([
  'timing-missing',
  'client-elapsed-missing',
  'client-elapsed-not-increasing',
  'uploads-batched',
  'client-server-skew',
  'received-outside-window',
] as const);
export type CaptureTimingFlag = (typeof CAPTURE_TIMING_FLAGS)[number];

/** The timings of the prompted poses that have one, in prompt order (the latest per pose). */
function promptedTimings(
  prompts: readonly SelfiePose[],
  timings: readonly SelfiePromptTimingInput[],
): SelfiePromptTimingInput[] {
  return prompts.flatMap((pose) => timings.filter((timing) => timing.pose === pose).slice(-1));
}

/**
 * Whether the files arrived in prompt order (server clock); `null` when no prompted pose has a
 * timing, so the order cannot be told.
 */
export function promptOrderFollowed(
  prompts: readonly SelfiePose[],
  timings: readonly SelfiePromptTimingInput[],
): boolean | null {
  const times = promptedTimings(prompts, timings).map((timing) => timing.receivedAt.getTime());
  if (times.length === 0) {
    return null;
  }
  return times.every((time, index) => index === 0 || time > (times[index - 1] ?? time));
}

/**
 * The timing flags of a capture, in {@link CAPTURE_TIMING_FLAGS} order. Consecutive prompts are
 * compared from the capture's creation on (the client's clock starts at zero there):
 * - `timing-missing`: a prompted pose has no timing;
 * - `client-elapsed-missing`: a timing lacks the client's elapsed time;
 * - `client-elapsed-not-increasing`: the client's clock does not increase from prompt to prompt;
 * - `uploads-batched`: two files (or the capture and the first file) arrived less than
 *   `minPoseIntervalMs` apart on the server clock, so the poses were not uploaded one by one;
 * - `client-server-skew`: the client's interval and the server's differ by more than
 *   `maxClockSkewMs`;
 * - `received-outside-window`: a file arrived before the capture or after it expired.
 */
export function captureTimingFlags(capture: SelfieCaptureInput): CaptureTimingFlag[] {
  const flags = new Set<CaptureTimingFlag>();
  const timings = promptedTimings(capture.prompts, capture.promptTimings);
  if (timings.length < capture.prompts.length) {
    flags.add('timing-missing');
  }
  const created = capture.createdAt.getTime();
  const expires = capture.expiresAt.getTime();
  let previous: { server: number; client: number | null; first: boolean } = {
    server: created,
    client: 0,
    first: true,
  };
  for (const timing of timings) {
    const server = timing.receivedAt.getTime();
    const client = timing.clientElapsedMs;
    if (client === null) {
      flags.add('client-elapsed-missing');
    }
    if (server < created || server > expires) {
      flags.add('received-outside-window');
    }
    const serverInterval = server - previous.server;
    if (serverInterval >= 0 && serverInterval < CAPTURE_TIMING_RULES.minPoseIntervalMs) {
      flags.add('uploads-batched');
    }
    if (client !== null && previous.client !== null) {
      if (!previous.first && client <= previous.client) {
        flags.add('client-elapsed-not-increasing');
      }
      if (
        Math.abs(serverInterval - (client - previous.client)) > CAPTURE_TIMING_RULES.maxClockSkewMs
      ) {
        flags.add('client-server-skew');
      }
    }
    previous = { server, client, first: false };
  }
  return CAPTURE_TIMING_FLAGS.filter((flag) => flags.has(flag));
}
