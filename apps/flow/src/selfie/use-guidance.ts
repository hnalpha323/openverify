/**
 * Runs the selfie guidance (C46.1) for the current prompt: about 8 Hz (C40.11 `guidance-hz`), it
 * samples the camera frame at the preview width, runs the detector, and feeds the guidance state
 * machine. It hands over a photo request once the pose was held (auto-capture), offers the manual
 * shutter after 10 s, and gives up quietly when a detection fails. Nothing here decides anything:
 * the server re-measures every frame. KP10-3 (Workflow 10A): the auto-capture is handed the
 * full-resolution copy of the frame whose faces completed the hold, so the photo is the frame
 * judged; the last copy is released when the prompt's guidance stops.
 */
import { SELFIE_CAPTURE_CLIENT, type SelfiePose } from '@openverify/contracts';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useFlowEnvironment } from '../flow/flow-environment';
import { heldFrameOf, type HeldFrame } from '../lib/sample-frame';
import type { FaceDetector } from '../guidance/face-detector';
import {
  startGuidance,
  updateGuidance,
  type DetectorStatus,
  type GuidanceEvent,
  type GuidanceState,
  type GuidanceThresholds,
} from '../guidance/guidance-machine';

export interface GuidancePrompt {
  /** Changes for every prompt shown, so each one starts its own guidance. */
  readonly key: string;
  readonly pose: SelfiePose;
  /** The yaw ratio of the user's own centre frame, for the side poses. */
  readonly centreYawRatio: number | null;
}

/** The detector as the step holds it: still loading, loaded, or unavailable (`null`). */
export type DetectorSlot = FaceDetector | null | 'loading';

export interface UseGuidanceOptions {
  /** The prompt being guided, or `null` while nothing is (an upload, a failure). */
  readonly prompt: GuidancePrompt | null;
  readonly thresholds: GuidanceThresholds | null;
  readonly detector: DetectorSlot;
  readonly video: RefObject<HTMLVideoElement | null>;
  /**
   * The pose was held for `hold-ms`. Called once per prompt, with the full-resolution copy of the
   * frame whose faces completed the hold (`null` from a sampler that holds none). Take it at once:
   * the next sample replaces it.
   */
  readonly onAutoCapture: (state: GuidanceState, held: HeldFrame | null) => void;
  /** A detection failed: the detector is not used again. */
  readonly onDetectorFailed: () => void;
}

function statusOf(detector: DetectorSlot): DetectorStatus {
  if (detector === 'loading') {
    return 'loading';
  }
  return detector === null ? 'unavailable' : 'ready';
}

/**
 * The guidance state of the current prompt, or `null` without one or before its guidance has
 * started: never the state a previous prompt (or a previous shot of this one) left.
 */
export function useGuidance({
  prompt,
  thresholds,
  detector,
  video,
  onAutoCapture,
  onDetectorFailed,
}: UseGuidanceOptions): GuidanceState | null {
  const environment = useFlowEnvironment();
  // The state with the prompt it belongs to: the guidance of a new prompt starts in an effect, after
  // the render that shows the prompt, and the old prompt's state must not stand in for it (K8-33).
  const [held, setHeld] = useState<{ readonly key: string; readonly state: GuidanceState } | null>(
    null,
  );
  const callbacks = useRef({ onAutoCapture, onDetectorFailed });
  /** When each prompt appeared, so a detector that finishes loading keeps the 10 s timer. */
  const started = useRef<{ readonly key: string; readonly at: number } | null>(null);

  useEffect(() => {
    callbacks.current = { onAutoCapture, onDetectorFailed };
  });

  const key = prompt?.key ?? null;
  const pose = prompt?.pose ?? null;
  const centreYawRatio = prompt?.centreYawRatio ?? null;

  useEffect(() => {
    if (key === null || pose === null || thresholds === null) {
      setHeld(null);
      return;
    }
    const { now, sampleFrame, guidanceIntervalMs } = environment;
    if (started.current?.key !== key) {
      started.current = { key, at: now() };
    }
    const status = statusOf(detector);
    let current = startGuidance({
      pose,
      now: started.current.at,
      detector: status,
      centreYawRatio,
    });
    let cancelled = false;
    let fired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** The copy of the last frame sampled for this prompt. */
    let last: HeldFrame | null = null;

    const apply = (event: GuidanceEvent, judged: HeldFrame | null = null) => {
      current = updateGuidance(current, thresholds, event);
      setHeld({ key, state: current });
      if (current.autoCapture && !fired) {
        fired = true;
        callbacks.current.onAutoCapture(current, judged);
      }
    };

    const tick = async () => {
      if (detector !== null && detector !== 'loading') {
        const element = video.current;
        const frame =
          element === null ? null : sampleFrame(element, SELFIE_CAPTURE_CLIENT['preview-width-px']);
        last = frame === null ? null : heldFrameOf(frame);
        if (frame !== null) {
          const judged = last;
          let faces;
          try {
            faces = await detector.detect(frame);
          } catch {
            if (!cancelled) {
              apply({ type: 'detector', now: now(), status: 'unavailable' });
              callbacks.current.onDetectorFailed();
            }
            return;
          }
          if (cancelled) {
            return;
          }
          apply({ type: 'faces', now: now(), faces, frame }, judged);
        } else {
          apply({ type: 'tick', now: now() });
        }
      } else {
        apply({ type: 'tick', now: now() });
      }
      if (!cancelled && !fired) {
        timer = setTimeout(() => void tick(), guidanceIntervalMs);
      }
    };

    // The first state at once (the manual shutter shows now if the detector is unavailable).
    apply({ type: 'tick', now: now() });
    if (status !== 'unavailable') {
      timer = setTimeout(() => void tick(), guidanceIntervalMs);
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Nothing of this prompt's frames is kept once its guidance stops (a taken copy is gone).
      last?.release();
    };
  }, [environment, key, pose, centreYawRatio, thresholds, detector, video]);

  return held !== null && held.key === key ? held.state : null;
}
