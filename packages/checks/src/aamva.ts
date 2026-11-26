/**
 * The AAMVA PDF417 payload of US and Canadian driver licences and ID cards (C31.1, C33), in the
 * layout of the AAMVA DL/ID Card Design Standard (2020), Annex D:
 * - the header (Table D.1): `@`, LF, RS, CR, `ANSI `, the six-digit IIN, the AAMVA version (01 to
 *   10), the jurisdiction version (from version 02) and the number of entries;
 * - one ten-byte designator per subfile (Table D.2): its type, offset and length;
 * - the subfiles: the type, then elements (a three-letter id and a value) separated by LF, ended by
 *   CR. `DL` and `ID` hold the card's data (Tables D.3 and D.4); `Z?` subfiles are the
 *   jurisdiction's own.
 *
 * Phase 12A (C4) tolerates two deviations real cards show, each reported as an issue so the
 * payload is not `valid`: the file type `AAMVA` of the older standards (`aamva_header_nonstandard`)
 * and a designator offset up to two bytes off, when the subfile sits where the previous one ends
 * (`aamva_designator_offset_mismatch`). A Quebec (IIN 604428) number printed with dashes is read
 * compact, as the card's other sources give it.
 *
 * Written by OpenVerify; the element tables are our own and the standard's text (© AAMVA) is not
 * copied. Messages and details name fields and elements, never their values.
 */
import { DomainError, type ExtractionField } from '@openverify/core';
import { alpha3ToAlpha2 } from './country-codes.js';
import { aamvaIssuerOf, type AamvaIin } from './data/aamva-iins.js';

export type AamvaStructuralErrorCode = 'aamva_header_invalid' | 'aamva_subfile_designator_invalid';

export type AamvaIssueCode =
  | 'aamva_header_nonstandard'
  | 'aamva_designator_offset_mismatch'
  | 'aamva_mandatory_element_missing'
  | 'aamva_date_invalid'
  | 'aamva_iin_unknown'
  | 'aamva_version_unsupported'
  | 'aamva_document_subfile_missing';

export type AamvaErrorCode = AamvaStructuralErrorCode | AamvaIssueCode;

/** The payload is not an AAMVA payload, or its subfiles cannot be located. */
export class AamvaParseError extends DomainError {
  declare readonly code: AamvaStructuralErrorCode;
  /** `{ field }` for a header error, `{ subfile }` for a designator error. */
  readonly details: Readonly<Record<string, string>>;

  constructor(
    code: AamvaStructuralErrorCode,
    message: string,
    details: Readonly<Record<string, string>>,
  ) {
    super(code, message);
    this.details = details;
  }
}

export interface AamvaHeader {
  complianceIndicator: string;
  fileType: string;
  iin: string;
  aamvaVersion: number;
  /** `null` for version 01, whose header has none. */
  jurisdictionVersion: number | null;
  numberOfEntries: number;
}

export interface AamvaSubfile {
  type: string;
  offset: number;
  length: number;
  /** Element id to raw value, trailing spaces kept. */
  elements: Readonly<Record<string, string>>;
}

/** A problem of a payload that still reads. */
export interface AamvaIssue {
  code: AamvaIssueCode;
  details: Readonly<Record<string, string | readonly string[]>>;
}

export interface ParsedAamva {
  header: AamvaHeader;
  subfiles: readonly AamvaSubfile[];
  /** The type of the first `DL` or `ID` subfile, or `null` without one. */
  documentType: 'DL' | 'ID' | null;
  /** The elements of that subfile. */
  elements: Readonly<Record<string, string>>;
  /** The jurisdiction of the IIN, or `null` for an IIN AAMVA does not list. */
  issuer: AamvaIin | null;
  /** `DDA`: `F` REAL ID compliant, `N` not; `null` when absent. */
  realIdCompliance: string | null;
  /** A `Z?` subfile marks the payload as OpenVerify synthetic test data (C36). */
  syntheticMarker: boolean;
  /** The C31.5 fields read, normalized; a field not read is absent. */
  fields: Readonly<Partial<Record<ExtractionField, string>>>;
  issues: readonly AamvaIssue[];
  /** No issue. */
  valid: boolean;
}

/** The value of the `Z?A` element of an OpenVerify synthetic payload (C36). */
export const AAMVA_SYNTHETIC_MARKER = 'OPENVERIFY SYNTHETIC TEST DATA';

/** The mandatory elements of a DL subfile in the 2020 standard (Table D.3). */
const MANDATORY_2020 = [
  'DCA',
  'DCB',
  'DCD',
  'DBA',
  'DCS',
  'DAC',
  'DAD',
  'DBD',
  'DBB',
  'DBC',
  'DAY',
  'DAU',
  'DAG',
  'DAI',
  'DAJ',
  'DAK',
  'DAQ',
  'DCF',
  'DCG',
  'DDE',
  'DDF',
  'DDG',
] as const;
/** Vehicle class, restrictions and endorsements: driver licences only. */
const DL_ONLY = new Set(['DCA', 'DCB', 'DCD']);
/** The identity core every version carries: number, birth date, expiry. */
const CORE = ['DAQ', 'DBB', 'DBA'] as const;
const DATE_ELEMENTS = ['DBB', 'DBA', 'DBD', 'DDB', 'DDC', 'DDH', 'DDI', 'DDJ'] as const;
const CURRENT_VERSION = 10;
/** The file types of the header: `ANSI ` (Annex D), and `AAMVA` of the older standards. */
const STANDARD_FILE_TYPE = 'ANSI ';
const TOLERATED_FILE_TYPES: ReadonlySet<string> = new Set([STANDARD_FILE_TYPE, 'AAMVA']);
/**
 * The farthest a designator's offset may be from where its subfile is, and still be tolerated:
 * the two bytes of the header's jurisdiction version, which an encoder may leave out of its count.
 * A designator four bytes off (the `subfile-offset-misplaced` vector) is still refused.
 */
const MAX_OFFSET_DEVIATION = 2;
/** The IIN whose licence number reads compact (Quebec: one letter and twelve digits). */
const QUEBEC_IIN = '604428';

const SEX: Readonly<Record<string, 'M' | 'F' | 'X'>> = {
  '1': 'M',
  '2': 'F',
  '9': 'X',
  M: 'M',
  F: 'F',
};

function headerError(field: string): AamvaParseError {
  return new AamvaParseError('aamva_header_invalid', `Not an AAMVA header (${field})`, { field });
}

function designatorError(subfile: string): AamvaParseError {
  return new AamvaParseError(
    'aamva_subfile_designator_invalid',
    `The designator of subfile ${subfile} does not locate it`,
    { subfile },
  );
}

const twoDigits = (text: string, field: string): number => {
  if (!/^\d{2}$/.test(text)) {
    throw headerError(field);
  }
  return Number(text);
};

function readHeader(payload: string): { header: AamvaHeader; length: number } {
  if (!payload.startsWith('@')) {
    throw headerError('compliance_indicator');
  }
  if (payload.slice(1, 4) !== '\n\x1e\r') {
    throw headerError('separators');
  }
  const fileType = payload.slice(4, 9);
  if (!TOLERATED_FILE_TYPES.has(fileType)) {
    throw headerError('file_type');
  }
  const iin = payload.slice(9, 15);
  if (!/^\d{6}$/.test(iin)) {
    throw headerError('iin');
  }
  const aamvaVersion = twoDigits(payload.slice(15, 17), 'aamva_version');
  const jurisdictionVersion =
    aamvaVersion >= 2 ? twoDigits(payload.slice(17, 19), 'jurisdiction_version') : null;
  const length = jurisdictionVersion === null ? 19 : 21;
  const numberOfEntries = twoDigits(payload.slice(length - 2, length), 'number_of_entries');
  if (numberOfEntries === 0) {
    throw headerError('number_of_entries');
  }
  return {
    header: {
      complianceIndicator: '@',
      fileType,
      iin,
      aamvaVersion,
      jurisdictionVersion,
      numberOfEntries,
    },
    length,
  };
}

/** The subfile body at `offset`, when it starts with its type and ends with CR at that length. */
function bodyAt(payload: string, type: string, offset: number, length: number): string | null {
  const body = payload.slice(offset, offset + length);
  return offset >= 0 && body.length === length && body.startsWith(type) && body.endsWith('\r')
    ? body
    : null;
}

/**
 * The subfiles their designators locate. A designator whose offset is off by at most
 * {@link MAX_OFFSET_DEVIATION} bytes is tolerated when the subfile sits where it should: right
 * after the designators for the first, right after the previous subfile for the others; the
 * subfile's type is then in `shifted`.
 */
function readSubfiles(
  payload: string,
  start: number,
  count: number,
): { subfiles: AamvaSubfile[]; shifted: string[] } {
  const subfiles: AamvaSubfile[] = [];
  const shifted: string[] = [];
  let expected = start + count * 10;
  for (let index = 0; index < count; index += 1) {
    const designator = /^([A-Z]{2})(\d{4})(\d{4})$/.exec(
      payload.slice(start + index * 10, start + index * 10 + 10),
    );
    const [, type = String(index + 1), offsetText = '', lengthText = ''] = designator ?? [];
    let offset = Number(offsetText);
    const length = Number(lengthText);
    let body = designator === null ? null : bodyAt(payload, type, offset, length);
    if (
      designator !== null &&
      body === null &&
      Math.abs(offset - expected) <= MAX_OFFSET_DEVIATION
    ) {
      body = bodyAt(payload, type, expected, length);
      if (body !== null) {
        offset = expected;
        shifted.push(type);
      }
    }
    if (body === null) {
      throw designatorError(type);
    }
    const elements: Record<string, string> = {};
    for (const element of body.slice(2, -1).split('\n')) {
      const id = element.slice(0, 3);
      if (id.length === 3 && !Object.hasOwn(elements, id)) {
        elements[id] = element.slice(3);
      }
    }
    subfiles.push({ type, offset, length, elements });
    expected = offset + length;
  }
  return { subfiles, shifted };
}

/** `MMDDCCYY` (US) or `CCYYMMDD` (Canada) to `YYYY-MM-DD`; `null` when not a calendar date. */
function isoDate(value: string, canadian: boolean): string | null {
  const match = canadian
    ? /^(\d{4})(\d{2})(\d{2})$/.exec(value)
    : /^(\d{2})(\d{2})(\d{4})$/.exec(value);
  if (match === null) {
    return null;
  }
  const [year, month, day] = canadian
    ? [match[1], match[2], match[3]]
    : [match[3], match[1], match[2]];
  const iso = `${year ?? ''}-${month ?? ''}-${day ?? ''}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

function postalCode(value: string): string {
  const trimmed = value.trim().toUpperCase();
  if (/^\d{9}$/.test(trimmed)) {
    return trimmed.endsWith('0000')
      ? trimmed.slice(0, 5)
      : `${trimmed.slice(0, 5)}-${trimmed.slice(5)}`;
  }
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(trimmed)) {
    return `${trimmed.slice(0, 3)} ${trimmed.slice(3)}`;
  }
  return trimmed;
}

function missingElements(
  elements: Readonly<Record<string, string>>,
  documentType: 'DL' | 'ID',
  version: number,
): string[] {
  const has = (id: string): boolean => Object.hasOwn(elements, id);
  if (version >= CURRENT_VERSION) {
    return MANDATORY_2020.filter((id) => !has(id) && (documentType === 'DL' || !DL_ONLY.has(id)));
  }
  const missing: string[] = CORE.filter((id) => !has(id));
  if (!has('DCS') && !has('DAB')) {
    missing.push('DCS');
  }
  return missing;
}

/** A licence number without its dashes and spaces. */
const compact = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : value.replace(/[\s-]+/g, '');

function readFields(
  elements: Readonly<Record<string, string>>,
  iin: string,
  canadian: boolean,
): Partial<Record<ExtractionField, string>> {
  const value = (id: string): string | undefined => {
    const trimmed = Object.hasOwn(elements, id) ? elements[id]?.trim() : undefined;
    return trimmed === '' ? undefined : trimmed;
  };
  const date = (id: string): string | undefined => {
    const raw = value(id);
    return raw === undefined ? undefined : (isoDate(raw, canadian) ?? undefined);
  };
  const middle = value('DAD');
  const country = value('DCG');
  const postal = value('DAK');
  const entries: [ExtractionField, string | undefined][] = [
    ['name-first', value('DAC') ?? value('DCT')],
    ['name-middle', middle === 'NONE' ? undefined : middle],
    ['name-last', value('DCS') ?? value('DAB')],
    ['birthdate', date('DBB')],
    ['sex', SEX[value('DBC') ?? '']],
    ['identification-number', iin === QUEBEC_IIN ? compact(value('DAQ')) : value('DAQ')],
    ['issue-date', date('DBD')],
    ['expiration-date', date('DBA')],
    ['issuing-authority-code', iin],
    ['address-street-1', value('DAG')],
    ['address-street-2', value('DAH')],
    ['address-city', value('DAI')],
    ['address-subdivision', value('DAJ')],
    ['address-postal-code', postal === undefined ? undefined : postalCode(postal)],
    [
      'address-country-code',
      country === undefined ? undefined : (alpha3ToAlpha2(country) ?? undefined),
    ],
    ['endorsements', value('DCD')],
    ['restrictions', value('DCB')],
    ['vehicle-class', value('DCA')],
  ];
  return Object.fromEntries(
    entries.filter((entry): entry is [ExtractionField, string] => entry[1] !== undefined),
  );
}

/**
 * Parses an AAMVA payload (the decoded PDF417 text). Element problems (a missing mandatory
 * element, an impossible date, an unlisted IIN, an unknown version, no `DL` or `ID` subfile) and
 * the tolerated deviations (the `AAMVA` file type, a designator offset up to two bytes off) are
 * reported in `issues`; only a payload that is not AAMVA, or whose subfiles cannot be located,
 * throws.
 * @throws {AamvaParseError} `aamva_header_invalid` or `aamva_subfile_designator_invalid`.
 */
export function parseAamva(payload: string): ParsedAamva {
  const { header, length } = readHeader(payload);
  const { subfiles, shifted } = readSubfiles(payload, length, header.numberOfEntries);
  const document = subfiles.find((subfile) => subfile.type === 'DL' || subfile.type === 'ID');
  const documentType = document === undefined ? null : (document.type as 'DL' | 'ID');
  const elements = document?.elements ?? {};
  const issuer = aamvaIssuerOf(header.iin);
  const country = elements.DCG?.trim();
  const canadian = country === undefined ? issuer?.country === 'CA' : country === 'CAN';

  const issues: AamvaIssue[] = [];
  if (header.fileType !== STANDARD_FILE_TYPE) {
    issues.push({ code: 'aamva_header_nonstandard', details: { field: 'file_type' } });
  }
  for (const subfile of shifted) {
    issues.push({ code: 'aamva_designator_offset_mismatch', details: { subfile } });
  }
  if (header.aamvaVersion < 1 || header.aamvaVersion > CURRENT_VERSION) {
    issues.push({ code: 'aamva_version_unsupported', details: { field: 'aamva_version' } });
  }
  if (issuer === null) {
    issues.push({ code: 'aamva_iin_unknown', details: { field: 'iin' } });
  }
  if (documentType === null) {
    issues.push({ code: 'aamva_document_subfile_missing', details: {} });
  } else {
    const missing = missingElements(elements, documentType, header.aamvaVersion);
    if (missing.length > 0) {
      issues.push({ code: 'aamva_mandatory_element_missing', details: { elements: missing } });
    }
    for (const element of DATE_ELEMENTS) {
      const raw = elements[element];
      if (raw !== undefined && isoDate(raw.trim(), canadian) === null) {
        issues.push({ code: 'aamva_date_invalid', details: { element } });
      }
    }
  }

  const realId = elements.DDA?.trim();
  return {
    header,
    subfiles,
    documentType,
    elements,
    issuer,
    realIdCompliance: realId === undefined || realId === '' ? null : realId,
    syntheticMarker: subfiles.some(
      (subfile) =>
        /^Z[A-Z0-9]$/.test(subfile.type) &&
        subfile.elements[`${subfile.type}A`]?.trim() === AAMVA_SYNTHETIC_MARKER,
    ),
    fields: readFields(elements, header.iin, canadian),
    issues,
    valid: issues.length === 0,
  };
}
