/**
 * The device snapshot a selfie submit carries (C40.4): what the browser says about the camera
 * that took the photos, bounded and checked against the contract. These are client claims; the
 * server only records them as risk signals. Captures are never mirrored (`image-mirrored` false):
 * only the preview is. The device and group ids are never sent.
 */
import {
  sanitizeDeviceLabel,
  selfieDeviceSnapshotSchema,
  type SelfieDeviceSnapshot,
} from '@openverify/contracts';

/** Track settings, with `resizeMode`, which the DOM typings do not list yet. */
export interface CameraTrackSettings extends MediaTrackSettings {
  readonly resizeMode?: string;
}

/** The parts of a `MediaStreamTrack` the snapshot reads. */
export interface CameraTrackLike {
  readonly label: string;
  getSettings(): CameraTrackSettings;
  getCapabilities?: () => MediaTrackCapabilities;
  /** Chromium's `MediaStreamTrackVideoStats` (W3C mediacapture-extensions). */
  readonly stats?: unknown;
}

export interface NavigatorLike {
  readonly webdriver?: boolean;
}

type Settings = NonNullable<SelfieDeviceSnapshot['settings']>;
type Capabilities = NonNullable<SelfieDeviceSnapshot['capabilities']>;
type FrameStats = NonNullable<SelfieDeviceSnapshot['frame-stats']>;
type FacingMode = NonNullable<Settings['facing-mode']>;

const FACING_MODES: ReadonlySet<string> = new Set<FacingMode>([
  'user',
  'environment',
  'left',
  'right',
]);
const RESIZE_MODES: ReadonlySet<string> = new Set(['none', 'crop-and-scale']);
const MAX_FACING_MODES = 4;
const MAX_PIXELS = 16_384;
const MAX_FRAME_RATE = 1000;
const MAX_FRAME_COUNT = 1_000_000_000;

/** A whole number within `[min, max]`, or `undefined`. */
function whole(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : undefined;
}

function frameRate(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_FRAME_RATE
    ? value
    : undefined;
}

/** `object` without its `undefined` members, or `undefined` when none is left. */
function defined<T extends object>(object: {
  readonly [K in keyof T]: T[K] | undefined;
}): T | undefined {
  const entries = Object.entries(object).filter(([, value]) => value !== undefined);
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as T);
}

function settingsOf(track: CameraTrackLike): Settings | undefined {
  const settings = track.getSettings();
  return defined<Settings>({
    width: whole(settings.width, 1, MAX_PIXELS),
    height: whole(settings.height, 1, MAX_PIXELS),
    'frame-rate': frameRate(settings.frameRate),
    'facing-mode':
      settings.facingMode !== undefined && FACING_MODES.has(settings.facingMode)
        ? (settings.facingMode as FacingMode)
        : undefined,
    'resize-mode':
      settings.resizeMode !== undefined && RESIZE_MODES.has(settings.resizeMode)
        ? (settings.resizeMode as Settings['resize-mode'])
        : undefined,
  });
}

function capabilitiesOf(track: CameraTrackLike): Capabilities | undefined {
  const capabilities = track.getCapabilities?.();
  if (capabilities === undefined) {
    return undefined;
  }
  const facingModes = [
    ...new Set((capabilities.facingMode ?? []).filter((mode) => FACING_MODES.has(mode))),
  ].slice(0, MAX_FACING_MODES) as FacingMode[];
  return defined<Capabilities>({
    'width-max': whole(capabilities.width?.max, 1, MAX_PIXELS),
    'height-max': whole(capabilities.height?.max, 1, MAX_PIXELS),
    'frame-rate-max': frameRate(capabilities.frameRate?.max),
    'facing-modes': facingModes.length === 0 ? undefined : facingModes,
  });
}

function frameStatsOf(track: CameraTrackLike): FrameStats | undefined {
  const { stats } = track;
  if (typeof stats !== 'object' || stats === null) {
    return undefined;
  }
  const count = (key: string) =>
    whole((stats as Readonly<Record<string, unknown>>)[key], 0, MAX_FRAME_COUNT);
  return defined<FrameStats>({
    delivered: count('deliveredFrames'),
    discarded: count('discardedFrames'),
    total: count('totalFrames'),
  });
}

/** The snapshot of `track`, as the submit sends it. */
export function deviceSnapshot(
  track: CameraTrackLike,
  navigator: NavigatorLike,
): SelfieDeviceSnapshot {
  const label = sanitizeDeviceLabel(track.label);
  const snapshot = defined<SelfieDeviceSnapshot>({
    label: label === '' ? undefined : label,
    settings: settingsOf(track),
    capabilities: capabilitiesOf(track),
    'frame-stats': frameStatsOf(track),
    webdriver: navigator.webdriver === true,
    // The photos are taken from the raw camera frame; only the preview is mirrored.
    'image-mirrored': false,
  });
  return selfieDeviceSnapshotSchema.parse(snapshot);
}
