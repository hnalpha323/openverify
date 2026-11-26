/**
 * `id_nfc_mrz_comparison` (R, fraud, C62.6): DG1 (exact, no OCR fixes) against the latest
 * government ID MRZ reading of the same document code and issuer; this ties the chip to the
 * photographed booklet. Another document's reading gives `no_reference_data`; no government ID
 * step in the pinned flow gives `not_requested` (non-blocking). The document number, birth date,
 * expiry, name and nationality are compared: exactly, or with OCR confusables folded when the
 * printed MRZ's check digits failed or are unknown. Judged on DG1's integrity (C62.4).
 *
 * The issuer selects the reading, so a different issuer is never compared as `issuer_mismatch`:
 * it is another document. Metadata names fields, never their values.
 */
import type { CheckResult, IdClass } from '@openverify/core';
import { normalizeCountryCode } from '../country-codes.js';
import { MrzParseError, parseMrz, type ParsedMrz } from '../mrz.js';
import { checkResult } from '../result.js';
import type { NfcContext } from './context.js';
import type { NfcMrzReference } from './inputs.js';
import { dataGroupIntegrity, onIntegrity } from './integrity.js';

const CHECK_ID = 'id_nfc_mrz_comparison';

interface Confusables {
  readonly pattern: RegExp;
  readonly map: Readonly<Record<string, string>>;
}

/** C31.3 confusables: a letter where a digit is expected, and the reverse. */
const TO_DIGIT: Confusables = {
  pattern: /[BIOSZ]/g,
  map: { O: '0', I: '1', S: '5', B: '8', Z: '2' },
};
const TO_LETTER: Confusables = {
  pattern: /[01258]/g,
  map: { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z' },
};

type Compared = 'identification-number' | 'birthdate' | 'expiration-date' | 'name' | 'nationality';

const REASONS: Readonly<Record<Compared, string>> = {
  'identification-number': 'document_number_mismatch',
  birthdate: 'birthdate_mismatch',
  'expiration-date': 'expiration_date_mismatch',
  name: 'name_mismatch',
  nationality: 'nationality_mismatch',
};

/** Upper case, accents dropped, every run of non-alphanumerics (MRZ fillers too) one space. */
function plain(value: string): string {
  return value
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function fold(value: string, { pattern, map }: Confusables, tolerate: boolean): string {
  return tolerate ? value.replaceAll(pattern, (character) => map[character] ?? character) : value;
}

/** `YYYY-MM-DD` as the MRZ writes it (`YYMMDD`), `null` for anything else. */
function mrzDateOf(value: string | null | undefined): string | null {
  const match =
    value === null || value === undefined ? null : /^\d{2}(\d{2})-(\d{2})-(\d{2})$/.exec(value);
  return match === null ? null : `${match[1] ?? ''}${match[2] ?? ''}${match[3] ?? ''}`;
}

/** The document category a code or class stands for: a passport, a visa, or a card. */
function categoryOfCode(code: string): 'passport' | 'visa' | 'card' {
  return code.startsWith('P') ? 'passport' : code.startsWith('V') ? 'visa' : 'card';
}

function categoryOfClass(idClass: IdClass): 'passport' | 'visa' | 'card' {
  return idClass === 'passport' ? 'passport' : idClass === 'visa' ? 'visa' : 'card';
}

/** Whether the reading is of the same document code and issuer as the chip (C62.6). */
function sameDocument(reference: NfcMrzReference, chip: ParsedMrz, tolerate: boolean): boolean {
  const issuer = reference.fields['issuing-authority-code'];
  if (issuer === null || issuer === undefined) {
    return false;
  }
  const printed = normalizeCountryCode(fold(issuer.toUpperCase(), TO_LETTER, tolerate));
  return (
    printed !== null &&
    printed === normalizeCountryCode(chip.issuingState) &&
    (reference.idClass === null ||
      categoryOfClass(reference.idClass) === categoryOfCode(chip.documentCode))
  );
}

interface Comparison {
  readonly compared: Compared[];
  readonly mismatched: Compared[];
}

function compare(reference: NfcMrzReference, chip: ParsedMrz, tolerate: boolean): Comparison {
  const { fields } = reference;
  const digits = (value: string) => fold(plain(value).replaceAll(' ', ''), TO_DIGIT, tolerate);
  const letters = (value: string) => fold(plain(value), TO_LETTER, tolerate);
  const pairs: [Compared, string | null, string | null][] = [
    [
      'identification-number',
      fields['identification-number'] ? digits(fields['identification-number']) : null,
      digits(chip.documentNumber),
    ],
    ['birthdate', mrzDateOf(fields.birthdate), digits(chip.birthDate)],
    ['expiration-date', mrzDateOf(fields['expiration-date']), digits(chip.expirationDate)],
  ];
  const compared: Compared[] = [];
  const mismatched: Compared[] = [];
  for (const [field, printed, read] of pairs) {
    if (printed !== null && printed !== '') {
      compared.push(field);
      if (fold(printed, TO_DIGIT, tolerate) !== read) {
        mismatched.push(field);
      }
    }
  }
  const last = fields['name-last'];
  const first = fields['name-first'];
  if ((last ?? '') !== '' || (first ?? '') !== '') {
    compared.push('name');
    const printedName = letters(`${last ?? ''} ${first ?? ''}`);
    const chipName = letters(`${chip.surname} ${chip.givenNames}`);
    const agrees =
      printedName === chipName || (chip.nameTruncated && printedName.startsWith(chipName));
    if (!agrees) {
      mismatched.push('name');
    }
  }
  const nationality = fields.nationality;
  if (nationality !== null && nationality !== undefined && nationality !== '') {
    compared.push('nationality');
    if (normalizeCountryCode(letters(nationality)) !== normalizeCountryCode(chip.nationality)) {
      mismatched.push('nationality');
    }
  }
  return { compared, mismatched };
}

export function idNfcMrzComparison(context: NfcContext): CheckResult {
  const { input } = context;
  if (!input.governmentIdStep) {
    return checkResult(CHECK_ID, 'not_applicable', ['not_requested']);
  }
  const integrity = dataGroupIntegrity(input.passiveAuthentication, 1);
  if (integrity === 'broken') {
    const verdict = onIntegrity(integrity, { status: 'not_applicable', reasons: [] });
    return checkResult(CHECK_ID, verdict.status, verdict.reasons, { integrity });
  }
  let chip: ParsedMrz;
  try {
    if (input.dg1 === null) {
      return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], { integrity });
    }
    chip = parseMrz(input.dg1.mrzLines);
  } catch (error) {
    if (error instanceof MrzParseError) {
      return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], { integrity });
    }
    throw error;
  }
  const reference = input.mrzReferences.find((candidate) =>
    sameDocument(candidate, chip, candidate.checkDigitsValid !== true),
  );
  if (reference === undefined) {
    return checkResult(CHECK_ID, 'not_applicable', ['no_reference_data'], { integrity });
  }
  const tolerate = reference.checkDigitsValid !== true;
  const { compared, mismatched } = compare(reference, chip, tolerate);
  const metadata = {
    integrity,
    'compared-fields': compared,
    'mismatched-fields': mismatched,
    'confusables-tolerated': tolerate,
    'government-id-verification-id': reference.verificationId,
  };
  if (compared.length === 0) {
    return checkResult(CHECK_ID, 'not_applicable', ['no_reference_data'], metadata);
  }
  const verdict = onIntegrity(
    integrity,
    mismatched.length === 0
      ? { status: 'passed', reasons: [] }
      : { status: 'failed', reasons: mismatched.map((field) => REASONS[field]) },
  );
  return checkResult(CHECK_ID, verdict.status, verdict.reasons, metadata);
}
