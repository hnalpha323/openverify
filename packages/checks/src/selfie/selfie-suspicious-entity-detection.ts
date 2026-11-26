/**
 * `selfie_suspicious_entity_detection` (H/A, fraud, C43): a synthetic, deepfake or composited
 * face.
 * - **With a provider bound** (C44), its answer: flagged fails (`provider_flagged`), its score in
 *   [0, 1] the confidence; a failed provider: `execution_error`.
 * - **Otherwise the heuristic fusion** of the centre's synthetic cues (`syntheticFaceScore`),
 *   advisory: a fused score above `max-synthetic-face-score` fails (`synthetic_face_suspected`).
 *   Its confidence, for a failure and for a pass, is capped at {@link HEURISTIC_CONFIDENCE_CAP}:
 *   its detection rate is unmeasured and not being flagged is no evidence of authenticity. Without
 *   a centre face or any measured cue: `input_missing`.
 * - **Either way**, an upload whose XMP digital source type is `trainedAlgorithmicMedia` or
 *   `compositeSynthetic` fails outright (`provenance_marks_synthetic`, confidence 1: the file
 *   declares its synthetic origin, which nobody forges against themselves); any other type is
 *   recorded.
 */
import type { CheckResult } from '@openverify/core';
import { heuristicConfidence } from '../government-id/heuristic.js';
import { checkResult } from '../result.js';
import {
  numberIn,
  poseAnalysisOf,
  selfieCheckConfig,
  selfieModelsOf,
  selfieResultOptions,
  type SelfieContext,
} from './context.js';
import {
  SYNTHETIC_DIGITAL_SOURCE_TYPES,
  digitalSourceTermOf,
  syntheticFaceScore,
} from './synthetic-score.js';
import { clamp01, round4 } from './values.js';

const CHECK_ID = 'selfie_suspicious_entity_detection';
const KEY = 'max-synthetic-face-score';
const REASONS = ['synthetic_face_suspected', 'provenance_marks_synthetic', 'provider_flagged'];

/** C43: the heuristic fusion's confidence stays at or below this. */
export const HEURISTIC_CONFIDENCE_CAP = 0.5;

export function selfieSuspiciousEntityDetection(context: SelfieContext): CheckResult {
  const config = selfieCheckConfig(context.template, CHECK_ID);
  const models = selfieModelsOf(context, ['faceDetector']);
  const options = selfieResultOptions(config, [KEY], models === undefined ? {} : { models });
  const center = poseAnalysisOf(context, 'center');
  const term = digitalSourceTermOf(center?.synthetic?.digital_source_type ?? null);
  const provenanceMarks = term !== null && SYNTHETIC_DIGITAL_SOURCE_TYPES.includes(term);
  const recorded = term === null ? {} : { 'digital-source-type': term };
  const outcome = context.input.providers?.suspiciousEntity;
  const ordered = (reasons: readonly string[]) =>
    REASONS.filter((reason) => reasons.includes(reason));

  if (outcome?.kind === 'result') {
    const { flagged, score } = outcome.result;
    const providerScore = round4(clamp01(score));
    const metadata = { method: 'provider', 'provider-score': providerScore, ...recorded };
    const reasons = [
      ...(provenanceMarks ? ['provenance_marks_synthetic'] : []),
      ...(flagged ? ['provider_flagged'] : []),
    ];
    const providerOptions = { ...options, provider: outcome.provider };
    return reasons.length > 0
      ? checkResult(CHECK_ID, 'failed', ordered(reasons), metadata, {
          ...providerOptions,
          confidence: Math.max(provenanceMarks ? 1 : 0, flagged ? providerScore : 0),
        })
      : checkResult(CHECK_ID, 'passed', [], metadata, {
          ...providerOptions,
          confidence: round4(1 - providerScore),
        });
  }
  if (outcome?.kind === 'error' && !provenanceMarks) {
    return checkResult(CHECK_ID, 'not_applicable', ['execution_error'], recorded, options);
  }

  const threshold = numberIn(config, KEY) ?? HEURISTIC_CONFIDENCE_CAP;
  const fused =
    center?.face == null || center.synthetic == null
      ? null
      : syntheticFaceScore(center.synthetic, { upload: context.capture?.method === 'upload' });
  const metadata = {
    method: 'heuristic',
    ...(fused === null
      ? {}
      : { score: fused.score, components: fused.components, coverage: fused.coverage }),
    ...recorded,
  };
  const suspected = fused !== null && fused.score > threshold;
  const capped = (score: number, coverage: number) =>
    Math.min(HEURISTIC_CONFIDENCE_CAP, heuristicConfidence(score, threshold, coverage));
  if (suspected || provenanceMarks) {
    const reasons = [
      ...(suspected ? ['synthetic_face_suspected'] : []),
      ...(provenanceMarks ? ['provenance_marks_synthetic'] : []),
    ];
    return checkResult(CHECK_ID, 'failed', ordered(reasons), metadata, {
      ...options,
      confidence: provenanceMarks || fused === null ? 1 : capped(fused.score, fused.coverage),
    });
  }
  if (fused === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], metadata, options);
  }
  return checkResult(CHECK_ID, 'passed', [], metadata, {
    ...options,
    confidence: capped(fused.score, fused.coverage),
  });
}
