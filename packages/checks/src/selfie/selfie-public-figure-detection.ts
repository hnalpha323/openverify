/**
 * `selfie_public_figure_detection` (A, fraud, C43, C44): a public-figure gallery provider's match
 * on the centre image (`public_figure_match`), labelled with the provider. No provider:
 * `provider_not_configured`; a failed one: `execution_error`; no centre face: `input_missing`. The
 * provider's score is kept, never its raw response.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import { poseAnalysisOf, selfieModelsOf, type SelfieContext } from './context.js';
import { clamp01, round4 } from './values.js';

const CHECK_ID = 'selfie_public_figure_detection';

export function selfiePublicFigureDetection(context: SelfieContext): CheckResult {
  const models = selfieModelsOf(context, ['faceDetector']);
  const options = models === undefined ? {} : { models };
  const outcome = context.input.providers?.selfiePublicFigure;
  if (outcome === undefined || outcome.kind === 'not_configured') {
    return checkResult(CHECK_ID, 'not_applicable', ['provider_not_configured'], {}, options);
  }
  if (outcome.kind === 'error') {
    return checkResult(CHECK_ID, 'not_applicable', ['execution_error'], {}, options);
  }
  const providerOptions = { ...options, provider: outcome.provider };
  if (poseAnalysisOf(context, 'center')?.face == null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, providerOptions);
  }
  const metadata = { 'provider-score': round4(clamp01(outcome.result.score)) };
  return outcome.result.match
    ? checkResult(CHECK_ID, 'failed', ['public_figure_match'], metadata, providerOptions)
    : checkResult(CHECK_ID, 'passed', [], metadata, providerOptions);
}
