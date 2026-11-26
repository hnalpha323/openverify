/**
 * A typed wrapper around `navigator.mediaDevices.getUserMedia` for the camera.
 * It never throws: callers get a discriminated result whose error `code` maps
 * one-to-one onto a user-facing message (see `camera.errors.*` in the locales).
 */

export type CameraErrorCode =
  /** The user or a policy blocked camera access. */
  | 'permission-denied'
  /** No camera is connected. */
  | 'no-camera'
  /** No camera satisfies the requested constraints (`constraint` names the first that failed). */
  | 'constraints-not-satisfied'
  /** The camera exists but could not be started, usually because another app holds it. */
  | 'camera-in-use'
  /** The page is not a secure context, so browsers hide `navigator.mediaDevices`. */
  | 'insecure-context'
  /** The browser has no `getUserMedia`. */
  | 'unsupported'
  | 'unknown';

export const CAMERA_ERROR_CODES: readonly CameraErrorCode[] = [
  'permission-denied',
  'no-camera',
  'constraints-not-satisfied',
  'camera-in-use',
  'insecure-context',
  'unsupported',
  'unknown',
];

export interface CameraError {
  readonly code: CameraErrorCode;
  /** For `constraints-not-satisfied`: the constraint the browser reported, when it named one. */
  readonly constraint?: string;
  /** The original error, for diagnostics. Never show it to the user. */
  readonly cause?: unknown;
}

export type CameraAccess =
  | { readonly ok: true; readonly stream: MediaStream }
  | { readonly ok: false; readonly error: CameraError };

export type MediaDevicesLike = Pick<MediaDevices, 'getUserMedia'>;

export interface RequestCameraOptions {
  readonly constraints?: MediaStreamConstraints;
  /** Defaults to `navigator.mediaDevices`; `null` means the browser provides none. */
  readonly mediaDevices?: MediaDevicesLike | null;
  /** Defaults to `globalThis.isSecureContext`; only an explicit `false` counts as insecure. */
  readonly isSecureContext?: boolean;
}

/** Front ("user") camera at up to 720p, no microphone. */
export const DEFAULT_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
};

// DOMException names from the Media Capture spec, plus the legacy Chrome names
// (PermissionDeniedError, DevicesNotFoundError, ConstraintNotSatisfiedError, TrackStartError).
// A Map, not an object literal, so a name such as "constructor" cannot hit Object.prototype.
const CODES_BY_ERROR_NAME = new Map<string, CameraErrorCode>([
  ['NotAllowedError', 'permission-denied'],
  ['PermissionDeniedError', 'permission-denied'],
  ['SecurityError', 'permission-denied'],
  ['NotFoundError', 'no-camera'],
  ['DevicesNotFoundError', 'no-camera'],
  ['OverconstrainedError', 'constraints-not-satisfied'],
  ['ConstraintNotSatisfiedError', 'constraints-not-satisfied'],
  ['NotReadableError', 'camera-in-use'],
  ['TrackStartError', 'camera-in-use'],
]);

function stringProperty(value: unknown, key: 'name' | 'constraint'): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }
  const property: unknown = (value as Record<typeof key, unknown>)[key];
  return typeof property === 'string' && property !== '' ? property : undefined;
}

/** Maps anything `getUserMedia` rejects with to a typed camera error. */
export function toCameraError(error: unknown): CameraError {
  const name = stringProperty(error, 'name');
  const code = (name === undefined ? undefined : CODES_BY_ERROR_NAME.get(name)) ?? 'unknown';
  const constraint =
    code === 'constraints-not-satisfied' ? stringProperty(error, 'constraint') : undefined;

  return constraint === undefined ? { code, cause: error } : { code, constraint, cause: error };
}

function browserIsSecureContext(): boolean {
  // Undefined outside browsers (and in jsdom): unknown is not evidence of an insecure page.
  return (globalThis as Partial<WindowOrWorkerGlobalScope>).isSecureContext !== false;
}

function browserMediaDevices(): MediaDevicesLike | null {
  // Despite the DOM typings, `mediaDevices` is undefined outside secure contexts.
  const navigatorLike = globalThis.navigator as Partial<Navigator> | undefined;
  return navigatorLike?.mediaDevices ?? null;
}

/** Asks for the camera. Resolves with the stream, or with a typed error; never rejects. */
export async function requestCamera({
  constraints = DEFAULT_CAMERA_CONSTRAINTS,
  mediaDevices = browserMediaDevices(),
  isSecureContext = browserIsSecureContext(),
}: RequestCameraOptions = {}): Promise<CameraAccess> {
  if (mediaDevices === null) {
    return { ok: false, error: { code: isSecureContext ? 'unsupported' : 'insecure-context' } };
  }
  try {
    return { ok: true, stream: await mediaDevices.getUserMedia(constraints) };
  } catch (error: unknown) {
    return { ok: false, error: toCameraError(error) };
  }
}

/** Stops every track so the browser releases the camera (and turns its light off). */
export function stopStream(stream: Pick<MediaStream, 'getTracks'>): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
