/**
 * C31.8, C98.2 (owner decision 13 after Workflow 7A): how an identification number is normalised
 * before it is keyed. The rule lives here because the blind index (`packages/db`) and the list key
 * inputs (`packages/checks`) both need it, and `packages/checks` cannot import `packages/db`.
 */

/** The number as the indexes hash it: upper-cased, only `A-Z` and `0-9` kept. */
export function normalizeIdentificationNumber(number: string): string {
  return number.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
