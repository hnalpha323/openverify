/**
 * `selfie_account_comparison` (R, fraud, model-based, C43, C42.8): the centre face against the
 * sealed templates of the account's other inquiries, by SFace cosine at the shared 1:1
 * `threshold`. The best cosine below it: `face_mismatch`. Needs the matching consent
 * (`not_consented`, C42.3); no earlier template: `no_reference_data`; no centre face or no lookup:
 * `input_missing`; a failed lookup: `execution_error`.
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

const CHECK_ID = 'selfie_account_comparison';

export function selfieAccountComparison(context: SelfieContext): CheckResult {
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
  const account = context.input.history?.account;
  if (poseAnalysisOf(context, 'center')?.face == null || account === undefined) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  if (account.kind === 'error') {
    return checkResult(CHECK_ID, 'not_applicable', ['execution_error'], {}, options);
  }
  const metadata = {
    'templates-compared': account.templates,
    'best-cosine': account.bestCosine === null ? null : round4(account.bestCosine),
  };
  if (account.templates === 0 || account.bestCosine === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['no_reference_data'], metadata, options);
  }
  const threshold = numberIn(config, 'threshold') ?? FACE_MATCH_DEFAULTS.threshold;
  const confidence = faceMatchConfidence(account.bestCosine, threshold);
  return account.bestCosine >= threshold
    ? checkResult(CHECK_ID, 'passed', [], metadata, { ...options, confidence })
    : checkResult(CHECK_ID, 'failed', ['face_mismatch'], metadata, { ...options, confidence });
}
