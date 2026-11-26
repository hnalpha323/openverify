/**
 * Browser capabilities the flow's steps use, behind a context so tests (and later the embedded
 * and inline modes) can replace them: the camera, frame capture, the selfie guidance's detector
 * and clock, and polling cadence.
 */
import { SELFIE_CAPTURE_CLIENT } from '@openverify/contracts';
import { createContext, use, useMemo, type ReactNode } from 'react';
import { loadFaceDetector, type FaceDetector, type OrtModule } from '../guidance/face-detector';
import type { RgbaFrame } from '../guidance/yunet-input';
import { captureFrame } from '../lib/capture-frame';
import { captureDocumentPhoto, type DocumentCapture } from '../lib/document-photo';
import type { Size } from '../lib/photo-check';
import { createFrameSampler } from '../lib/sample-frame';
import { webDeviceKind, type WebDeviceKind } from '../lib/capture-methods';
import {
  requestCamera,
  type CameraAccess,
  type RequestCameraOptions,
} from '../lib/camera-permission';

export interface FlowEnvironment {
  readonly requestCamera: (options?: RequestCameraOptions) => Promise<CameraAccess>;
  readonly captureFrame: (video: HTMLVideoElement) => Promise<Blob>;
  /**
   * Phase 12A F1 to F3: a document photo at the camera's full resolution (the stream's
   * `ImageCapture` still where there is one), re-encoded for upload, with the check of the guide
   * region a preview of `view` CSS pixels frames.
   */
  readonly captureDocument: (
    video: HTMLVideoElement,
    stream: MediaStream,
    view: Size,
  ) => Promise<DocumentCapture>;
  /** C46.1: the selfie guidance's face detector, or `null` when it cannot load. */
  readonly loadFaceDetector: () => Promise<FaceDetector | null>;
  /** The current camera frame, at most `width` pixels wide, or `null` before a frame. */
  readonly sampleFrame: (video: HTMLVideoElement, width: number) => RgbaFrame | null;
  /** A monotonic clock in milliseconds, such as `performance.now()`. */
  readonly now: () => number;
  /**
   * The wall clock in milliseconds since the epoch, such as `Date.now()`: the server's times (a
   * code's expiry, the next resend, C55) are read against it.
   */
  readonly currentTime: () => number;
  /** Delay between two updates of a countdown (the next resend of a code, C64.1). */
  readonly countdownIntervalMs: number;
  /** Delay between two guidance frames (C40.11 `guidance-hz`). */
  readonly guidanceIntervalMs: number;
  /** Delay between two status polls. */
  readonly pollIntervalMs: number;
  /** Polls before a wait is reported as taking longer than usual. */
  readonly maxPolls: number;
  /**
   * C153.2 (Workflow 9A): this browser's device class, whose `captureMethodsByDevice` entry the
   * capture steps apply.
   */
  readonly deviceKind: WebDeviceKind;
}

let detector: Promise<FaceDetector> | null = null;

/**
 * The browser's face detector, loaded once per page from the flow's own origin (C46.1). A load
 * that failed is tried again by the next selfie step; it never throws and never logs.
 */
async function browserFaceDetector(): Promise<FaceDetector | null> {
  // C289 (Phase 11, Workflow 11C): a bundle built with OPENVERIFY_FLOW_FACE_GUIDANCE=off has no
  // detector; the guidance shows its manual shutter, as when the detector cannot load.
  if (import.meta.env.OPENVERIFY_FLOW_FACE_GUIDANCE === 'off') {
    return null;
  }
  if (detector === null) {
    const loading = loadFaceDetector({
      baseUrl: new URL(import.meta.env.BASE_URL, window.location.href).href,
      fetch: (input, init) => globalThis.fetch(input, init),
      importOrt: async () => (await import('onnxruntime-web/wasm')) as unknown as OrtModule,
    }).then((loaded) => {
      if (loaded === null) {
        detector = null;
        throw new Error('the face detector is unavailable');
      }
      return loaded;
    });
    detector = loading;
  }
  return detector.catch(() => null);
}

export const DEFAULT_FLOW_ENVIRONMENT: FlowEnvironment = {
  requestCamera: (options) => requestCamera(options),
  captureFrame: (video) => captureFrame(video),
  captureDocument: (video, stream, view) => captureDocumentPhoto(video, stream, view),
  loadFaceDetector: browserFaceDetector,
  sampleFrame: createFrameSampler(),
  now: () => performance.now(),
  currentTime: () => Date.now(),
  countdownIntervalMs: 1000,
  guidanceIntervalMs: 1000 / SELFIE_CAPTURE_CLIENT['guidance-hz'],
  pollIntervalMs: 2000,
  maxPolls: 60,
  deviceKind: webDeviceKind(navigator),
};

const FlowEnvironmentContext = createContext<FlowEnvironment>(DEFAULT_FLOW_ENVIRONMENT);

export function FlowEnvironmentProvider({
  value,
  children,
}: {
  readonly value: Partial<FlowEnvironment>;
  readonly children: ReactNode;
}) {
  const parent = use(FlowEnvironmentContext);
  const merged = useMemo(() => ({ ...parent, ...value }), [parent, value]);
  return <FlowEnvironmentContext value={merged}>{children}</FlowEnvironmentContext>;
}

export function useFlowEnvironment(): FlowEnvironment {
  return use(FlowEnvironmentContext);
}
