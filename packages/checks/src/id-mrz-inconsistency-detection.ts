import type { CheckResult, ExtractionField } from '@openverify/core';
import { normalizeCountryCode } from './country-codes.js';
import type { DocumentFeatures } from './data/feature-table.js';
import { isoDateToMrz } from './dates.js';
import { confusableEqual, namesAgree } from './extraction/agreement.js';
import { mrzCorrectedFields } from './extraction/extract.js';
import { MrzParseError, parseMrz, type MrzCheckDigits, type ParsedMrz } from './mrz.js';
import { checkResult, presentText } from './result.js';

const CHECK_ID = 'id_mrz_inconsistency_detection';

/** Fields read from the visual inspection zone (the printed, human-readable part). */
export interface VizFields {
  documentNumber?: string | null | undefined;
  surname?: string | null | undefined;
  givenNames?: string | null | undefined;
  /** `YYYY-MM-DD`. */
  birthDate?: string | null | undefined;
  /** `YYYY-MM-DD`. */
  expirationDate?: string | null | undefined;
  /** `M`, `F` or `X` (also `male`, `female`, `unspecified`). */
  sex?: string | null | undefined;
  /** ISO alpha-2/alpha-3 or ICAO code. */
  nationality?: string | null | undefined;
  /** ISO alpha-2/alpha-3 or ICAO code. */
  issuingState?: string | null | undefined;
}

export interface IdMrzInconsistencyInput {
  /** MRZ lines, or one newline-separated string. */
  mrz?: string | readonly string[] | null | undefined;
  viz?: VizFields | undefined;
  /** The feature row of the established class (C33), or `null` without one. */
  features?: DocumentFeatures | null | undefined;
  /** The MRZ sits on a side the flow did not ask for. */
  mrzNotRequested?: boolean | undefined;
}

const CHECK_DIGIT_REASONS: Readonly<Record<keyof MrzCheckDigits, string>> = {
  documentNumber: 'document_number',
  birthDate: 'birth_date',
  expirationDate: 'expiration_date',
  optionalData: 'optional_data',
  composite: 'composite',
};

/** C31.4: agreement with the printed card needs two of these read by both. */
const AGREEMENT_FIELDS = new Set(['document_number', 'birth_date', 'expiration_date', 'surname']);
const MIN_AGREEMENT_FIELDS = 2;

/** The comparison each corrected C31.5 field needs for its correction to count (C31.3). */
const CONFIRMED_BY: Readonly<Partial<Record<ExtractionField, string>>> = {
  'identification-number': 'document_number',
  birthdate: 'birth_date',
  'expiration-date': 'expiration_date',
  'name-last': 'surname',
  'name-first': 'given_names',
  nationality: 'nationality',
  'issuing-authority-code': 'issuing_state',
  sex: 'sex',
};

/**
 * The MRZ name equals the visual-zone name token for token under the C31.2 rules, or, when the
 * MRZ name field was full, is a truncation of it (components cut short or dropped).
 */
function namesMatch(mrzName: string, vizName: string, truncated: boolean): boolean {
  if (namesAgree(mrzName, vizName)) {
    return true;
  }
  if (!truncated) {
    return false;
  }
  const mrzTokens = mrzName.split(' ').filter(Boolean);
  const vizTokens = vizName
    .toUpperCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .split(/[^A-Z]+/)
    .filter(Boolean);
  return (
    mrzTokens.length <= vizTokens.length &&
    mrzTokens.every((token, index) => vizTokens[index]?.startsWith(token) === true)
  );
}

function datesMatch(mrzDate: string, vizDate: string): boolean {
  const viz = isoDateToMrz(vizDate);
  if (viz === null) {
    return false;
  }
  // MRZ dates are six ASCII characters; filler positions are unknown and skipped.
  for (let index = 0; index < mrzDate.length; index += 1) {
    const char = mrzDate.charAt(index);
    if (char !== '<' && char !== viz.charAt(index)) {
      return false;
    }
  }
  return true;
}

function normalizeSex(value: string): string | null {
  const upper = value.toUpperCase();
  if (upper === 'M' || upper === 'MALE') {
    return 'M';
  }
  if (upper === 'F' || upper === 'FEMALE') {
    return 'F';
  }
  return upper === 'X' || upper === '<' || upper === 'UNSPECIFIED' ? 'X' : null;
}

function countriesMatch(mrzCode: string, vizCode: string): boolean {
  const viz = normalizeCountryCode(vizCode);
  return viz !== null && viz === normalizeCountryCode(mrzCode);
}

type Comparison = readonly [
  field: string,
  value: string | null,
  matches: (value: string) => boolean,
];

function comparisons(parsed: ParsedMrz, viz: VizFields): Comparison[] {
  return [
    [
      'document_number',
      presentText(viz.documentNumber),
      (value) =>
        confusableEqual(
          value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
          parsed.documentNumber.replace(/</g, ''),
        ),
    ],
    [
      'surname',
      presentText(viz.surname),
      (value) => namesMatch(parsed.surname, value, parsed.nameTruncated),
    ],
    [
      'given_names',
      presentText(viz.givenNames),
      (value) => namesMatch(parsed.givenNames, value, parsed.nameTruncated),
    ],
    ['birth_date', presentText(viz.birthDate), (value) => datesMatch(parsed.birthDate, value)],
    [
      'expiration_date',
      presentText(viz.expirationDate),
      (value) => datesMatch(parsed.expirationDate, value),
    ],
    [
      'sex',
      presentText(viz.sex),
      (value) => parsed.sex !== null && normalizeSex(value) === parsed.sex,
    ],
    [
      'nationality',
      presentText(viz.nationality),
      (value) => countriesMatch(parsed.nationality, value),
    ],
    [
      'issuing_state',
      presentText(viz.issuingState),
      (value) => countriesMatch(parsed.issuingState, value),
    ],
  ];
}

function readMrz(input: IdMrzInconsistencyInput): ParsedMrz | CheckResult {
  const { mrz } = input;
  const lines = typeof mrz === 'string' ? [mrz] : (mrz ?? []);
  if (!lines.some((line) => line.trim() !== '')) {
    if (input.features?.mrz === false) {
      return checkResult(CHECK_ID, 'not_applicable', ['feature_absent']);
    }
    return checkResult(CHECK_ID, 'not_applicable', [
      input.mrzNotRequested === true ? 'not_requested' : 'input_missing',
    ]);
  }
  try {
    return parseMrz(mrz ?? [], { correct: true });
  } catch (error) {
    if (!(error instanceof MrzParseError)) {
      throw error;
    }
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], { error: error.code });
  }
}

/**
 * `id_mrz_inconsistency_detection`: ICAO 9303 check digits, MRZ field format, and agreement
 * between the MRZ and the visual zone for every VIZ field given (the C31.2 rules).
 *
 * - Any check-digit, format or agreement failure fails the check.
 * - Agreement with the printed card needs two of the document number, birth date, expiry and
 *   surname read by both (C31.4): valid check digits alone do not show it, so with fewer the
 *   check answers `input_missing`.
 * - The MRZ is read with the C31.3 corrections; a corrected field counts only when the visual zone
 *   agrees with it, so an unconfirmed correction also answers `input_missing`.
 * - Without an MRZ: `feature_absent` for an established class that has none (C29.6),
 *   `not_requested` when it sits on a side the flow did not ask for, otherwise `input_missing`;
 *   an MRZ that cannot be read is `id_mrz_detection`'s to report (`input_missing` here).
 *
 * Results carry only field names and validity flags, never document values.
 */
export function idMrzInconsistencyDetection(input: IdMrzInconsistencyInput): CheckResult {
  const parsed = readMrz(input);
  if (!('format' in parsed)) {
    return parsed;
  }

  const reasons: string[] = [];
  const checkDigits: Record<string, boolean> = {};
  for (const [field, reason] of Object.entries(CHECK_DIGIT_REASONS) as [
    keyof MrzCheckDigits,
    string,
  ][]) {
    const digit = parsed.checkDigits[field];
    if (digit) {
      checkDigits[field] = digit.valid;
      if (!digit.valid) {
        reasons.push(`${reason}_check_digit_invalid`);
      }
    }
  }
  reasons.push(...parsed.formatIssues.map((issue) => `mrz_${issue}`));

  const comparedFields: string[] = [];
  const mismatchedFields: string[] = [];
  for (const [field, value, matches] of comparisons(parsed, input.viz ?? {})) {
    if (value !== null) {
      comparedFields.push(field);
      if (!matches(value)) {
        mismatchedFields.push(field);
        reasons.push(`${field}_mismatch`);
      }
    }
  }

  const correctedFields = mrzCorrectedFields(parsed);
  const unconfirmed = correctedFields.filter((field) => {
    const comparison = CONFIRMED_BY[field];
    return comparison === undefined || !comparedFields.includes(comparison);
  });
  const agreementFields = comparedFields.filter((field) => AGREEMENT_FIELDS.has(field)).length;
  const metadata = {
    format: parsed.format,
    checkDigits,
    comparedFields,
    mismatchedFields,
    'agreement-fields': agreementFields,
    'corrected-fields': correctedFields,
    'unconfirmed-corrections': unconfirmed,
  };
  if (reasons.length > 0) {
    return checkResult(CHECK_ID, 'failed', reasons, metadata);
  }
  if (unconfirmed.length > 0 || agreementFields < MIN_AGREEMENT_FIELDS) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], metadata);
  }
  return checkResult(CHECK_ID, 'passed', [], metadata);
}
