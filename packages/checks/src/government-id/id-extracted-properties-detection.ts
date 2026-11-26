/**
 * `id_extracted_properties_detection` (R, user behaviour, model-based): the C31 extraction holds
 * every field of `required-fields` (C29.5). An established class without an expiry date (C33)
 * does not need `expiration-date`. Missing fields fail with `required_fields_missing`, named in
 * `missing-fields` (a retake can read them). With `missing-fields-outcome: review` (Phase 12A C6),
 * they answer `not_applicable` with the same reason and metadata instead: that reason blocks the
 * decision without failing it, so the verification goes to manual review (C30.1) rather than
 * failing the inquiry over a field OCR could not read. When no OCR model ran and no barcode was
 * read, the extraction could not be attempted, so the check has no evidence (`input_missing`).
 *
 * A holder with a single name (ICAO 9303 Part 3) has it as the primary identifier and no
 * secondary one: a check-digit-valid MRZ whose name field shows exactly that, with room left so
 * nothing was cut, states there is no first name, so `name-first` is not missing unless another
 * source read one (`single-name: true`; Workflow 3B review, G008).
 */
import type { CheckResult } from '@openverify/core';
import type { MrzSource } from '../extraction/extract.js';
import { checkResult } from '../result.js';
import { checkConfigOf, modelsOf, type GovernmentIdContext } from './context.js';
import { listOf, ocrRan } from './values.js';

const CHECK_ID = 'id_extracted_properties_detection';

/** The MRZ states a single name: a primary identifier, no secondary one, nothing cut. */
function statesSingleName(mrz: MrzSource | null): boolean {
  if (mrz === null) {
    return false;
  }
  const { parsed } = mrz;
  return (
    parsed.checkDigitsValid &&
    parsed.surname !== '' &&
    parsed.givenNames === '' &&
    !parsed.nameTruncated
  );
}

export function idExtractedPropertiesDetection(context: GovernmentIdContext): CheckResult {
  const config = checkConfigOf(context, CHECK_ID);
  const configured = listOf(config, 'required-fields') ?? [];
  const required = configured.filter(
    (field) => !(field === 'expiration-date' && context.features?.expiry === false),
  );
  const outcome = config['missing-fields-outcome'] === 'review' ? 'review' : 'fail';
  const models = modelsOf(context, ['textDetector', 'textRecognizer']);
  const options = {
    thresholds: { 'required-fields': [...configured], 'missing-fields-outcome': outcome },
    ...(models === undefined ? {} : { models }),
  };
  const { extraction } = context;
  if (!ocrRan(context.input.analysis) && extraction.sources.barcode === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const fields = extraction.consolidated.fields as Readonly<Record<string, string | null>>;
  const singleName =
    required.includes('name-first') &&
    fields['name-first'] == null &&
    statesSingleName(extraction.sources.mrz);
  const missing = required.filter(
    (field) => fields[field] == null && !(field === 'name-first' && singleName),
  );
  const missingStatus = outcome === 'review' ? 'not_applicable' : 'failed';
  return checkResult(
    CHECK_ID,
    missing.length === 0 ? 'passed' : missingStatus,
    missing.length === 0 ? [] : ['required_fields_missing'],
    {
      'required-fields': required,
      'missing-fields': missing,
      ...(singleName ? { 'single-name': true } : {}),
    },
    options,
  );
}
