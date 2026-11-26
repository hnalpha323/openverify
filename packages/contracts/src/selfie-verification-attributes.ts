/**
 * C40.10 (Workflow 4A Stage 3, api-flow): the selfie verification attributes, derived at read
 * time from named check metadata keys and the consumed capture, so redaction (which sets every
 * check's metadata to `{}`) nulls the scores. None is PII; the flow API never shows them.
 */
import type { SelfieCaptureMethod } from '@openverify/core';
import type { SelfiePose } from './selfie-captures.js';

/** The consumed capture as the attributes need it: its method, liveness and prompts. */
export interface SelfieVerificationCapture {
  method: SelfieCaptureMethod;
  liveness: 'passive' | 'active';
  prompts: readonly SelfiePose[];
}

/** A corner of the centre face box, normalised to [0, 1]. */
export type UnitPoint = [number, number];

/** The C40.10 attributes of a selfie verification, each `null` when not known. */
export interface SelfieVerificationAttributes {
  'capture-method': SelfieCaptureMethod | null;
  liveness: 'passive' | 'active' | null;
  poses: SelfiePose[] | null;
  'document-similarity-score': number | null;
  'selfie-similarity-score-left': number | null;
  'selfie-similarity-score-right': number | null;
  'liveness-score': number | null;
  'center-photo-face-coordinates': [UnitPoint, UnitPoint, UnitPoint, UnitPoint] | null;
}

/** C40.10: a score rounded to 4 decimals, as the attributes show it. */
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/** A finite number within `[min, max]`, rounded to 4 decimals; `null` otherwise. */
function scoreIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? round4(value)
    : null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * C40.10: the centre face box (`face-box`, `[x, y, width, height]` normalised to [0, 1]) as its
 * four corners: top-left, top-right, bottom-right, bottom-left. `null` for anything else, or a
 * box that does not lie within the image.
 */
function cornersOf(box: unknown): [UnitPoint, UnitPoint, UnitPoint, UnitPoint] | null {
  if (!Array.isArray(box) || box.length !== 4) {
    return null;
  }
  const [x, y, width, height] = box.map((value: unknown) => scoreIn(value, 0, 1));
  if (x == null || y == null || width == null || height == null) {
    return null;
  }
  const right = round4(x + width);
  const bottom = round4(y + height);
  if (right > 1 || bottom > 1) {
    return null;
  }
  return [
    [x, y],
    [right, y],
    [right, bottom],
    [x, bottom],
  ];
}

/**
 * The C40.10 attributes from the checks' metadata and the consumed capture:
 * - `capture-method`, `liveness`, `poses`: the consumed capture's method, liveness and prompts;
 * - `document-similarity-score`: `selfie_id_comparison`'s `similarity`;
 * - `selfie-similarity-score-left` and `-right`: `selfie_liveness_detection`'s `face-cosines`;
 * - `liveness-score`: `selfie_liveness_detection`'s `liveness-score`;
 * - `center-photo-face-coordinates`: `selfie_image_quality_detection`'s `face-box`.
 *
 * Scores are rounded to 4 decimals; a key that is missing (as after redaction, which sets the
 * metadata to `{}`), malformed or out of range gives `null`.
 */
export function selfieVerificationAttributes(
  checks: readonly { name: string; metadata: Readonly<Record<string, unknown>> }[],
  capture: SelfieVerificationCapture | null,
): SelfieVerificationAttributes {
  const metadataOf = (name: string): Readonly<Record<string, unknown>> =>
    checks.find((check) => check.name === name)?.metadata ?? {};
  const comparison = metadataOf('selfie_id_comparison');
  const liveness = metadataOf('selfie_liveness_detection');
  const quality = metadataOf('selfie_image_quality_detection');
  const cosines = isRecord(liveness['face-cosines']) ? liveness['face-cosines'] : {};
  return {
    'capture-method': capture?.method ?? null,
    liveness: capture?.liveness ?? null,
    poses: capture === null ? null : [...capture.prompts],
    'document-similarity-score': scoreIn(comparison.similarity, -1, 1),
    'selfie-similarity-score-left': scoreIn(cosines.left, -1, 1),
    'selfie-similarity-score-right': scoreIn(cosines.right, -1, 1),
    'liveness-score': scoreIn(liveness['liveness-score'], 0, 1),
    'center-photo-face-coordinates': cornersOf(quality['face-box']),
  };
}
