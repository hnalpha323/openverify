/**
 * Input hygiene (C58.7, P27): every matcher compares capped input, so a provider record or an
 * entered value of any length costs a bounded amount of work. Lengths are in Unicode code points.
 */

/** The caps, in code points (names 200, business names 300, addresses 500 per line). */
export const MATCHING_INPUT_LIMITS = Object.freeze({
  name: 200,
  businessName: 300,
  address: 500,
  /** Document text (C60.5): lines kept per page ... */
  documentLinesPerPage: 600,
  /** ... and code points kept per line. */
  documentLineLength: 300,
});

/** The first `max` code points of `value`, read without copying the rest. */
export function capText(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  let kept = 0;
  let end = 0;
  for (const codePoint of value) {
    if (kept >= max) {
      break;
    }
    kept += 1;
    end += codePoint.length;
  }
  return value.slice(0, end);
}

/** One page of document text as C58.7 caps it: its first 600 lines, each its first 300 code points. */
export function capDocumentLines(lines: readonly string[]): string[] {
  return lines
    .slice(0, MATCHING_INPUT_LIMITS.documentLinesPerPage)
    .map((line) => capText(line, MATCHING_INPUT_LIMITS.documentLineLength));
}
