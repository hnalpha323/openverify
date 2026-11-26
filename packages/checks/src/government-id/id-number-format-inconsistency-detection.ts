/**
 * `id_number_format_inconsistency_detection` (R, fraud): the identification numbers fit the
 * grammars of the issuer the document established (C33):
 * - an AAMVA card: its US jurisdiction's driver licence number formats (`us-dl-<state>`), and for
 *   Quebec (Phase 12A C11) the shape of its licence number, one letter and twelve digits
 *   (`ca-dl-qc`). The Quebec grammar checks the shape only: the number's construction (from the
 *   holder's name and birth date) and any check digit are not published, so none is verified;
 * - an MRZ document: the ICAO 9303 document number rules for its format (`icao-9303`), and any
 *   national checksum of the issuer whose shape the document or personal number has (for example
 *   `es-dni` on a Spanish personal number).
 * A number a grammar refuses fails (`number_format_invalid`, the field named in
 * `invalid-fields`). Without an established issuer, a number, or a grammar that applies (a
 * territory or another Canadian card), the check has no evidence (`input_missing`). A printed
 * `QUEBEC` alone does not establish the issuer (C30.2), so a card read from its front only has
 * none.
 */
import type { CheckResult, ExtractionField } from '@openverify/core';
import { icaoDocumentNumberValid, type IcaoDocumentFormat } from '../data/icao-document-number.js';
import { nationalIdRulesFor } from '../data/national-id-checksums.js';
import { usDriverLicenseNumberValid } from '../data/us-dl-formats.js';
import { checkResult } from '../result.js';
import type { GovernmentIdContext } from './context.js';

const CHECK_ID = 'id_number_format_inconsistency_detection';
const MRZ_FORMATS: ReadonlySet<string> = new Set(['TD1', 'TD2', 'TD3', 'MRVA', 'MRVB']);
/** A Quebec driver licence number, compact: one letter and twelve digits (shape only, no checksum). */
const QUEBEC_DL_NUMBER = /^[A-Z]\d{12}$/;

interface Judgement {
  grammar: string;
  field: ExtractionField;
  valid: boolean;
}

function judgements(context: GovernmentIdContext): Judgement[] {
  const { document, consolidated } = context.extraction;
  const { issuer } = document;
  const number = consolidated.fields['identification-number'];
  const personal = consolidated.fields['personal-number'];
  if (issuer === null) {
    return [];
  }
  if (issuer.scheme === 'aamva') {
    if (issuer.country === 'CA' && issuer.jurisdiction === 'QC') {
      return number === null
        ? []
        : [
            {
              grammar: 'ca-dl-qc',
              field: 'identification-number',
              valid: QUEBEC_DL_NUMBER.test(number.toUpperCase()),
            },
          ];
    }
    const valid =
      number === null || issuer.country !== 'US' || issuer.jurisdiction === null
        ? null
        : usDriverLicenseNumberValid(issuer.jurisdiction, number);
    return valid === null
      ? []
      : [
          {
            grammar: `us-dl-${(issuer.jurisdiction ?? '').toLowerCase()}`,
            field: 'identification-number',
            valid,
          },
        ];
  }
  const found: Judgement[] = [];
  if (number !== null) {
    const format = (
      document.layout !== null && MRZ_FORMATS.has(document.layout) ? document.layout : 'TD1'
    ) as IcaoDocumentFormat;
    found.push({
      grammar: 'icao-9303',
      field: 'identification-number',
      valid: icaoDocumentNumberValid(number.toUpperCase(), format),
    });
  }
  for (const rule of nationalIdRulesFor(issuer.code)) {
    const value = rule.field === 'personal-number' ? personal : number;
    if (value !== null && rule.shape.test(rule.normalize(value))) {
      found.push({ grammar: rule.id, field: rule.field, valid: rule.isValid(value) });
    }
  }
  return found;
}

export function idNumberFormatInconsistencyDetection(context: GovernmentIdContext): CheckResult {
  const found = judgements(context);
  if (found.length === 0) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing']);
  }
  const invalid = [...new Set(found.filter((entry) => !entry.valid).map((entry) => entry.field))];
  const metadata = {
    grammars: [...new Set(found.map((entry) => entry.grammar))],
    fields: [...new Set(found.map((entry) => entry.field))],
    'invalid-fields': invalid,
  };
  return invalid.length > 0
    ? checkResult(CHECK_ID, 'failed', ['number_format_invalid'], metadata)
    : checkResult(CHECK_ID, 'passed', [], metadata);
}
