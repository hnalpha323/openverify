/**
 * `id_unprocessable_submission_detection` (R, user behaviour, model-based): whether the submission
 * is an identity document that can be read at all (C32.1: the document outline, the OCR text and
 * the portrait).
 * - `document_not_found`: a side shows no document outline, MRZ or barcode.
 * - `insufficient_text`: the front has fewer than `min-text-lines` OCR lines read with confidence
 *   at least 0.5, and no side carries an MRZ or barcode.
 * - `identity_features_not_found`: no portrait on the front, and no MRZ or barcode anywhere.
 * Without the C32.1 document detection, or when no OCR model ran, the check has no evidence
 * (`input_missing`).
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import { checkConfigOf, modelsOf, type GovernmentIdContext } from './context.js';
import { numberOf, ocrRan, sidesOf, thresholdsOf } from './values.js';

const CHECK_ID = 'id_unprocessable_submission_detection';
/** OCR lines read with less confidence than this do not count as text. */
const MIN_LINE_CONFIDENCE = 0.5;

export function idUnprocessableSubmissionDetection(context: GovernmentIdContext): CheckResult {
  const { analysis } = context.input;
  const config = checkConfigOf(context, CHECK_ID);
  const thresholds = thresholdsOf(config, ['min-text-lines']);
  const models = modelsOf(context, ['faceDetector', 'textDetector', 'textRecognizer']);
  const options = { thresholds, ...(models === undefined ? {} : { models }) };
  const { front } = analysis.sides;
  if (front.document === undefined) {
    return checkResult(
      CHECK_ID,
      'not_applicable',
      ['input_missing'],
      { 'document-measured': false },
      options,
    );
  }
  if (!ocrRan(analysis)) {
    return checkResult(
      CHECK_ID,
      'not_applicable',
      ['input_missing'],
      { 'text-measured': false },
      options,
    );
  }
  const sides = sidesOf(analysis);
  const hasBarcode = sides.some(([, side]) => (side.barcodes ?? []).length > 0);
  const machineReadable = hasBarcode || sides.some(([, side]) => side.mrz?.found === true);
  const metadata: Record<string, unknown> = {};
  let documentMissing = false;
  for (const [name, side] of sides) {
    const shows =
      side.document?.found === true || side.mrz?.found === true || (side.barcodes ?? []).length > 0;
    metadata[`${name}-document-found`] = shows;
    documentMissing ||= !shows;
  }
  const textLines = (front.text ?? []).filter(
    (line) => line.confidence >= MIN_LINE_CONFIDENCE,
  ).length;
  const minLines = numberOf(config, 'min-text-lines') ?? 0;
  metadata['front-text-lines'] = textLines;
  metadata['machine-readable-zone'] = machineReadable;
  metadata['portrait-present'] = front.portrait !== null;
  const reasons = [
    ...(documentMissing ? ['document_not_found'] : []),
    ...(textLines < minLines && !machineReadable ? ['insufficient_text'] : []),
    ...(front.portrait === null && !machineReadable ? ['identity_features_not_found'] : []),
  ];
  return checkResult(
    CHECK_ID,
    reasons.length === 0 ? 'passed' : 'failed',
    reasons,
    metadata,
    options,
  );
}
