/**
 * `id_barcode_detection` (R, user behaviour): a PDF417 barcode was located and decoded
 * (zxing-cpp, C32.1). A decoded PDF417 passes whether or not it is AAMVA; whether its payload is
 * sound is `id_barcode_inconsistency_detection`'s. Without one: `barcode_not_found` when the
 * established class carries a PDF417 (C33), `feature_absent` when it has none, `not_requested`
 * when it sits on a back the flow did not ask for, `input_missing` without a row or without
 * barcode decoding (a Phase 1 analysis).
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import type { GovernmentIdContext } from './context.js';
import { isPdf417, sideNotRequested, sidesOf } from './values.js';

const CHECK_ID = 'id_barcode_detection';

export function idBarcodeDetection(context: GovernmentIdContext): CheckResult {
  const { analysis, requiredSides } = context.input;
  const sides = sidesOf(analysis);
  const { barcode } = context.extraction.sources;
  if (barcode !== null) {
    return checkResult(CHECK_ID, 'passed', [], { side: barcode.side, aamva: true });
  }
  const decoded = sides.find(([, side]) =>
    (side.barcodes ?? []).some((candidate) => isPdf417(candidate.format)),
  );
  if (decoded !== undefined) {
    return checkResult(CHECK_ID, 'passed', [], { side: decoded[0], aamva: false });
  }
  const { features } = context;
  if (features?.pdf417 === false) {
    return checkResult(CHECK_ID, 'not_applicable', ['feature_absent']);
  }
  if (features?.pdf417 === true && sideNotRequested(analysis, requiredSides, features.pdf417Side)) {
    return checkResult(CHECK_ID, 'not_applicable', ['not_requested']);
  }
  const measured = sides.some(([, side]) => side.barcodes !== undefined);
  return features?.pdf417 === true && measured
    ? checkResult(CHECK_ID, 'failed', ['barcode_not_found'])
    : checkResult(CHECK_ID, 'not_applicable', ['input_missing']);
}
