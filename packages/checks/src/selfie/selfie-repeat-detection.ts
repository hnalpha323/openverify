/**
 * `selfie_repeat_detection` (R, fraud, model-based, C43, C42.4): the C42.4 1:N scan of the
 * environment's sealed templates of other accounts. Any template at or above the 1:N `threshold`
 * (never below the 1:1 one; false matches grow with the gallery, so it is advisory by default):
 * `face_seen_on_other_account`. Metadata records the number searched, whether the
 * `face-search-max-templates` cap truncated the scan, the match count and the best cosine. An
 * empty gallery passes: the scan ran over every stored template. Needs the matching consent
 * (`not_consented`); no centre face or no scan: `input_missing`; a failed scan: `execution_error`.
 */
import { FACE_MATCH_DEFAULTS, type CheckResult } from '@openverify/core';
import { faceMatchConfidence } from '../face-match.js';
import { checkResult } from '../result.js';
import {
  numberIn,
  poseAnalysisOf,
  selfieCheckConfig,
  selfieModelsOf,
  selfieResultOptions,
  type SelfieContext,
} from './context.js';
import { round4 } from './values.js';

const CHECK_ID = 'selfie_repeat_detection';

/**
 * The lowest cosine the C42.4 scan reports in `matchCosines`: the floor of the repeat threshold's
 * schema (a 1:N threshold is never below the 1:1 one), so any configured threshold can be applied.
 */
export const FACE_SCAN_FLOOR = FACE_MATCH_DEFAULTS.threshold;

export function selfieRepeatDetection(context: SelfieContext): CheckResult {
  const config = selfieCheckConfig(context.template, CHECK_ID);
  const models = selfieModelsOf(context, ['faceDetector', 'faceRecognizer']);
  const options = selfieResultOptions(
    config,
    ['threshold'],
    models === undefined ? {} : { models },
  );
  if (context.input.matchingConsent !== true) {
    return checkResult(CHECK_ID, 'not_applicable', ['not_consented'], {}, options);
  }
  const scan = context.input.history?.repeat;
  if (poseAnalysisOf(context, 'center')?.face == null || scan === undefined) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  if (scan.kind === 'error') {
    return checkResult(CHECK_ID, 'not_applicable', ['execution_error'], {}, options);
  }
  const threshold = numberIn(config, 'threshold') ?? FACE_SCAN_FLOOR;
  const cosines = [...(scan.bestCosine === null ? [] : [scan.bestCosine]), ...scan.matchCosines];
  const best = cosines.length === 0 ? null : Math.max(...cosines);
  const matches = scan.matchCosines.filter((cosine) => cosine >= threshold).length;
  const metadata = {
    searched: scan.searched,
    truncated: scan.truncated,
    'match-count': matches,
    'best-cosine': best === null ? null : round4(best),
  };
  const confidence = best === null ? null : faceMatchConfidence(best, threshold);
  return matches > 0
    ? checkResult(CHECK_ID, 'failed', ['face_seen_on_other_account'], metadata, {
        ...options,
        confidence,
      })
    : checkResult(CHECK_ID, 'passed', [], metadata, { ...options, confidence });
}
