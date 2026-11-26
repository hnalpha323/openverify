/**
 * `id_compromised_detection` (R, fraud): the document is a specimen, test data or on a
 * compromised list.
 * - `specimen_marker_found`: a frozen C33 marker (SPECIMEN, MUSTER, NOT A REAL DOCUMENT, …) in
 *   the OCR text outside the extracted field values and the MRZ lines, so a holder named Sample is
 *   not flagged;
 * - `specimen_document_number`: the document number of a published ICAO 9303 example;
 * - `specimen_issuer`: the specimen state Utopia (`UTO`) in a production environment (C30.7);
 * - `synthetic_test_data`: an AAMVA payload marked as OpenVerify synthetic test data, in
 *   production (plan amendment, checks-logic);
 * - `compromised_list_match`: a list opted in with `use-for-compromised-ids` holds the number, the
 *   one place a list match can fail anything (C99.9, P13): exact, on the operator's own data, and
 *   the check's requirement stays the operator's.
 * When such a list could not be read and nothing else fails, the check answers `not_applicable`
 * with `compromised_list_unavailable`, never `passed`: a required check then goes to review
 * (ADR 0002 §3b). Without OCR text to scan (no OCR model ran, or nothing was read), and no hard
 * signal above, the check has no evidence (`input_missing`).
 */
import type { CheckResult } from '@openverify/core';
import { SANDBOX_TEST_ISSUER } from '../data/feature-table.js';
import { isSpecimenDocumentNumber, specimenMarkersIn } from '../data/specimen-markers.js';
import { checkResult } from '../result.js';
import type { GovernmentIdContext } from './context.js';
import { ocrRan, sidesOf } from './values.js';

const CHECK_ID = 'id_compromised_detection';
const MRZ_LINE = /^[A-Z0-9<]{20,}$/;

export function idCompromisedDetection(context: GovernmentIdContext): CheckResult {
  const { analysis } = context.input;
  const { extraction, environment } = context;
  const valueLines = new Set(
    Object.values(extraction.sources.viz?.readings ?? {}).map(
      (reading) => `${reading.side}:${String(reading.lineIndex)}`,
    ),
  );
  const scanned = sidesOf(analysis).flatMap(([side, entry]) =>
    (entry.text ?? []).filter(
      (line, index) =>
        !valueLines.has(`${side}:${String(index)}`) &&
        !(MRZ_LINE.test(line.text.trim()) && line.text.includes('<')),
    ),
  );
  const markers = [...new Set(scanned.flatMap((line) => specimenMarkersIn(line.text)))];
  const numbers = [
    extraction.consolidated.fields['identification-number'],
    extraction.sources.mrz?.parsed.documentNumber ?? null,
  ];
  const production = environment === 'production';
  const reasons = [
    ...(markers.length > 0 ? ['specimen_marker_found'] : []),
    ...(numbers.some((number) => number !== null && isSpecimenDocumentNumber(number))
      ? ['specimen_document_number']
      : []),
    ...(production && extraction.document.issuer?.code === SANDBOX_TEST_ISSUER
      ? ['specimen_issuer']
      : []),
    ...(production && extraction.sources.barcode?.parsed.syntheticMarker === true
      ? ['synthetic_test_data']
      : []),
    ...(context.input.compromisedList?.matched === true ? ['compromised_list_match'] : []),
  ];
  const lists = context.input.compromisedList;
  const metadata = {
    markers,
    'text-lines-scanned': scanned.length,
    ...(lists === undefined
      ? {}
      : {
          'compromised-lists-screened': [...(lists.screened ?? [])],
          'compromised-lists-unscreened': [...lists.unscreened],
        }),
  };
  if (reasons.length > 0) {
    return checkResult(CHECK_ID, 'failed', reasons, metadata);
  }
  if (lists !== undefined && lists.unscreened.length > 0) {
    return checkResult(CHECK_ID, 'not_applicable', ['compromised_list_unavailable'], metadata);
  }
  return !ocrRan(analysis) || scanned.length + valueLines.size === 0
    ? checkResult(CHECK_ID, 'not_applicable', ['input_missing'], metadata)
    : checkResult(CHECK_ID, 'passed', [], metadata);
}
