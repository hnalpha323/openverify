/**
 * `database_po_box_detection` (R, user behaviour; C59.3): flags an entered street address that is a
 * PO box, an APO/FPO address or a mail-receiving agency, by the patterns `id_po_box_detection`
 * uses. `not_requested` (non-blocking) when the step collects no street.
 */
import type { CheckResult } from '@openverify/core';
import { PO_BOX_PATTERNS, normalizeAddress } from '../id-po-box-detection.js';
import { MATCHING_INPUT_LIMITS, capText } from '../matching/limits.js';
import { checkResult, presentText } from '../result.js';
import type { DatabaseContext } from './context.js';

const ID = 'database_po_box_detection';

export function databasePoBoxDetection(context: DatabaseContext): CheckResult {
  const { values, collectedFields } = context.input;
  if (values === null) {
    return checkResult(ID, 'not_applicable', ['input_missing']);
  }
  if (
    !collectedFields.includes('address_street_1') &&
    !collectedFields.includes('address_street_2')
  ) {
    return checkResult(ID, 'not_applicable', ['not_requested']);
  }
  const lines = [values['address-street-1'], values['address-street-2']].flatMap((line) => {
    const text = presentText(line);
    return text === null ? [] : [capText(text, MATCHING_INPUT_LIMITS.address)];
  });
  if (lines.length === 0) {
    return checkResult(ID, 'not_applicable', ['input_missing']);
  }
  const address = normalizeAddress(lines);
  const matched = [
    ...new Set(PO_BOX_PATTERNS.filter(([, pattern]) => pattern.test(address)).map(([id]) => id)),
  ];
  return matched.length > 0
    ? checkResult(ID, 'failed', ['po_box_detected'], { 'matched-patterns': matched })
    : checkResult(ID, 'passed', [], { 'matched-patterns': [] });
}
