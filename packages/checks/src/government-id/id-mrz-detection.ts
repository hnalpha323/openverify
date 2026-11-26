/**
 * `id_mrz_detection` (R, user behaviour, model-based): the machine-readable zone was located and
 * read as a TD1, TD2, TD3, MRV-A or MRV-B MRZ (C31.1, C32.1).
 * - `passed`: an MRZ parsed (the C31.3 corrections it needed are named).
 * - `mrz_unreadable`: an MRZ was found but does not parse.
 * - `mrz_not_found`: the established class carries an MRZ (C33 feature table) and none was read.
 * - `feature_absent`: the established class has none (an AAMVA card); `not_requested`: it sits on
 *   a back the flow did not ask for; `input_missing`: no row, or no OCR model ran.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import { modelsOf, type GovernmentIdContext } from './context.js';
import { ocrRan, sideNotRequested } from './values.js';

const CHECK_ID = 'id_mrz_detection';

export function idMrzDetection(context: GovernmentIdContext): CheckResult {
  const models = modelsOf(context, ['textDetector', 'textRecognizer']);
  const options = models === undefined ? {} : { models };
  const result = (
    status: 'passed' | 'failed' | 'not_applicable',
    reasons: string[],
    metadata: Record<string, unknown> = {},
  ) => checkResult(CHECK_ID, status, reasons, metadata, options);
  const { mrz, mrzError } = context.extraction.sources;
  if (mrz !== null) {
    return result('passed', [], {
      format: mrz.parsed.format,
      side: mrz.side,
      'min-line-confidence': mrz.minLineConfidence,
      'corrected-fields': mrz.correctedFields,
      'mrz-corrections': mrz.parsed.corrections.map((correction) => correction.field),
    });
  }
  if (mrzError !== null) {
    return result('failed', ['mrz_unreadable'], {
      'mrz-error': mrzError.code,
      side: mrzError.side,
    });
  }
  const { features } = context;
  if (features?.mrz === false) {
    return result('not_applicable', ['feature_absent']);
  }
  const { analysis, requiredSides } = context.input;
  if (features?.mrz === true && sideNotRequested(analysis, requiredSides, features.mrzSide)) {
    return result('not_applicable', ['not_requested']);
  }
  if (features?.mrz !== true || !ocrRan(analysis)) {
    return result('not_applicable', ['input_missing']);
  }
  return result('failed', ['mrz_not_found']);
}
