/**
 * The evaluator of every selfie check of PLAN §4.2 (C43): a function of the shared selfie
 * context. `evaluateSelfieChecks` runs the enabled ones.
 */
import type { CheckResult } from '@openverify/core';
import type { SelfieContext } from './context.js';
import { selfieImageQualityDetection } from './selfie-image-quality-detection.js';
import { selfieGlareDetection } from './selfie-glare-detection.js';
import { selfiePoseDetection } from './selfie-pose-detection.js';
import { selfieMultipleFacesDetection } from './selfie-multiple-faces-detection.js';
import { selfieLivenessDetection } from './selfie-liveness-detection.js';
import { selfiePoseRepeatDetection } from './selfie-pose-repeat-detection.js';
import { selfieIdComparison } from './selfie-id-comparison.js';
import { selfieAccountComparison } from './selfie-account-comparison.js';
import { selfieRepeatDetection } from './selfie-repeat-detection.js';
import { selfieSimilarBackgroundDetection } from './selfie-similar-background-detection.js';
import { selfieFaceCoveringDetection } from './selfie-face-covering-detection.js';
import { selfieGlassesDetection } from './selfie-glasses-detection.js';
import { selfieAgeComparison } from './selfie-age-comparison.js';
import { selfiePublicFigureDetection } from './selfie-public-figure-detection.js';
import { selfieSuspiciousEntityDetection } from './selfie-suspicious-entity-detection.js';

export type SelfieEvaluator = (context: SelfieContext) => CheckResult;

/** Every §4.2 check, by id. */
export const SELFIE_EVALUATORS = Object.freeze({
  selfie_image_quality_detection: selfieImageQualityDetection,
  selfie_glare_detection: selfieGlareDetection,
  selfie_pose_detection: selfiePoseDetection,
  selfie_multiple_faces_detection: selfieMultipleFacesDetection,
  selfie_liveness_detection: selfieLivenessDetection,
  selfie_pose_repeat_detection: selfiePoseRepeatDetection,
  selfie_id_comparison: selfieIdComparison,
  selfie_account_comparison: selfieAccountComparison,
  selfie_repeat_detection: selfieRepeatDetection,
  selfie_similar_background_detection: selfieSimilarBackgroundDetection,
  selfie_face_covering_detection: selfieFaceCoveringDetection,
  selfie_glasses_detection: selfieGlassesDetection,
  selfie_age_comparison: selfieAgeComparison,
  selfie_public_figure_detection: selfiePublicFigureDetection,
  selfie_suspicious_entity_detection: selfieSuspiciousEntityDetection,
}) satisfies Readonly<Record<string, SelfieEvaluator>>;
