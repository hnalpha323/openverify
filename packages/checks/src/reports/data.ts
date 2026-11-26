/**
 * The committed tables of the report risk logic (`packages/checks/data/reports/`), loaded on first
 * use. The folder sits beside `src/` and `dist/`, so both the sources and the build find it. No
 * table is fetched at run time; the authored tables cite their sources, and the generated ones
 * name the pinned `data/manifest.json` entries they were built from.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folder of the committed report tables (`src/reports` or `dist/reports`, two levels up). */
export const REPORT_DATA_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'data',
  'reports',
);

/**
 * Reads and parses one committed JSON table of {@link REPORT_DATA_DIRECTORY}.
 * @throws {Error} for a name that is not a plain `.json` file name, or a table that cannot be read.
 */
export function readReportData(file: string): unknown {
  if (!TABLE_FILE.test(file)) {
    throw new Error(`report table ${file} must be a plain file name`);
  }
  let text: string;
  try {
    text = readFileSync(join(REPORT_DATA_DIRECTORY, file), 'utf8');
  } catch (error) {
    throw new Error(`cannot read report table ${file}`, { cause: error });
  }
  return JSON.parse(text) as unknown;
}

/** A plain JSON file name: no folder, no leading dot. */
const TABLE_FILE = /^\w[\w.-]*\.json$/;
