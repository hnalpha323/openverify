/**
 * C100.2 to C100.4, C118.5, C133.2 (F13): the one configuration of `csv-parse`: strict decoding, then
 * the parser, then the rules that decide what "read" means. The importer, manual runs and holiday
 * imports all read through it.
 *
 * `csv-parse` attaches the offending record to its errors, so a parser error is reduced here to a
 * code and a line and the error itself is dropped.
 *
 * Three of the parser's behaviours decide what "read" means, all measured on 7.0.3:
 * - With `skip_records_with_error` it can only step over some errors. On a record too large it
 *   returns from its loop, and after a bad closing quote it stays inside the quote: either way every
 *   later row is lost with no further error. A file like that is refused whole, so a caller never
 *   applies a part of a file as if it had read it all.
 * - `to_line` counts lines and stops silently, so a file with multi-line cells would be cut off
 *   under the row cap. The cap is therefore on records (`to`), and a row past it is seen and refused.
 * - `to` counts emitted records only, so a file of skipped rows would be parsed to its end, with one
 *   refusal kept per row: minutes of a blocked event loop and gigabytes for one upload. The parse
 *   therefore stops once more rows were refused than the cap allows (R003).
 *
 * The encodings are UTF-8, or a WHATWG single-byte encoding named by a label (C100.2, decision 31 of
 * Phase 7). UTF-16 and the multi-byte legacy encodings are refused. Decoding is strict, so a byte
 * that fits no character refuses the file instead of being read as a replacement character. A
 * pattern on the label is a first filter only: `csunicode` and `iso-10646-ucs-2` are labels of
 * UTF-16, so {@link resolveCsvEncoding} decides on the name WHATWG gives a label.
 */
import type { ImportErrorCode } from '@openverify/core';
import { parse, type CsvError } from 'csv-parse/sync';
import { importErrorCodeOfParser } from '../lists/import-tables.js';

/** One error of a file: a code and a line, never a value. */
export interface CsvProblem {
  row: number | null;
  column: string | null;
  code: ImportErrorCode;
}

/** One data row of the file, by the file's line. */
export interface CsvRow {
  row: number;
  cells: Readonly<Record<string, string>>;
}

export interface CsvReading {
  /** Whether the whole file is refused: no row of it may be applied. */
  refused: boolean;
  rows: CsvRow[];
  errors: CsvProblem[];
  /** The data rows read, good or not. */
  rowCount: number;
}

export interface ReadCsvOptions {
  /** A WHATWG label; UTF-8 when absent. */
  encoding?: string;
  /** The data rows a file may hold. */
  maxRows: number;
  /** The characters one record may hold. */
  maxRecordCharacters: number;
  /** The caller's refusals of the header; any refuses the whole file. */
  headerProblems?: (header: readonly string[]) => readonly CsvProblem[];
}

const UTF8 = 'utf-8';

/** The WHATWG Encoding Standard's single-byte encodings, by the name `TextDecoder` reports. */
const SINGLE_BYTE_ENCODINGS: ReadonlySet<string> = new Set([
  'ibm866',
  'iso-8859-2',
  'iso-8859-3',
  'iso-8859-4',
  'iso-8859-5',
  'iso-8859-6',
  'iso-8859-7',
  'iso-8859-8',
  'iso-8859-8-i',
  'iso-8859-10',
  'iso-8859-13',
  'iso-8859-14',
  'iso-8859-15',
  'iso-8859-16',
  'koi8-r',
  'koi8-u',
  'macintosh',
  'windows-874',
  'windows-1250',
  'windows-1251',
  'windows-1252',
  'windows-1253',
  'windows-1254',
  'windows-1255',
  'windows-1256',
  'windows-1257',
  'windows-1258',
  'x-mac-cyrillic',
]);

/** The WHATWG name of an accepted label, or `null` for any other. */
export function resolveCsvEncoding(label: string): string | null {
  let name: string;
  try {
    ({ encoding: name } = new TextDecoder(label));
  } catch {
    return null;
  }
  return name === UTF8 || SINGLE_BYTE_ENCODINGS.has(name) ? name : null;
}

/** A UTF-16 byte order mark, which a single-byte decoder would read as two letters. */
const startsWithUtf16Bom = (bytes: Uint8Array): boolean =>
  (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);

/** The file's text, or `null` when it does not decode. */
export function decodeCsv(bytes: Uint8Array, encoding: string): string | null {
  if (startsWithUtf16Bom(bytes) || resolveCsvEncoding(encoding) === null) {
    return null;
  }
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The parser errors it steps over: the next record is read correctly after either. */
const RECOVERABLE_PARSER_CODES: ReadonlySet<string> = new Set([
  'CSV_RECORD_INCONSISTENT_FIELDS_LENGTH',
  'INVALID_OPENING_QUOTE',
]);

interface ParserRefusal {
  row: number;
  code: ImportErrorCode;
  recoverable: boolean;
}

interface ParsedRecord {
  record: string[];
  info: { lines: number };
}

/** Thrown out of the parser's `on_skip`: more rows were refused than the cap allows. */
class TooManyRefusedRows extends Error {}

/** One parse of `text`, up to `to` records, each refused record passed to `onRefused`. */
function parseUpTo(
  text: string,
  to: number,
  maxRecordCharacters: number,
  onRefused: (refusal: ParserRefusal) => void,
): ParsedRecord[] {
  return parse(text, {
    bom: true,
    max_record_size: maxRecordCharacters,
    relax_column_count: false,
    cast: false,
    info: true,
    to,
    skip_records_with_error: true,
    on_skip: (error: CsvError | undefined) => {
      if (error !== undefined) {
        onRefused({
          row: (error as CsvError & { lines: number }).lines,
          code: importErrorCodeOfParser(error.code),
          recoverable: RECOVERABLE_PARSER_CODES.has(error.code),
        });
      }
      return undefined;
    },
  }) as unknown as ParsedRecord[];
}

function parseRecords(
  text: string,
  { maxRows, maxRecordCharacters }: ReadCsvOptions,
): { records: ParsedRecord[]; refusals: ParserRefusal[] } {
  const refusals: ParserRefusal[] = [];
  let rows = 0;
  let lastRow: number | null = null;
  try {
    // The header, the cap's rows, and one more, so a file past the cap is seen.
    const records = parseUpTo(text, 1 + maxRows + 1, maxRecordCharacters, (refusal) => {
      refusals.push(refusal);
      // A record can fail twice, under one row.
      if (refusal.row !== lastRow) {
        lastRow = refusal.row;
        rows += 1;
      }
      if (rows > maxRows) {
        throw new TooManyRefusedRows();
      }
    });
    return { records, refusals };
  } catch (error) {
    if (!(error instanceof TooManyRefusedRows)) {
      throw error;
    }
    // The file is refused over the cap; the header is all that is still read.
    return { records: parseUpTo(text, 1, maxRecordCharacters, () => undefined), refusals };
  }
}

const refusedFile = (errors: CsvProblem[], rowCount: number): CsvReading => ({
  refused: true,
  rows: [],
  errors,
  rowCount,
});

/** One row's error per row: a record can fail twice, and the last failure says more. */
function rowErrors(refusals: readonly ParserRefusal[]): CsvProblem[] {
  const byRow = new Map<number, ImportErrorCode>();
  for (const { row, code } of refusals) {
    byRow.set(row, code);
  }
  return [...byRow].map(([row, code]) => ({ row, column: null, code }));
}

/**
 * Reads a stored file into rows and refusals, or refuses it whole. Only the two recoverable parser
 * errors hold one row; every other one, an undecodable file, a refused header and a file past the
 * row cap refuse the file.
 */
export function readCsv(bytes: Uint8Array, options: ReadCsvOptions): CsvReading {
  const text = decodeCsv(bytes, options.encoding ?? UTF8);
  if (text === null) {
    return refusedFile([{ row: null, column: null, code: 'invalid_encoding' }], 0);
  }
  const { records, refusals } = parseRecords(text, options);

  const stop = refusals.find(({ recoverable }) => !recoverable);
  const readTo = stop?.row ?? Number.POSITIVE_INFINITY;
  const read = refusals.filter(({ row }) => row <= readTo);
  const errors = rowErrors(read);
  const [first, ...rest] = records;
  const dataRows = rest.filter(({ info }) => info.lines < readTo);

  // A refusal at or before the first record: the header was not read.
  const [earliest] = read;
  if (earliest !== undefined && (first === undefined || earliest.row <= first.info.lines)) {
    return refusedFile(errors, 0);
  }
  const header = first?.record ?? [];
  const problems = options.headerProblems?.(header) ?? [];
  if (problems.length > 0) {
    return refusedFile([...problems], 0);
  }

  const rowCount = dataRows.length + errors.length;
  if (rowCount > options.maxRows) {
    return refusedFile([{ row: null, column: null, code: 'row_limit_exceeded' }], rowCount);
  }
  if (stop !== undefined) {
    return refusedFile(errors, rowCount);
  }
  const names = header.map((name) => name.trim());
  return {
    refused: false,
    rows: dataRows.map(({ record, info }) => ({
      row: info.lines,
      cells: Object.fromEntries(names.map((name, index) => [name, record[index] ?? ''])),
    })),
    errors,
    rowCount,
  };
}
