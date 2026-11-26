/**
 * ICAO Doc 9303 machine-readable zone parsing for TD1 (3x30), TD2 (2x36) and
 * TD3 (2x44) documents and MRV-A (2x44) and MRV-B (2x36) visas, with per-field
 * and composite check-digit validation, and the limited OCR correction of C31.3.
 *
 * Implemented in-house rather than with the `mrz` npm package: ICAO 9303-5
 * §4.2.4 excludes the position-15 filler from a long document number's check
 * digit, and the package also accepts the variant that includes it. Owning the
 * parser also leaves room for MRV visa layouts, which the package lacks.
 */
import { DomainError } from '@openverify/core';
import { isIcaoIssuerCode } from './country-codes.js';
import { SANDBOX_TEST_ISSUER } from './data/feature-table.js';

export type MrzFormat = 'TD1' | 'TD2' | 'TD3' | 'MRVA' | 'MRVB';

export type MrzParseErrorCode =
  'mrz_unrecognized_format' | 'mrz_invalid_characters' | 'mrz_unsupported_format';

/** Structural problems that make an MRZ unreadable. Messages never echo MRZ content. */
export class MrzParseError extends DomainError {
  declare readonly code: MrzParseErrorCode;
}

/** Field values that violate ICAO 9303 even though the MRZ could be read. */
export type MrzFormatIssue =
  | 'document_code_invalid'
  | 'issuing_state_invalid'
  | 'nationality_invalid'
  | 'birth_date_invalid'
  | 'expiration_date_invalid'
  | 'sex_invalid'
  | 'name_invalid';

export interface MrzCheckDigit {
  /** Character printed in the check-digit position. */
  value: string;
  /** Check digit computed from the field. */
  expected: number;
  valid: boolean;
}

export interface MrzCheckDigits {
  documentNumber: MrzCheckDigit;
  birthDate: MrzCheckDigit;
  expirationDate: MrzCheckDigit;
  /** TD3 personal number / optional data check digit; `null` for TD1 and TD2. */
  optionalData: MrzCheckDigit | null;
  /** `null` for visas, which have none. */
  composite: MrzCheckDigit | null;
}

/** An MRZ field, as named in OCR corrections (C31.3). */
export type MrzField =
  | 'document_code'
  | 'issuing_state'
  | 'name'
  | 'document_number'
  | 'document_number_check_digit'
  | 'nationality'
  | 'birth_date'
  | 'birth_date_check_digit'
  | 'sex'
  | 'expiration_date'
  | 'expiration_date_check_digit'
  | 'optional_data'
  | 'optional_data_check_digit'
  | 'composite_check_digit';

/** One character the parser corrected because the format forbids it at its position (C31.3). */
export interface MrzCorrection {
  /** 0-based line and position. */
  line: number;
  position: number;
  field: MrzField;
  from: string;
  to: string;
}

export interface ParseMrzOptions {
  /** Apply the C31.3 corrections; off by default. */
  correct?: boolean;
}

export interface ParsedMrz {
  format: MrzFormat;
  lines: readonly string[];
  /** Document code with fillers removed, e.g. `P`, `I`, `AC`. */
  documentCode: string;
  /** Issuing state or organisation code with fillers removed (`D` for Germany). */
  issuingState: string;
  surname: string;
  givenNames: string;
  /** The name filled its whole field, so ICAO says to assume it was truncated. */
  nameTruncated: boolean;
  /** Full document number, including any characters continued in the optional data. */
  documentNumber: string;
  documentNumberOverflow: boolean;
  nationality: string;
  /** `YYMMDD`; unknown parts may be fillers, e.g. `7408<<`. */
  birthDate: string;
  /** `X` for unspecified (filler in the MRZ); `null` when the field is invalid. */
  sex: 'M' | 'F' | 'X' | null;
  /** `YYMMDD`. */
  expirationDate: string;
  /** TD1 upper-line optional data, TD2 optional data or TD3 personal number. */
  optionalData1: string;
  /** TD1 middle-line optional data; `null` for TD2 and TD3. */
  optionalData2: string | null;
  checkDigits: MrzCheckDigits;
  checkDigitsValid: boolean;
  formatIssues: MrzFormatIssue[];
  /** Every check digit is valid and no field violates the format. */
  valid: boolean;
  /** The C31.3 corrections applied, in line and position order; empty without `correct`. */
  corrections: readonly MrzCorrection[];
}

const WEIGHTS = [7, 3, 1] as const;

/** C31.3 confusables: a letter where the format needs a digit, and the reverse. */
const TO_DIGIT: Readonly<Record<string, string>> = { O: '0', I: '1', S: '5', B: '8', Z: '2' };
const TO_LETTER: Readonly<Record<string, string>> = {
  '0': 'O',
  '1': 'I',
  '5': 'S',
  '8': 'B',
  '2': 'Z',
};
const MRZ_LINE = /^[A-Z0-9<]+$/;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function charValue(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 48 && code <= 57) {
    return code - 48;
  }
  if (code >= 65 && code <= 90) {
    return code - 55;
  }
  if (char === '<') {
    return 0;
  }
  throw new MrzParseError(
    'mrz_invalid_characters',
    'MRZ contains a character outside A-Z, 0-9 and the filler <',
  );
}

/** ICAO 9303-3 check digit: weights 7, 3, 1; digits as-is, A-Z as 10-35, filler as 0. */
export function computeMrzCheckDigit(input: string): number {
  let sum = 0;
  // UTF-16 code units are fine here: any non-ASCII unit is rejected by charValue.
  for (let index = 0; index < input.length; index += 1) {
    sum += charValue(input.charAt(index)) * (WEIGHTS[index % 3] ?? 1);
  }
  return sum % 10;
}

function checkDigit(field: string, printed: string): MrzCheckDigit {
  const expected = computeMrzCheckDigit(field);
  return {
    value: printed,
    expected,
    valid: /^[0-9]$/.test(printed) && Number(printed) === expected,
  };
}

function stripTrailingFillers(value: string): string {
  return value.replace(/<+$/, '');
}

function toLines(input: string | readonly string[]): string[] {
  const raw = typeof input === 'string' ? input.split(/\r?\n/) : input;
  return raw.map((line) => line.trim()).filter((line) => line.length > 0);
}

function detectFormat(lines: readonly string[]): MrzFormat {
  const lengths = new Set(lines.map((line) => line.length));
  const [length] = lengths;
  if (lengths.size === 1 && lines.length === 3 && length === 30) {
    return 'TD1';
  }
  if (lengths.size === 1 && lines.length === 2 && (length === 36 || length === 44)) {
    const first = lines[0] ?? '';
    if (first.startsWith('V')) {
      return length === 36 ? 'MRVB' : 'MRVA';
    }
    if (length === 36 && first.startsWith('IDFRA')) {
      throw new MrzParseError(
        'mrz_unsupported_format',
        'The pre-2021 French national ID layout is not an ICAO TD2 MRZ',
      );
    }
    return length === 36 ? 'TD2' : 'TD3';
  }
  throw new MrzParseError(
    'mrz_unrecognized_format',
    'Expected 3 lines of 30 (TD1), 2 lines of 36 (TD2, MRV-B) or 2 lines of 44 (TD3, MRV-A) characters',
  );
}

interface DocumentNumber {
  documentNumber: string;
  overflow: boolean;
  checkDigit: MrzCheckDigit;
  optionalRest: string;
}

/**
 * Reads the document number. A filler in the check-digit position followed by
 * optional data marks a long number (TD1/TD2): the remaining characters and
 * then the check digit open the optional data field, and the check digit
 * covers the full number without the filler.
 */
function readDocumentNumber(
  principal: string,
  printedDigit: string,
  optional: string,
  allowOverflow: boolean,
): DocumentNumber {
  if (allowOverflow && printedDigit === '<' && optional.length > 0 && !optional.startsWith('<')) {
    const filler = optional.indexOf('<');
    const end = filler === -1 ? optional.length : filler;
    const fullNumber = principal + optional.slice(0, end - 1);
    return {
      documentNumber: stripTrailingFillers(fullNumber),
      overflow: true,
      checkDigit: checkDigit(fullNumber, optional.charAt(end - 1)),
      optionalRest: optional.slice(end + 1),
    };
  }
  return {
    documentNumber: stripTrailingFillers(principal),
    overflow: false,
    checkDigit: checkDigit(principal, printedDigit),
    optionalRest: optional,
  };
}

function parseName(field: string): { surname: string; givenNames: string; truncated: boolean } {
  const separator = field.indexOf('<<');
  const primary = separator === -1 ? field : field.slice(0, separator);
  const secondary = separator === -1 ? '' : field.slice(separator + 2);
  const words = (part: string): string => part.split('<').filter(Boolean).join(' ');
  return { surname: words(primary), givenNames: words(secondary), truncated: /[A-Z]$/.test(field) };
}

/**
 * A YYMMDD date of the MRZ, a part of a birth date possibly unknown (`<<`). 29 February needs a
 * year that is a leap year in some century, `YY % 4 = 0` (Workflow 3B review, G006); with an
 * unknown year it stays possible.
 */
function isValidDate(raw: string, allowUnknownParts: boolean): boolean {
  const pairs = [raw.slice(0, 2), raw.slice(2, 4), raw.slice(4, 6)];
  const [year = '', month = '', day = ''] = pairs;
  if (!pairs.every((pair) => /^[0-9]{2}$/.test(pair) || (allowUnknownParts && pair === '<<'))) {
    return false;
  }
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (month !== '<<' && (monthNumber < 1 || monthNumber > 12)) {
    return false;
  }
  if (day === '<<') {
    return true;
  }
  const maxDay = month === '<<' ? 31 : (DAYS_IN_MONTH[monthNumber - 1] ?? 31);
  const neverLeap = monthNumber === 2 && year !== '<<' && Number(year) % 4 !== 0;
  return dayNumber >= 1 && dayNumber <= (neverLeap ? 28 : maxDay);
}

function isValidDocumentCode(format: MrzFormat, code: string): boolean {
  const [first = '', second = ''] = code;
  if (!/^[A-Z<]$/.test(second)) {
    return false;
  }
  if (format === 'TD3') {
    return first === 'P';
  }
  if (format === 'MRVA' || format === 'MRVB') {
    return first === 'V';
  }
  return 'ACI'.includes(first) && second !== 'V' && code !== 'AI';
}

const STATE_CODE = /^[A-Z]{1,3}<*$/;

/**
 * A state code of the MRZ (issuing state or nationality): an ISO alpha-3 or ICAO 9303 Part 3 §5
 * code (`D` for Germany), padded with fillers, or the specimen state Utopia (`UTO`), the sandbox
 * test issuer, which `id_compromised_detection` refuses in production (C30.7). A made-up code is
 * a format issue (Workflow 3B review, G005).
 */
function isValidStateCode(field: string): boolean {
  if (!STATE_CODE.test(field)) {
    return false;
  }
  const code = stripTrailingFillers(field);
  return code === SANDBOX_TEST_ISSUER || isIcaoIssuerCode(code);
}

interface Layout {
  format: MrzFormat;
  documentCode: string;
  issuingState: string;
  nameField: string;
  documentNumberField: string;
  documentNumberDigit: string;
  /** Optional data that may continue a long document number. */
  optionalData: string;
  allowOverflow: boolean;
  nationality: string;
  birthDate: string;
  birthDateDigit: string;
  sex: string;
  expirationDate: string;
  expirationDateDigit: string;
  optionalData2: string | null;
  /** TD3 only: the personal number check digit. */
  optionalDataDigit: string | null;
  /** `null` for visas. */
  compositeField: string | null;
  compositeDigit: string | null;
}

function layout(format: MrzFormat, lines: readonly string[]): Layout {
  const [l1 = '', l2 = '', l3 = ''] = lines;
  if (format === 'TD1') {
    return {
      format,
      documentCode: l1.slice(0, 2),
      issuingState: l1.slice(2, 5),
      documentNumberField: l1.slice(5, 14),
      documentNumberDigit: l1.charAt(14),
      optionalData: l1.slice(15, 30),
      allowOverflow: true,
      birthDate: l2.slice(0, 6),
      birthDateDigit: l2.charAt(6),
      sex: l2.charAt(7),
      expirationDate: l2.slice(8, 14),
      expirationDateDigit: l2.charAt(14),
      nationality: l2.slice(15, 18),
      optionalData2: l2.slice(18, 29),
      optionalDataDigit: null,
      compositeField: l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29),
      compositeDigit: l2.charAt(29),
      nameField: l3,
    };
  }
  const td3 = format === 'TD3';
  const visa = format === 'MRVA' || format === 'MRVB';
  const lineLength = l2.length;
  // TD3: optional data to 42, its digit, the composite. TD2: optional data to 35, the composite.
  // Visas: optional data to the end, no composite.
  const optionalEnd = visa ? lineLength : td3 ? 42 : 35;
  const compositeEnd = td3 ? 43 : optionalEnd;
  return {
    format,
    documentCode: l1.slice(0, 2),
    issuingState: l1.slice(2, 5),
    nameField: l1.slice(5),
    documentNumberField: l2.slice(0, 9),
    documentNumberDigit: l2.charAt(9),
    nationality: l2.slice(10, 13),
    birthDate: l2.slice(13, 19),
    birthDateDigit: l2.charAt(19),
    sex: l2.charAt(20),
    expirationDate: l2.slice(21, 27),
    expirationDateDigit: l2.charAt(27),
    optionalData: l2.slice(28, optionalEnd),
    allowOverflow: format === 'TD2',
    optionalData2: null,
    optionalDataDigit: td3 ? l2.charAt(42) : null,
    compositeField: visa ? null : l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, compositeEnd),
    compositeDigit: visa ? null : l2.charAt(compositeEnd),
  };
}

/** A field's span on one line, and the characters its format allows: digits or letters. */
interface FieldSpan {
  field: MrzField;
  line: number;
  start: number;
  end: number;
  kind: 'digits' | 'letters';
}

const span = (
  field: MrzField,
  line: number,
  start: number,
  end: number,
  kind: FieldSpan['kind'],
): FieldSpan => ({ field, line, start, end, kind });

/**
 * The fields whose characters are all digits (or fillers) or all letters (or fillers), so a
 * character of the other kind is impossible there (C31.3). The document number, the optional data
 * and the sex field are not listed: the first two allow both kinds, and no confusable maps to M,
 * F or X.
 */
function correctableSpans(format: MrzFormat, lines: readonly string[]): FieldSpan[] {
  if (format === 'TD1') {
    return [
      span('document_code', 0, 0, 2, 'letters'),
      span('issuing_state', 0, 2, 5, 'letters'),
      span('document_number_check_digit', 0, 14, 15, 'digits'),
      span('birth_date', 1, 0, 6, 'digits'),
      span('birth_date_check_digit', 1, 6, 7, 'digits'),
      span('expiration_date', 1, 8, 14, 'digits'),
      span('expiration_date_check_digit', 1, 14, 15, 'digits'),
      span('nationality', 1, 15, 18, 'letters'),
      span('composite_check_digit', 1, 29, 30, 'digits'),
      span('name', 2, 0, 30, 'letters'),
    ];
  }
  const length = lines[0]?.length ?? 0;
  const spans = [
    span('document_code', 0, 0, 2, 'letters'),
    span('issuing_state', 0, 2, 5, 'letters'),
    span('name', 0, 5, length, 'letters'),
    span('document_number_check_digit', 1, 9, 10, 'digits'),
    span('nationality', 1, 10, 13, 'letters'),
    span('birth_date', 1, 13, 19, 'digits'),
    span('birth_date_check_digit', 1, 19, 20, 'digits'),
    span('expiration_date', 1, 21, 27, 'digits'),
    span('expiration_date_check_digit', 1, 27, 28, 'digits'),
  ];
  if (format === 'TD3') {
    spans.push(span('optional_data_check_digit', 1, 42, 43, 'digits'));
    spans.push(span('composite_check_digit', 1, 43, 44, 'digits'));
  } else if (format === 'TD2') {
    spans.push(span('composite_check_digit', 1, 35, 36, 'digits'));
  }
  return spans;
}

/**
 * Corrects, per field, the one character impossible for its position, when it is the field's
 * only impossible character and a confusable maps it (C31.3). A field with two or more impossible
 * characters, or one without a confusable, is left as read, so its check digit or format still
 * fails.
 */
function correctLines(
  format: MrzFormat,
  lines: readonly string[],
): { lines: string[]; corrections: MrzCorrection[] } {
  const chars = lines.map((line) => Array.from(line));
  const corrections: MrzCorrection[] = [];
  for (const { field, line, start, end, kind } of correctableSpans(format, lines)) {
    const impossible: number[] = [];
    for (let position = start; position < end; position += 1) {
      const char = chars[line]?.[position] ?? '<';
      if (kind === 'digits' ? /[A-Z]/.test(char) : /[0-9]/.test(char)) {
        impossible.push(position);
      }
    }
    const [position] = impossible;
    if (impossible.length !== 1 || position === undefined) {
      continue;
    }
    const from = chars[line]?.[position] ?? '';
    const to = (kind === 'digits' ? TO_DIGIT : TO_LETTER)[from];
    const row = chars[line];
    if (to !== undefined && row !== undefined) {
      row[position] = to;
      corrections.push({ line, position, field, from, to });
    }
  }
  corrections.sort((a, b) => a.line - b.line || a.position - b.position);
  return { lines: chars.map((row) => row.join('')), corrections };
}

/** TD3 personal number check digit; a filler or zero is accepted when the field is empty. */
function optionalDataCheckDigit(field: string, printed: string): MrzCheckDigit {
  const result = checkDigit(field, printed);
  if (/^<+$/.test(field) && (printed === '<' || printed === '0')) {
    return { ...result, valid: true };
  }
  return result;
}

function parseSex(value: string): ParsedMrz['sex'] {
  if (value === 'M' || value === 'F') {
    return value;
  }
  return value === '<' || value === 'X' ? 'X' : null;
}

/**
 * Parses a TD1, TD2, TD3, MRV-A or MRV-B MRZ given as lines or one newline-separated string.
 * Check-digit failures and field-format problems are reported in the result;
 * only an unreadable structure throws. With `correct`, the C31.3 corrections are applied first
 * and listed in `corrections`; `lines` are then the corrected lines.
 *
 * @throws {MrzParseError} for an unrecognized or unsupported layout or characters outside the MRZ set.
 */
export function parseMrz(
  input: string | readonly string[],
  options: ParseMrzOptions = {},
): ParsedMrz {
  const read = toLines(input);
  if (!read.every((line) => MRZ_LINE.test(line))) {
    throw new MrzParseError(
      'mrz_invalid_characters',
      'MRZ lines may contain only A-Z, 0-9 and the filler <',
    );
  }
  const format = detectFormat(read);
  const { lines, corrections } =
    options.correct === true ? correctLines(format, read) : { lines: read, corrections: [] };
  const fields = layout(format, lines);
  const name = parseName(fields.nameField);
  const documentNumber = readDocumentNumber(
    fields.documentNumberField,
    fields.documentNumberDigit,
    fields.optionalData,
    fields.allowOverflow,
  );
  const sex = parseSex(fields.sex);

  const checkDigits: MrzCheckDigits = {
    documentNumber: documentNumber.checkDigit,
    birthDate: checkDigit(fields.birthDate, fields.birthDateDigit),
    expirationDate: checkDigit(fields.expirationDate, fields.expirationDateDigit),
    optionalData:
      fields.optionalDataDigit === null
        ? null
        : optionalDataCheckDigit(fields.optionalData, fields.optionalDataDigit),
    composite:
      fields.compositeField === null || fields.compositeDigit === null
        ? null
        : checkDigit(fields.compositeField, fields.compositeDigit),
  };
  const checkDigitsValid = [
    checkDigits.documentNumber,
    checkDigits.birthDate,
    checkDigits.expirationDate,
    checkDigits.optionalData,
    checkDigits.composite,
  ].every((digit) => digit?.valid ?? true);

  const formatIssues: MrzFormatIssue[] = [];
  const flag = (ok: boolean, issue: MrzFormatIssue): void => {
    if (!ok) {
      formatIssues.push(issue);
    }
  };
  flag(isValidDocumentCode(format, fields.documentCode), 'document_code_invalid');
  flag(isValidStateCode(fields.issuingState), 'issuing_state_invalid');
  flag(isValidStateCode(fields.nationality), 'nationality_invalid');
  flag(isValidDate(fields.birthDate, true), 'birth_date_invalid');
  flag(isValidDate(fields.expirationDate, false), 'expiration_date_invalid');
  flag(sex !== null, 'sex_invalid');
  flag(/^[A-Z<]+$/.test(fields.nameField) && name.surname.length > 0, 'name_invalid');

  return {
    format,
    lines,
    documentCode: stripTrailingFillers(fields.documentCode),
    issuingState: stripTrailingFillers(fields.issuingState),
    surname: name.surname,
    givenNames: name.givenNames,
    nameTruncated: name.truncated,
    documentNumber: documentNumber.documentNumber,
    documentNumberOverflow: documentNumber.overflow,
    nationality: stripTrailingFillers(fields.nationality),
    birthDate: fields.birthDate,
    sex,
    expirationDate: fields.expirationDate,
    optionalData1: stripTrailingFillers(documentNumber.optionalRest),
    optionalData2:
      fields.optionalData2 === null ? null : stripTrailingFillers(fields.optionalData2),
    checkDigits,
    checkDigitsValid,
    formatIssues,
    valid: checkDigitsValid && formatIssues.length === 0,
    corrections,
  };
}
