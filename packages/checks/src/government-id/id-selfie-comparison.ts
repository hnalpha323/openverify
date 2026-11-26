/**
 * `id_selfie_comparison` (v2, R, fraud, model-based): the ID portrait against the inquiry's
 * latest selfie that is `passed`, `submitted` or `needs_review` (the worker selects it, C43;
 * `SelfieFace`), by SFace cosine similarity at `threshold` (C34), the shared
 * `FACE_MATCH_DEFAULTS` unless the template sets one; the default's basis is recorded (C39.3).
 * Without a selfie (the default flow takes the ID first), its face or the portrait,
 * `input_missing`: `selfie_id_comparison` covers the pair from the selfie's side. Embeddings never
 * enter the result.
 * @throws {InvalidFaceEmbeddingError} for a malformed embedding.
 */
import { FACE_MATCH_DEFAULTS, type CheckResult } from '@openverify/core';
import { faceMatch, faceMatchConfidence } from '../face-match.js';
import { checkResult } from '../result.js';
import { checkConfigOf, modelsOf, type GovernmentIdContext } from './context.js';
import { numberOf } from './values.js';

const CHECK_ID = 'id_selfie_comparison';
const DEFAULT_THRESHOLD = FACE_MATCH_DEFAULTS.threshold;

export function idSelfieComparison(context: GovernmentIdContext): CheckResult {
  const threshold = numberOf(checkConfigOf(context, CHECK_ID), 'threshold') ?? DEFAULT_THRESHOLD;
  const models = modelsOf(context, ['faceDetector', 'faceRecognizer']);
  const configured = context.template.checks[CHECK_ID]?.config?.threshold !== undefined;
  const options = {
    thresholds: { threshold },
    ...(configured ? {} : { thresholdBasis: { threshold: FACE_MATCH_DEFAULTS.basis } }),
    ...(models === undefined ? {} : { models }),
  };
  const { selfie } = context.input;
  const portrait = context.input.analysis.sides.front.portrait;
  if (selfie?.face == null || portrait === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const match = faceMatch(selfie.face.embedding, portrait.embedding, { threshold });
  const confidence = faceMatchConfidence(match.similarity, match.threshold);
  const metadata = {
    similarity: Math.round(match.similarity * 10_000) / 10_000,
    'selfie-verification-id': selfie.verificationId,
  };
  return match.match
    ? checkResult(CHECK_ID, 'passed', [], metadata, { ...options, confidence })
    : checkResult(CHECK_ID, 'failed', ['face_mismatch'], metadata, { ...options, confidence });
}
