/**
 * The Phase 1 government ID checks (contract C7), evaluated from the vision service's analysis
 * and the uploaded files, with their Phase 3 measures (C29.5, C32.2). Reason codes are listed in
 * `GOVERNMENT_ID_CHECK_REASONS` of `@openverify/contracts`; the Phase 1 ones stay as they were.
 */
import type { CheckModel, CheckResult } from '@openverify/core';
import type { DocumentFeatures } from '../data/feature-table.js';
import { checkResult } from '../result.js';
import type {
  DocumentQualityInput,
  GovernmentIdAnalysisInput,
  IdSideAnalysisInput,
  IdSides,
  UploadedImage,
} from './inputs.js';
import {
  isPdf417,
  numberOf,
  phashDistance,
  sidesOf,
  thresholdsOf,
  type ConfigValues,
  type Side,
} from '../government-id/values.js';

/** A check's effective config: kebab-case keys (C29.5). */
export type CheckConfigInput = ConfigValues;

const BLUR_KEYS = [
  'min-blur-score',
  'min-document-blur-score',
  'min-document-tenengrad',
  'min-document-width-px',
  'legible-text-min-confidence',
  'legible-text-min-lines',
] as const;

/** Phase 12A C9: the OCR median confidence and line count at which a side reads as legible. */
export const LEGIBLE_TEXT_DEFAULTS = Object.freeze({
  'legible-text-min-confidence': 0.9,
  'legible-text-min-lines': 8,
});

/**
 * The share of each document sharpness threshold a side must still reach for its OCR to count as
 * legibility. Below it the card is plainly blurred, and OCR confidence does not rescue it: the
 * text models read blurred print with high confidence. The C36 `blurred` Utopia front, measured by
 * the Phase 12A vision, scores 44.74 (0.67 of the calibrated 67.1) and reads 18 lines at a median
 * of 0.999; the blurred and moved captures of the Phase 12A calibration score at most 1 / 1.339
 * (0.75) of it (`docs/calibration/blur-phase12a.md`). 0.8 keeps all of them failed and rescues
 * only a side within a fifth under the thresholds (integration-12a; checks-12a had 0.5, which
 * the calibrated values turned into a rescue of the `blurred` variant).
 */
export const LEGIBLE_MIN_SHARPNESS_SHARE = 0.8;

const medianOf = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/**
 * `id_blur_detection`: fails when any analysed side is too blurry to read.
 * - The rectified document, when its thresholds are configured (C29.5): its Laplacian variance
 *   and Tenengrad sharpness (`image_blurry`) and its width (`resolution_too_low`). A side whose
 *   document was measured is judged on these instead of vision's whole-image verdict (Phase 12A
 *   C9): the whole image's score also counts the desk around the card and falls with the frame
 *   size, so a sharp card photographed by a phone scored under vision's limit.
 * - A side the document measure calls blurry, but within a fifth under each threshold
 *   ({@link LEGIBLE_MIN_SHARPNESS_SHARE}), is still legible when its OCR read at least
 *   `legible-text-min-lines` lines (default 8) at a median confidence of at least
 *   `legible-text-min-confidence` (default 0.9): it is not failed for `image_blurry`, and
 *   `legible-by-ocr-sides` names it. Too few lines, a low median, or a plainly blurred card keeps
 *   the failure.
 * - The whole image, as in Phase 1: the raw score against a configured `min-blur-score` on every
 *   side; without one, vision's verdict, for a side without a measured document or when no
 *   document threshold is configured.
 */
export function idBlurDetection(
  analysis: GovernmentIdAnalysisInput,
  config: CheckConfigInput = {},
): CheckResult {
  const sides = sidesOf(analysis);
  const minBlur = numberOf(config, 'min-blur-score');
  const minDocumentBlur = numberOf(config, 'min-document-blur-score');
  const minTenengrad = numberOf(config, 'min-document-tenengrad');
  const minWidth = numberOf(config, 'min-document-width-px');
  const judgesDocument = minDocumentBlur !== undefined || minTenengrad !== undefined;
  // Vision's own whole-image verdict yields to the document measure; a `min-blur-score` the
  // template configures is the operator's choice and applies to every side.
  const blurrySides = sides
    .filter(([, side]) =>
      minBlur === undefined
        ? side.quality.is_blurry && !(judgesDocument && side.document_quality != null)
        : side.quality.blur_score < minBlur,
    )
    .map(([name]) => name);
  const metadata: Record<string, unknown> = {
    front_blur_score: analysis.sides.front.quality.blur_score,
    back_blur_score: analysis.sides.back?.quality.blur_score ?? null,
    blurry_sides: blurrySides,
  };
  const minConfidence =
    numberOf(config, 'legible-text-min-confidence') ??
    LEGIBLE_TEXT_DEFAULTS['legible-text-min-confidence'];
  const minLines =
    numberOf(config, 'legible-text-min-lines') ?? LEGIBLE_TEXT_DEFAULTS['legible-text-min-lines'];
  const legible = (side: IdSideAnalysisInput, quality: DocumentQualityInput): boolean => {
    const confidences = (side.text ?? []).map((line) => line.confidence);
    const share = LEGIBLE_MIN_SHARPNESS_SHARE;
    return (
      (minDocumentBlur === undefined || quality.blur_score >= share * minDocumentBlur) &&
      (minTenengrad === undefined || quality.tenengrad >= share * minTenengrad) &&
      confidences.length >= minLines &&
      medianOf(confidences) >= minConfidence
    );
  };
  const documentBlurry: Side[] = [];
  const legibleSides: Side[] = [];
  const lowResolution: Side[] = [];
  if (judgesDocument || minWidth !== undefined) {
    for (const [name, side] of sides) {
      const quality = side.document_quality ?? null;
      metadata[`${name}-document-blur-score`] = quality?.blur_score ?? null;
      metadata[`${name}-document-tenengrad`] = quality?.tenengrad ?? null;
      metadata[`${name}-document-width-px`] = quality?.width_px ?? null;
      if (quality === null) {
        continue;
      }
      if (
        (minDocumentBlur !== undefined && quality.blur_score < minDocumentBlur) ||
        (minTenengrad !== undefined && quality.tenengrad < minTenengrad)
      ) {
        (legible(side, quality) ? legibleSides : documentBlurry).push(name);
      }
      if (minWidth !== undefined && quality.width_px < minWidth) {
        lowResolution.push(name);
      }
    }
    metadata['document-blurry-sides'] = documentBlurry;
    metadata['legible-by-ocr-sides'] = legibleSides;
    metadata['low-resolution-sides'] = lowResolution;
  }
  const reasons = [
    ...(blurrySides.length > 0 || documentBlurry.length > 0 ? ['image_blurry'] : []),
    ...(lowResolution.length > 0 ? ['resolution_too_low'] : []),
  ];
  const judged = judgesDocument
    ? {
        'legible-text-min-confidence': minConfidence,
        'legible-text-min-lines': minLines,
        ...config,
      }
    : config;
  return checkResult(
    'id_blur_detection',
    reasons.length === 0 ? 'passed' : 'failed',
    reasons,
    metadata,
    { thresholds: thresholdsOf(judged, BLUR_KEYS) },
  );
}

/**
 * `id_glare_detection`: fails when glare covers too much of any analysed side: the whole image
 * (vision's verdict, or the raw ratio against a configured `max-glare-ratio`), or, with
 * `max-document-glare-ratio`, the text or portrait region of the rectified document.
 */
export function idGlareDetection(
  analysis: GovernmentIdAnalysisInput,
  config: CheckConfigInput = {},
): CheckResult {
  const sides = sidesOf(analysis);
  const maxGlare = numberOf(config, 'max-glare-ratio');
  const glareSides = sides
    .filter(([, side]) =>
      maxGlare === undefined ? side.quality.has_glare : side.quality.glare_ratio > maxGlare,
    )
    .map(([name]) => name);
  const metadata: Record<string, unknown> = {
    front_glare_ratio: analysis.sides.front.quality.glare_ratio,
    back_glare_ratio: analysis.sides.back?.quality.glare_ratio ?? null,
    glare_sides: glareSides,
  };
  const maxDocument = numberOf(config, 'max-document-glare-ratio');
  const documentSides: Side[] = [];
  if (maxDocument !== undefined) {
    for (const [name, side] of sides) {
      const text = side.document_quality?.glare_ratio_text ?? null;
      const portrait = side.document_quality?.glare_ratio_portrait ?? null;
      metadata[`${name}-glare-ratio-text`] = text;
      metadata[`${name}-glare-ratio-portrait`] = portrait;
      if ((text !== null && text > maxDocument) || (portrait !== null && portrait > maxDocument)) {
        documentSides.push(name);
      }
    }
    metadata['document-glare-sides'] = documentSides;
  }
  const failed = glareSides.length > 0 || documentSides.length > 0;
  return checkResult(
    'id_glare_detection',
    failed ? 'failed' : 'passed',
    failed ? ['glare_present'] : [],
    metadata,
    { thresholds: thresholdsOf(config, ['max-glare-ratio', 'max-document-glare-ratio']) },
  );
}

/**
 * `id_portrait_detection`: passes when the vision service found a portrait on the front.
 * Only the detector score is kept; the embedding never leaves the evaluation.
 */
export function idPortraitDetection(
  analysis: GovernmentIdAnalysisInput,
  models?: readonly CheckModel[],
): CheckResult {
  const { portrait, faces } = analysis.sides.front;
  const options = models === undefined ? {} : { models };
  if (portrait === null) {
    return checkResult(
      'id_portrait_detection',
      'failed',
      ['portrait_not_present'],
      { face_count: faces.length },
      options,
    );
  }
  return checkResult(
    'id_portrait_detection',
    'passed',
    [],
    { score: portrait.score, face_count: faces.length },
    options,
  );
}

export interface DoubleSideInput {
  /** Sides the flow step asks for. */
  requiredSides: IdSides;
  uploads: { front: UploadedImage | null; back: UploadedImage | null };
  /** The C32.1 analysis: the sides' pHashes and the back's MRZ and barcodes. */
  analysis?: GovernmentIdAnalysisInput | undefined;
  /** The feature row of the established class (C33), or `null` without one. */
  features?: DocumentFeatures | null | undefined;
  config?: CheckConfigInput | undefined;
}

const SIDES_BY_REQUIREMENT: Readonly<Record<IdSides, readonly Side[]>> = {
  front: ['front'],
  back: ['back'],
  both: ['front', 'back'],
};

/**
 * `id_double_side_detection`: every side the step requires must have been uploaded, and a
 * two-sided capture must hold two different sides.
 * - The same image twice, or (C32.2) a back whose pHash is within `min-front-back-phash-distance`
 *   bits of the front (a re-encoded front), counts as a missing back.
 * - When the established class has a feature row, its back must show the feature the class puts
 *   there: the MRZ of a TD1 card, the PDF417 of an AAMVA card (`back_feature_not_found`). Without
 *   a row the feature is not judged, and the metadata says so.
 * A single-sided step has nothing to compare (`not_requested`, C29.6); a one-sided class such as
 * a passport data page has no back (`feature_absent`). Neither blocks a decision.
 */
export function idDoubleSideDetection(input: DoubleSideInput): CheckResult {
  const { requiredSides, uploads, analysis, features, config = {} } = input;
  const thresholds = thresholdsOf(config, ['min-front-back-phash-distance']);
  const metadata: Record<string, unknown> = { required_sides: requiredSides };
  const result = (status: 'passed' | 'failed' | 'not_applicable', reasons: string[] = []) =>
    checkResult('id_double_side_detection', status, reasons, metadata, { thresholds });
  if (features?.sides === 1) {
    return result('not_applicable', ['feature_absent']);
  }
  const reasons = SIDES_BY_REQUIREMENT[requiredSides]
    .filter((side) => uploads[side] === null)
    .map((side) => `${side}_not_present`);
  if (reasons.length > 0) {
    return result('failed', reasons);
  }
  if (requiredSides !== 'both') {
    return result('not_applicable', ['not_requested']);
  }
  if (uploads.front?.sha256 === uploads.back?.sha256) {
    metadata.back_identical_to_front = true;
    return result('failed', ['back_not_present']);
  }
  if (analysis === undefined) {
    return result('passed');
  }
  const back = analysis.sides.back;
  const distance = phashDistance(analysis.sides.front.phash, back?.phash);
  const minDistance = numberOf(config, 'min-front-back-phash-distance');
  metadata['front-back-phash-distance'] = distance;
  if (distance !== null && minDistance !== undefined && distance < minDistance) {
    metadata['back-matches-front'] = 'phash';
    return result('failed', ['back_not_present']);
  }
  const feature =
    features?.mrzSide === 'back' ? 'mrz' : features?.pdf417Side === 'back' ? 'pdf417' : null;
  const found =
    feature === null
      ? null
      : feature === 'mrz'
        ? back?.mrz?.found === true
        : (back?.barcodes ?? []).some((barcode) => isPdf417(barcode.format));
  metadata['back-feature'] = feature;
  metadata['back-feature-found'] = found;
  return found === false ? result('failed', ['back_feature_not_found']) : result('passed');
}
