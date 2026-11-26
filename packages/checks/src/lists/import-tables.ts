/**
 * C100.3, C100.4: the importer's tables. One row of a CSV file maps to an item here, and the C98.2
 * normaliser then decides it, so a file and a create body are read by one rule. A problem names a
 * column of the table and never text from the file: a file with no header holds a person in its
 * first row.
 */
import type { ImportErrorCode, ListKind } from '@openverify/core';
import { stripNeutraliser } from '../csv/index.js';
import type { ListValue } from './key-input.js';
import { numberMember } from './normalise.js';

interface ImportColumn {
  /** The public CSV header. */
  readonly column: string;
  /** The wire member it fills. */
  readonly member: string;
  /** An empty cell means the kind's default. */
  readonly optional: boolean;
  /** The item resource serves a number. */
  readonly numeric: boolean;
}

const column = (
  name: string,
  options: Partial<Pick<ImportColumn, 'optional' | 'numeric'>> = {},
): ImportColumn => ({
  column: name,
  member: name.replaceAll('_', '-'),
  optional: false,
  numeric: false,
  ...options,
});

const VALUE: readonly ImportColumn[] = [column('value')];
const NUMERIC = { numeric: true } as const;

/** C100.3: the eleven kinds with an importer; face and background imports wait (decision 27). */
const IMPORT_TABLES: Readonly<Partial<Record<ListKind, readonly ImportColumn[]>>> = {
  'browser-fingerprint': VALUE,
  'device-fingerprint': VALUE,
  country: [column('country_code')],
  'email-address': [column('value'), column('match_type', { optional: true })],
  geolocation: [
    column('latitude', NUMERIC),
    column('longitude', NUMERIC),
    column('radius_meters', NUMERIC),
  ],
  'government-id-number': [column('id_number'), column('id_class', { optional: true })],
  field: [column('field_value')],
  'ip-address': VALUE,
  name: [column('name_first'), column('name_last')],
  'phone-number': VALUE,
  string: VALUE,
};

function tableOf(kind: ListKind): readonly ImportColumn[] {
  const table = IMPORT_TABLES[kind];
  if (table === undefined) {
    throw new TypeError(`The list kind ${kind} has no importer`);
  }
  return table;
}

/**
 * C100.3: the CSV header of a kind with an importer, in the public names.
 * @throws {TypeError} for a kind with none.
 */
export function importColumns(kind: ListKind): readonly string[] {
  return tableOf(kind).map(({ column: name }) => name);
}

/** The CSV column of a wire member, or `null` when the kind has none. */
export function importColumnOf(kind: ListKind, member: string): string | null {
  return IMPORT_TABLES[kind]?.find((entry) => entry.member === member)?.column ?? null;
}

/** One refusal of a header (C100.3); `column` is `null` where it would echo the file's text. */
export interface ImportHeaderProblem {
  readonly column: string | null;
  readonly code: ImportErrorCode;
}

/**
 * C100.3: why a file's header is refused: empty when it holds exactly the kind's columns, in any
 * order. An unknown, repeated or missing column refuses the file.
 * @throws {TypeError} for a kind with no importer.
 */
export function importHeaderProblems(
  kind: ListKind,
  header: readonly string[],
): ImportHeaderProblem[] {
  const columns = importColumns(kind);
  const names = header.map((name) => name.trim());
  const count = (name: string) => names.filter((other) => other === name).length;
  return [
    ...names
      .filter((name) => !columns.includes(name))
      .map(() => ({ column: null, code: 'unknown_column' as const })),
    ...columns
      .filter((name) => count(name) > 1)
      .map((name) => ({ column: name, code: 'duplicate_column' as const })),
    ...columns
      .filter((name) => count(name) === 0)
      .map((name) => ({ column: name, code: 'missing_column' as const })),
  ];
}

/**
 * C100.3, C100.5: the item of one CSV row, under its wire names: each cell's neutraliser stripped
 * once, an empty optional cell left out, and numbers read.
 * @throws {ListKeyInputError} for a numeric cell that is no number.
 * @throws {TypeError} for a kind with no importer.
 */
export function importRowItem(kind: ListKind, row: Readonly<Record<string, string>>): ListValue {
  const item: Record<string, unknown> = {};
  for (const { column: name, member, optional, numeric } of tableOf(kind)) {
    const cell = stripNeutraliser(row[name] ?? '');
    if (optional && cell.trim() === '') {
      continue;
    }
    item[member] = numeric ? numberMember({ [member]: cell }, member) : cell;
  }
  return item;
}

/** C100.4: `csv-parse` 7.0.3's codes with a code of their own. */
const PARSER_CODES: ReadonlyMap<string, ImportErrorCode> = new Map([
  ['CSV_RECORD_INCONSISTENT_FIELDS_LENGTH', 'field_count_mismatch'],
  ['CSV_RECORD_INCONSISTENT_COLUMNS', 'field_count_mismatch'],
  ['CSV_MAX_RECORD_SIZE', 'record_too_large'],
]);

/**
 * C100.4: the importer's code for a `csv-parse` error, so the job keeps a code and a line and drops
 * the record the error carries. Quoting errors, and any code a later parser adds, are
 * `invalid_value`.
 */
export function importErrorCodeOfParser(parserCode: string): ImportErrorCode {
  return PARSER_CODES.get(parserCode) ?? 'invalid_value';
}

/** C100.3, C100.4: the codes that refuse a whole file; every other one holds one row. */
const FILE_ERROR_CODES: ReadonlySet<ImportErrorCode> = new Set([
  'invalid_encoding',
  'missing_column',
  'unknown_column',
  'duplicate_column',
  'row_limit_exceeded',
]);

/** C100.4: whether a code refuses the whole file, or one row. */
export function importErrorScope(code: ImportErrorCode): 'file' | 'row' {
  return FILE_ERROR_CODES.has(code) ? 'file' : 'row';
}
