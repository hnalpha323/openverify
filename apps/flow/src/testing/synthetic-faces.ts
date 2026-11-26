/**
 * Faces as the detector reports them, drawn from numbers only (never from a real face), for the
 * guidance tests: a box and five landmarks whose yaw ratio is exactly `yaw`.
 */
import type { DetectedFace } from '../guidance/yunet-decode';
import { GUIDANCE_FRAME } from './fake-camera';

export interface SyntheticFaceOptions {
  readonly yaw?: number;
  readonly cx?: number;
  readonly cy?: number;
  /** Box height as a share of the guidance frame's height. */
  readonly height?: number;
  readonly score?: number;
}

export function syntheticFace({
  yaw = 0,
  cx = GUIDANCE_FRAME.width / 2,
  cy = GUIDANCE_FRAME.height / 2,
  height = 0.5,
  score = 0.95,
}: SyntheticFaceOptions = {}): DetectedFace {
  const h = height * GUIDANCE_FRAME.height;
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
    score,
  };
}
