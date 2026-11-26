/**
 * `id_public_figure_detection` (A, fraud, model-based): the ID portrait against an
 * operator-supplied gallery of public figures, through a provider (C35). Phase 3 ships no gallery
 * (it needs stored embeddings, a Phase 4 and Phase 7 decision), only the port and the sandbox.
 * No provider: `provider_not_configured`; a failed one: `execution_error`; no portrait:
 * `input_missing`; an empty gallery: `no_reference_data`; a match fails (`public_figure_match`).
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import { modelsOf, type GovernmentIdContext } from './context.js';
import { isCheckResult, providerResult } from './provider.js';

const CHECK_ID = 'id_public_figure_detection';

export function idPublicFigureDetection(context: GovernmentIdContext): CheckResult {
  const outcome = providerResult(CHECK_ID, context.input.providers?.publicFigure);
  if (isCheckResult(outcome)) {
    return outcome;
  }
  const models = modelsOf(context, ['faceRecognizer']);
  const options = { provider: outcome.provider, ...(models === undefined ? {} : { models }) };
  if (context.input.analysis.sides.front.portrait === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  switch (outcome.result.outcome) {
    case 'gallery_empty':
      return checkResult(CHECK_ID, 'not_applicable', ['no_reference_data'], {}, options);
    case 'match':
      return checkResult(CHECK_ID, 'failed', ['public_figure_match'], {}, options);
    case 'no_match':
      return checkResult(CHECK_ID, 'passed', [], {}, options);
  }
}
