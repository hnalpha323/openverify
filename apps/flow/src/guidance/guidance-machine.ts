/**
 * The selfie guidance (C46.1) as a pure state machine. Each event (a detection on the guidance
 * frame, the detector becoming ready or unavailable, or time passing) gives the next state: the
 * message to show, whether the pose is held, whether to capture automatically, and whether the
 * manual shutter is available.
 *
 * It checks a face is found, there is one face, it is centred and at a usable distance, and the
 * pose: the centre once `|yaw_ratio|` is at most `center-trigger-factor` x the server's
 * `max-center-yaw-ratio`; a side pose once the yaw ratio changed from the user's own centre frame
 * by `side-trigger-factor` x the server's `min-side-yaw-ratio-change`, in the prompted direction
 * (C40.11). The pose must hold for `hold-ms`. The manual shutter appears after
 * `manual-shutter-after-ms`, or at once when the detector cannot run.
 *
 * The guidance never decides anything: the server re-measures every frame (C46.1).
 */
import type { SelfieCaptureGuidance, SelfiePose } from '@openverify/contracts';
import { yawRatio } from './head-pose';
import type { DetectedFace } from './yunet-decode';

/**
 * A face counts once YuNet scores it at least this: the vision service's own default
 * (`face_score_threshold`), so the guidance does not take a photo in which the server finds no
 * face.
 */
export const GUIDANCE_FACE_SCORE_THRESHOLD = 0.9;

/** Client framing limits (UX only: the server re-measures every frame). */
export const GUIDANCE_LIMITS = Object.freeze({
  /**
   * Face box height over frame height: the server's provisional `min-face-height-ratio` (0.2,
   * C39.3) with a quarter of margin, so a photo the guidance takes is not too small for it.
   */
  minFaceHeightRatio: 0.25,
  /** Closer than this, the oval (78% of the preview's height) no longer holds the face. */
  maxFaceHeightRatio: 0.8,
  /** Largest offset of the face centre from the frame centre, as a share of each dimension. */
  maxCentreOffset: 0.15,
  /**
   * A second face counts once its box is at least this share of the user's face box: the
   * server's provisional `min-secondary-face-area-ratio` (C39.3).
   */
  minSecondaryFaceAreaRatio: 0.25,
  /** A message is announced once it has stayed on screen this long (8 Hz would be noise). */
  announceAfterMs: 1500,
});

export interface GuidanceThresholds {
  /** The server's provisional pose thresholds and hold time, from the capture (C40.2). */
  readonly maxCenterYawRatio: number;
  readonly minSideYawRatioChange: number;
  readonly holdMs: number;
  /** C40.11 client constants (`SELFIE_CAPTURE_CLIENT`). */
  readonly sideTriggerFactor: number;
  readonly centerTriggerFactor: number;
  readonly manualShutterAfterMs: number;
}

export interface ClientCaptureConstants {
  readonly 'side-trigger-factor': number;
  readonly 'center-trigger-factor': number;
  readonly 'manual-shutter-after-ms': number;
}

/** The thresholds of one capture: the server's guidance with the client constants. */
export function guidanceThresholds(
  guidance: SelfieCaptureGuidance,
  client: ClientCaptureConstants,
): GuidanceThresholds {
  return {
    maxCenterYawRatio: guidance['max-center-yaw-ratio'],
    minSideYawRatioChange: guidance['min-side-yaw-ratio-change'],
    holdMs: guidance['hold-ms'],
    sideTriggerFactor: client['side-trigger-factor'],
    centerTriggerFactor: client['center-trigger-factor'],
    manualShutterAfterMs: client['manual-shutter-after-ms'],
  };
}

/** The largest `|yaw_ratio|` at which the centre auto-captures. */
export function centreTrigger(thresholds: GuidanceThresholds): number {
  return thresholds.centerTriggerFactor * thresholds.maxCenterYawRatio;
}

/** The smallest yaw-ratio change from the centre frame at which a side pose auto-captures. */
export function sideTrigger(thresholds: GuidanceThresholds): number {
  return thresholds.sideTriggerFactor * thresholds.minSideYawRatioChange;
}

export type GuidanceMessage =
  /** The detector is still loading. */
  | 'starting'
  /** The detector cannot run: the user takes the photo with the shutter. */
  | 'manual'
  | 'no-face'
  | 'multiple-faces'
  | 'too-far'
  | 'too-close'
  | 'off-centre'
  | 'look-straight'
  | 'turn-left'
  | 'turn-right'
  /** Every check passes: the pose is being held. */
  | 'hold-still';

export type DetectorStatus = 'loading' | 'ready' | 'unavailable';

export interface GuidanceState {
  readonly pose: SelfiePose;
  /** When the prompt appeared. */
  readonly startedAt: number;
  /** The yaw ratio of the user's own centre frame, which the side poses are judged against. */
  readonly centreYawRatio: number | null;
  readonly detector: DetectorStatus;
  readonly message: GuidanceMessage;
  /** When `message` last changed. */
  readonly messageSince: number;
  /** The message a screen reader hears: one that has stayed on screen for a while. */
  readonly announcement: GuidanceMessage | null;
  /** Since when every check has passed, or `null`. */
  readonly heldSince: number | null;
  /** The yaw ratio of the latest well-placed single face, or `null`. */
  readonly yawRatio: number | null;
  readonly manualShutter: boolean;
  /** The pose was held for `hold-ms`: take the photo. */
  readonly autoCapture: boolean;
}

export type GuidanceEvent =
  | { readonly type: 'tick'; readonly now: number }
  | { readonly type: 'detector'; readonly now: number; readonly status: 'ready' | 'unavailable' }
  | {
      readonly type: 'faces';
      readonly now: number;
      readonly faces: readonly DetectedFace[];
      /** The guidance frame the faces were found in. */
      readonly frame: { readonly width: number; readonly height: number };
    };

export interface StartGuidanceOptions {
  readonly pose: SelfiePose;
  readonly now: number;
  readonly detector: DetectorStatus;
  readonly centreYawRatio: number | null;
}

/** What a prompt asks for before the first frame is judged. */
const POSE_INSTRUCTION: Readonly<Record<SelfiePose, GuidanceMessage>> = {
  center: 'look-straight',
  left: 'turn-left',
  right: 'turn-right',
};

function initialMessage({ pose, detector }: StartGuidanceOptions): GuidanceMessage {
  switch (detector) {
    case 'unavailable':
      return 'manual';
    case 'loading':
      return 'starting';
    case 'ready':
      return POSE_INSTRUCTION[pose];
  }
}

/** The state when a prompt appears. */
export function startGuidance(options: StartGuidanceOptions): GuidanceState {
  const unavailable = options.detector === 'unavailable';
  return {
    pose: options.pose,
    startedAt: options.now,
    centreYawRatio: options.centreYawRatio,
    detector: options.detector,
    message: initialMessage(options),
    messageSince: options.now,
    announcement: null,
    heldSince: null,
    yawRatio: null,
    manualShutter: unavailable,
    autoCapture: false,
  };
}

const area = (face: DetectedFace): number => face.box[2] * face.box[3];

interface Judgement {
  readonly message: GuidanceMessage;
  /** The yaw ratio of a single, well-placed face, whatever its pose. */
  readonly yawRatio: number | null;
  /** Every check passes. */
  readonly ok: boolean;
}

/** The pose check: is the face turned as prompted? */
function poseMessage(
  state: GuidanceState,
  thresholds: GuidanceThresholds,
  yaw: number,
): GuidanceMessage | null {
  if (state.pose === 'center') {
    return Math.abs(yaw) <= centreTrigger(thresholds) ? null : 'look-straight';
  }
  const prompt = state.pose === 'left' ? 'turn-left' : 'turn-right';
  if (state.centreYawRatio === null) {
    // Without the user's own centre frame the turn cannot be judged: the manual shutter decides.
    return prompt;
  }
  // A turn to the user's own left raises the yaw ratio in the unmirrored frame (C41.1).
  const change = state.pose === 'left' ? yaw - state.centreYawRatio : state.centreYawRatio - yaw;
  return change >= sideTrigger(thresholds) ? null : prompt;
}

/** Judges the faces of one guidance frame, in the order the user should fix things. */
function judge(
  state: GuidanceState,
  thresholds: GuidanceThresholds,
  faces: readonly DetectedFace[],
  frame: { readonly width: number; readonly height: number },
): Judgement {
  const found = faces
    .filter((face) => face.score >= GUIDANCE_FACE_SCORE_THRESHOLD)
    .sort((a, b) => area(b) - area(a));
  const [primary, ...others] = found;
  if (primary === undefined || frame.width <= 0 || frame.height <= 0) {
    return { message: 'no-face', yawRatio: null, ok: false };
  }
  const limits = GUIDANCE_LIMITS;
  if (others.some((face) => area(face) >= limits.minSecondaryFaceAreaRatio * area(primary))) {
    return { message: 'multiple-faces', yawRatio: null, ok: false };
  }
  const [x, y, width, height] = primary.box;
  const heightRatio = height / frame.height;
  if (heightRatio < limits.minFaceHeightRatio) {
    return { message: 'too-far', yawRatio: null, ok: false };
  }
  if (heightRatio > limits.maxFaceHeightRatio) {
    return { message: 'too-close', yawRatio: null, ok: false };
  }
  const offsetX = Math.abs(x + width / 2 - frame.width / 2) / frame.width;
  const offsetY = Math.abs(y + height / 2 - frame.height / 2) / frame.height;
  if (offsetX > limits.maxCentreOffset || offsetY > limits.maxCentreOffset) {
    return { message: 'off-centre', yawRatio: null, ok: false };
  }
  const yaw = yawRatio(primary.landmarks);
  if (yaw === null) {
    return { message: 'no-face', yawRatio: null, ok: false };
  }
  const message = poseMessage(state, thresholds, yaw);
  return message === null
    ? { message: 'hold-still', yawRatio: yaw, ok: true }
    : { message, yawRatio: yaw, ok: false };
}

/** Moves `state` to `message` at `now`, settling the announcement. */
function withMessage(state: GuidanceState, message: GuidanceMessage, now: number): GuidanceState {
  const messageSince = message === state.message ? state.messageSince : now;
  const settled = now - messageSince >= GUIDANCE_LIMITS.announceAfterMs;
  return {
    ...state,
    message,
    messageSince,
    announcement: settled ? message : state.announcement,
  };
}

/** The manual shutter, once shown, stays. */
function withManualShutter(
  state: GuidanceState,
  thresholds: GuidanceThresholds,
  now: number,
): GuidanceState {
  const manualShutter =
    state.manualShutter ||
    state.detector === 'unavailable' ||
    now - state.startedAt >= thresholds.manualShutterAfterMs;
  return manualShutter === state.manualShutter ? state : { ...state, manualShutter };
}

/** The state after `event`. */
export function updateGuidance(
  state: GuidanceState,
  thresholds: GuidanceThresholds,
  event: GuidanceEvent,
): GuidanceState {
  const { now } = event;
  switch (event.type) {
    case 'tick':
      return withManualShutter(withMessage(state, state.message, now), thresholds, now);
    case 'detector': {
      const next = { ...state, detector: event.status };
      const message = event.status === 'unavailable' ? 'manual' : state.message;
      return withManualShutter(withMessage(next, message, now), thresholds, now);
    }
    case 'faces': {
      const judgement = judge(state, thresholds, event.faces, event.frame);
      const heldSince = judgement.ok ? (state.heldSince ?? now) : null;
      const next: GuidanceState = {
        ...state,
        heldSince,
        yawRatio: judgement.yawRatio,
        autoCapture:
          state.autoCapture || (heldSince !== null && now - heldSince >= thresholds.holdMs),
      };
      return withManualShutter(withMessage(next, judgement.message, now), thresholds, now);
    }
  }
}
