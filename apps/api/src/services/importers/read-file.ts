/**
 * C100.2 to C100.4: a stored import read into rows, through the shared `readCsv` (F13), which holds
 * strict decoding, the `csv-parse` options and the rules of what "read" means. The kind's header
 * rules are this file's. Owner: `api-importers`.
 */
import {
  importHeaderProblems,
  readCsv,
  type CsvProblem,
  type CsvReading,
  type CsvRow,
} from '@openverify/checks';
import { IMPORT_LIMITS, type ListKind } from '@openverify/contracts';

/** One error of an import: a code and a line, never a value. */
export type ImportFileError = CsvProblem;

/** One data row of the file, by the file's line. */
export type ImportFileRow = CsvRow;

export type ImportFileReading = CsvReading;

/** C100.3: the header's refusals, each once: a file can repeat `unknown_column` per column. */
function headerErrors(kind: ListKind, header: readonly string[]): ImportFileError[] {
  const seen = new Set<string>();
  const errors: ImportFileError[] = [];
  for (const { column, code } of importHeaderProblems(kind, header)) {
    const key = `${code}/${column ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      errors.push({ row: null, column, code });
    }
  }
  return errors;
}

/** Reads a stored file into rows and refusals, or refuses it whole. */
export function readImportFile(
  bytes: Uint8Array,
  encoding: string,
  kind: ListKind,
): ImportFileReading {
  return readCsv(bytes, {
    encoding,
    maxRows: IMPORT_LIMITS.rows,
    maxRecordCharacters: IMPORT_LIMITS.recordCharacters,
    headerProblems: (header) => headerErrors(kind, header),
  });
}
