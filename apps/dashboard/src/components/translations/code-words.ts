import { COPY_COPY } from '../../lib/copy/themes-copy';

type CodeKey = keyof typeof COPY_COPY.codes;

/** A copy rule's code in words (C162.2-C162.4; never the text that broke it). */
export function copyCodeWords(code: string): string {
  return code in COPY_COPY.codes ? COPY_COPY.codes[code as CodeKey] : COPY_COPY.codes.unknown;
}

type CsvCodeKey = keyof typeof COPY_COPY.csv.codes;

/** A CSV reader's or a copy rule's code for a refused file, in words. */
export function csvCodeWords(code: string): string {
  return code in COPY_COPY.csv.codes
    ? COPY_COPY.csv.codes[code as CsvCodeKey]
    : copyCodeWords(code);
}
