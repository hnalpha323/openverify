/**
 * `selfie_id_comparison` (v2, R, fraud, model-based, C43): the centre face against the portrait of
 * the latest government ID verification of the inquiry that is `passed`, `submitted` or
 * `needs_review` (`SelfieIdReferenceInput`), by SFace cosine at the shared 1:1 `threshold`
 * (`FACE_MATCH_DEFAULTS`). Below it: `face_mismatch`.
 *
 * Without a centre face: `input_missing`. Without such an ID, or with one without a portrait:
 * `not_applicable`/`no_reference_data` (Phase 1 answered `failed`), `metadata.reference` naming
 * what is missing (`government_id` or `portrait`). When embedding the stored ID failed:
 * `execution_error`. Metadata keeps the similarity and the deprecated Phase 1 `confidence` and
 * `confidence_stage`; embeddings never enter the result.
 * @throws {InvalidFaceEmbeddingError} for a malformed embedding.
 */
import { FACE_MATCH_DEFAULTS, type CheckResult } from '@openverify/core';
import { faceMatch, faceMatchConfidence } from '../face-match.js';
import { checkResult } from '../result.js';
import {
  poseAnalysisOf,
  selfieCheckConfig,
  selfieModelsOf,
  selfieResultOptions,
  type SelfieCheckConfig,
  type SelfieContext,
} from './context.js';
import type { SelfieIdReferenceInput } from './inputs.js';
import { round4 } from './values.js';

const CHECK_ID = 'selfie_id_comparison';

/**
 * The effective 1:1 face-match threshold of a selfie evaluation: the template's
 * `selfie_id_comparison` threshold, else the worker's Phase 1 `faceMatchThreshold`, else
 * `FACE_MATCH_DEFAULTS`. A threshold that is not the default's value has no basis.
 */
export function oneToOneFaceThreshold(context: SelfieContext): SelfieCheckConfig {
  const config = selfieCheckConfig(context.template, CHECK_ID);
  const fallback = context.input.faceMatchThreshold;
  if (fallback === undefined || config.basis.threshold === undefined) {
    return config;
  }
  return fallback === FACE_MATCH_DEFAULTS.threshold
    ? config
    : { values: { ...config.values, threshold: fallback }, basis: {} };
}

/** The reference of the evaluation: `idReference`, else the Phase 1 `idPortrait`. */
function referenceOf(context: SelfieContext): SelfieIdReferenceInput {
  const { idReference, idPortrait } = context.input;
  if (idReference !== undefined) {
    return idReference;
  }
  // The Phase 1 input cannot say whether the ID or only its portrait is missing.
  return idPortrait == null
    ? { kind: 'missing', missing: 'portrait' }
    : {
        kind: 'portrait',
        verificationId: idPortrait.verificationId,
        embedding: idPortrait.embedding,
      };
}

export function selfieIdComparison(context: SelfieContext): CheckResult {
  const config = oneToOneFaceThreshold(context);
  const models = selfieModelsOf(context, ['faceDetector', 'faceRecognizer']);
  const options = selfieResultOptions(
    config,
    ['threshold'],
    models === undefined ? {} : { models },
  );
  const threshold =
    (config.values.threshold as number | undefined) ?? FACE_MATCH_DEFAULTS.threshold;
  const face = poseAnalysisOf(context, 'center')?.face ?? null;
  if (face === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const reference = referenceOf(context);
  if (reference.kind === 'error') {
    return checkResult(CHECK_ID, 'not_applicable', ['execution_error'], {}, options);
  }
  if (reference.kind === 'missing') {
    return checkResult(
      CHECK_ID,
      'not_applicable',
      ['no_reference_data'],
      { reference: reference.missing },
      options,
    );
  }
  const match = faceMatch(face.embedding, reference.embedding, { threshold });
  const confidence = faceMatchConfidence(match.similarity, match.threshold);
  const metadata = {
    similarity: round4(match.similarity),
    threshold: match.threshold,
    confidence,
    confidence_stage: 'beta',
    id_verification_id: reference.verificationId,
  };
  return match.match
    ? checkResult(CHECK_ID, 'passed', [], metadata, { ...options, confidence })
    : checkResult(CHECK_ID, 'failed', ['face_mismatch'], metadata, { ...options, confidence });
}
