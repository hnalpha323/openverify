/**
 * A camera that grants access at once and "captures" a tiny JPEG, for component tests, with the
 * selfie guidance's parts (C46.1): a face detector the test scripts (or none, as when the model
 * cannot load), a fixed guidance frame, and a clock the test moves.
 */
import { fireEvent, screen } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import type { FlowEnvironment } from '../flow/flow-environment';
import type { FaceDetector } from '../guidance/face-detector';
import type { DetectedFace } from '../guidance/yunet-decode';
import type { RgbaFrame } from '../guidance/yunet-input';
import type { CameraAccess } from '../lib/camera-permission';
import { jpegBlob } from './flow-fixtures';

/** The guidance frame the fake camera hands the detector. */
export const GUIDANCE_FRAME = Object.freeze({ width: 320, height: 240 });

/** The fake camera's video track, as `deviceSnapshot` reads it. */
export const FAKE_TRACK_LABEL = 'Fake Test Camera';

export interface FakeDetector extends FaceDetector {
  /** The faces every detection finds, until the test changes them. */
  faces: DetectedFace[];
  /** Makes every detection fail from now on. */
  fail: boolean;
  readonly detect: Mock<FaceDetector['detect']>;
}

export function fakeDetector(faces: DetectedFace[] = []): FakeDetector {
  const detector: FakeDetector = {
    faces,
    fail: false,
    detect: vi.fn<FaceDetector['detect']>(() =>
      detector.fail
        ? Promise.reject(new Error('the session failed'))
        : Promise.resolve([...detector.faces]),
    ),
  };
  return detector;
}

export interface FakeClock {
  readonly now: () => number;
  advance(ms: number): void;
}

export interface FakeCamera {
  readonly environment: Pick<
    FlowEnvironment,
    | 'requestCamera'
    | 'captureFrame'
    | 'captureDocument'
    | 'loadFaceDetector'
    | 'sampleFrame'
    | 'now'
    | 'guidanceIntervalMs'
  >;
  readonly requestCamera: Mock<FlowEnvironment['requestCamera']>;
  readonly captureFrame: Mock<FlowEnvironment['captureFrame']>;
  /** Phase 12A F1: a document photo, with the check of its guide region (sharp by default). */
  readonly captureDocument: Mock<FlowEnvironment['captureDocument']>;
  /** Phase 12A F1: the track's resolution change after the document stream starts. */
  readonly applyConstraints: Mock<(constraints: MediaTrackConstraints) => Promise<void>>;
  readonly loadFaceDetector: Mock<FlowEnvironment['loadFaceDetector']>;
  readonly stop: Mock<() => void>;
  readonly stream: MediaStream;
  readonly clock: FakeClock;
  /** The browser ended the video track (another app took the camera, the device went away). */
  endTrack(): void;
  /** The video track stopped delivering frames (the page went to the background, a privacy switch). */
  muteTrack(): void;
}

export interface FakeCameraOptions {
  readonly access?: CameraAccess;
  /** The guidance's detector; by default none loads, so the manual shutter shows at once. */
  readonly detector?: FakeDetector | null;
}

export function fakeCamera(options: CameraAccess | FakeCameraOptions = {}): FakeCamera {
  const { access, detector = null } =
    'ok' in options ? { access: options, detector: null } : options;
  const stop = vi.fn<() => void>();
  const applyConstraints = vi.fn<(constraints: MediaTrackConstraints) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const events = new EventTarget();
  const track = {
    kind: 'video',
    label: FAKE_TRACK_LABEL,
    readyState: 'live' as MediaStreamTrackState,
    muted: false,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    stop,
    getSettings: () => ({
      width: 1280,
      height: 720,
      frameRate: 30,
      facingMode: 'user',
      resizeMode: 'none',
    }),
    getCapabilities: () => ({ width: { max: 1920 }, height: { max: 1080 }, facingMode: ['user'] }),
    getConstraints: () => ({}),
    applyConstraints,
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  // Each grant hands out a live track.
  const requestCamera = vi.fn<FlowEnvironment['requestCamera']>(() => {
    track.readyState = 'live';
    track.muted = false;
    return Promise.resolve(access ?? { ok: true, stream });
  });
  // Each capture is a new photo, so a retried upload can be told from a retaken one.
  const captureFrame = vi.fn<FlowEnvironment['captureFrame']>(() => Promise.resolve(jpegBlob()));
  const captureDocument = vi.fn<FlowEnvironment['captureDocument']>(() =>
    Promise.resolve({
      photo: jpegBlob(),
      width: 3000,
      height: 4000,
      check: { guideWidthPx: 2550, sharpness: 0.9, problem: null },
    }),
  );
  const loadFaceDetector = vi.fn<FlowEnvironment['loadFaceDetector']>(() =>
    Promise.resolve(detector),
  );
  let now = 0;
  const clock: FakeClock = {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
  const frame: RgbaFrame = {
    ...GUIDANCE_FRAME,
    data: new Uint8ClampedArray(GUIDANCE_FRAME.width * GUIDANCE_FRAME.height * 4),
  };
  return {
    environment: {
      requestCamera,
      captureFrame,
      captureDocument,
      loadFaceDetector,
      sampleFrame: () => frame,
      now: clock.now,
      guidanceIntervalMs: 1,
    },
    requestCamera,
    captureFrame,
    captureDocument,
    applyConstraints,
    loadFaceDetector,
    stop,
    stream,
    clock,
    endTrack: () => {
      track.readyState = 'ended';
      events.dispatchEvent(new Event('ended'));
    },
    muteTrack: () => {
      track.muted = true;
      events.dispatchEvent(new Event('mute'));
    },
  };
}

/** jsdom never plays media: tell the preview its first frame has arrived. */
export async function cameraDeliversFrame(): Promise<void> {
  fireEvent.loadedData(await screen.findByLabelText('Camera preview'));
}
