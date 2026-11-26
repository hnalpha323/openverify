/**
 * `id_barcode_inconsistency_detection` (R, fraud): the AAMVA payload is sound (Annex D header,
 * listed IIN, known version, subfile designators, mandatory elements, dates) and agrees with the
 * front of the card under the C31.2 rules.
 * - Every parser error or issue is a reason (`aamva_*`); a disagreement with the visual zone is
 *   `barcode_viz_mismatch`, the fields named in `disagreeing-fields`.
 * - Agreement needs two of the document number, birth date, expiry and surname read by both
 *   (C31.4); with fewer, a sound payload answers `input_missing`.
 * - Without an AAMVA payload: `feature_absent`, `not_requested` or `input_missing`, as for
 *   `id_barcode_detection`.
 */
import { EXTRACTION_FIELDS, type CheckResult, type ExtractionField } from '@openverify/core';
import { fieldsAgree, fieldsComparable } from '../extraction/agreement.js';
import { checkResult } from '../result.js';
import type { GovernmentIdContext } from './context.js';
import { sideNotRequested } from './values.js';

const CHECK_ID = 'id_barcode_inconsistency_detection';
const AGREEMENT_FIELDS: ReadonlySet<ExtractionField> = new Set([
  'identification-number',
  'birthdate',
  'expiration-date',
  'name-last',
]);
const MIN_AGREEMENT_FIELDS = 2;

export function idBarcodeInconsistencyDetection(context: GovernmentIdContext): CheckResult {
  const { barcode, barcodeError, viz } = context.extraction.sources;
  if (barcode === null) {
    if (barcodeError !== null) {
      return checkResult(CHECK_ID, 'failed', [barcodeError.code], { side: barcodeError.side });
    }
    const { features } = context;
    const { analysis, requiredSides } = context.input;
    if (features?.pdf417 === false) {
      return checkResult(CHECK_ID, 'not_applicable', ['feature_absent']);
    }
    return checkResult(CHECK_ID, 'not_applicable', [
      features?.pdf417 === true && sideNotRequested(analysis, requiredSides, features.pdf417Side)
        ? 'not_requested'
        : 'input_missing',
    ]);
  }
  const reasons = [...new Set(barcode.parsed.issues.map((issue) => issue.code))] as string[];
  const compared: ExtractionField[] = [];
  const disagreeing: ExtractionField[] = [];
  for (const field of EXTRACTION_FIELDS) {
    const left = barcode.fields[field];
    const right = viz?.fields[field];
    // An IIN and a country code the front prints are not the same value (G004).
    if (left !== undefined && right !== undefined && fieldsComparable(field, left, right)) {
      compared.push(field);
      if (!fieldsAgree(field, left, right)) {
        disagreeing.push(field);
      }
    }
  }
  if (disagreeing.length > 0) {
    reasons.push('barcode_viz_mismatch');
  }
  const agreementFields = compared.filter((field) => AGREEMENT_FIELDS.has(field)).length;
  const metadata = {
    side: barcode.side,
    'aamva-version': barcode.parsed.header.aamvaVersion,
    'compared-fields': compared,
    'disagreeing-fields': disagreeing,
    'agreement-fields': agreementFields,
  };
  if (reasons.length > 0) {
    return checkResult(CHECK_ID, 'failed', reasons, metadata);
  }
  return agreementFields < MIN_AGREEMENT_FIELDS
    ? checkResult(CHECK_ID, 'not_applicable', ['input_missing'], metadata)
    : checkResult(CHECK_ID, 'passed', [], metadata);
}
