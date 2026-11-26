/**
 * C99.7 (Workflow 7B): what decides a face or background list match. No number is new here, and none
 * was tuned: the face threshold and the candidate count are `LIST_MATCH_CONSTANTS`, provisional, and
 * the background limits are the Phase 4 defaults of `selfie_similar_background_detection`, provisional
 * too (research §8 measured them on a backdrop re-framed, not on a real population). Each carries
 * its basis in core.
 */
import { LIST_MATCH_CONSTANTS, SELFIE_CHECK_CONFIG_DEFAULTS } from '@openverify/core';

const number = (value: unknown): number => {
  if (typeof value !== 'number') {
    throw new TypeError('a list match constant is a number');
  }
  return value;
};

const listConstant = (key: string) => number(LIST_MATCH_CONSTANTS[key]?.value);
const background = SELFIE_CHECK_CONFIG_DEFAULTS.selfie_similar_background_detection;
const backgroundConstant = (key: string) => number(background?.[key]?.value);

/** Phase 4's repeat threshold: about 0.04 false matches per search over 10,000 templates. */
export const FACE_LIST_THRESHOLD = listConstant('face-list-threshold');
/** The nearest layouts confirmed through `/v1/compare/background`, at most five (C41.2). */
export const BACKGROUND_LIST_CANDIDATES = listConstant('background-candidates');
/** A background needs both to count as the same room. */
export const BACKGROUND_MIN_INLIERS = backgroundConstant('min-orb-inliers');
export const BACKGROUND_MIN_INLIER_RATIO = backgroundConstant('min-inlier-ratio');
/** Below it the person hides the room: no list item, and a probe too coarse to say anything. */
export const BACKGROUND_MIN_COVERAGE = backgroundConstant('min-coverage');
/** The decrypted cache's bounds (P08, F39). */
export const BIOMETRIC_CACHE_BYTES = listConstant('biometric-cache-bytes');
export const BIOMETRIC_CACHE_IDLE_MS = listConstant('biometric-cache-idle-minutes') * 60_000;
