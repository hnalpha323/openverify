/**
 * The committed tables the matchers read (`packages/checks/data/`), loaded on first use. The
 * folder sits beside `src/` and `dist/`, so both the TypeScript sources and the build find it one
 * level above their own folder. No table is fetched at run time (C58.3, C58.4).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folder of the committed matching tables. */
export const MATCHING_DATA_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'data',
);

const TABLE_FILE = /^\w[\w.-]*\.json$/;

/**
 * Reads and parses one committed JSON table of {@link MATCHING_DATA_DIRECTORY}.
 * @throws {Error} for a name that is not a plain `.json` file name, or a table that cannot be read.
 */
export function readMatchingData(file: string): unknown {
  if (!TABLE_FILE.test(file) || file.includes('..')) {
    throw new Error(`matching table ${file} must be a plain file name`);
  }
  let text: string;
  try {
    text = readFileSync(join(MATCHING_DATA_DIRECTORY, file), 'utf8');
  } catch (error) {
    throw new Error(`cannot read matching table ${file}`, { cause: error });
  }
  return JSON.parse(text) as unknown;
}
