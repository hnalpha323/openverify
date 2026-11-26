/**
 * C81.2 (V10): the GDELT DOC 2.0 query, built only here. A screened name comes from an API caller
 * or an inquiry's typed fields, so it may hold GDELT operators (a quote, a leading `-`,
 * `sourcecountry:`, `domain:`, `OR`, parentheses) that would close the phrase and add a filter
 * that returns nothing, which would read as "no match". So:
 *
 * - **Names.** Each name is C58-folded (casefolded, marks stripped, `foldedTokens`) and each token
 *   reduced to Unicode letters and digits (`\p{L}\p{N}`), recomposed (NFC); the tokens are joined
 *   by single spaces inside one double-quoted phrase this module writes. Several names (the query's
 *   and its `additional-names`, C84.2) are one OR group of phrases, so a run makes one request.
 * - **Terms.** The template's category terms from our authored lexicon (C81.3), reduced the same
 *   way, as one `(a OR b)` group (a lone term without parentheses), a multi-word term quoted.
 * - **Country.** Only as `sourcecountry:` with the country's English name, letters only, lower
 *   case, from `Intl.DisplayNames` keyed by the validated ISO 3166-1 code (`GB` is
 *   `unitedkingdom`); a code that is not a region adds nothing.
 *
 * Nothing from the subject reaches the query outside the phrase. A query without any name word is
 * refused (`RangeError`): creation answers 422 `report_query_invalid`, a completion run errors with
 * `insufficient_input`.
 */
import { foldedTokens } from '@openverify/checks';

/** C81.2 (H12): the DOC API's record cap. */
export const GDELT_MAX_RECORDS = 250;

const NOT_A_WORD_CHARACTER = /[^\p{L}\p{N}]/gu;

/** C81.2: a name's query tokens (see the file header). */
export function gdeltNameTokens(name: string): string[] {
  return foldedTokens(name)
    .map((token) => token.replace(NOT_A_WORD_CHARACTER, '').normalize('NFC'))
    .filter((token) => token !== '');
}

const REGION = /^[A-Z]{2}$/u;
/**
 * ISO 3166-1's user-assigned codes (AA, QM-QZ, XA-XZ, ZZ), which name no country; Kosovo's XK,
 * which `Intl` names, is kept.
 */
const USER_ASSIGNED = /^(?:AA|Q[M-Z]|X[A-JL-Z]|ZZ)$/u;
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

/** C81.2: a country as `sourcecountry:` names it, or `null` for a code that is not a region. */
export function gdeltSourceCountry(code: string): string | null {
  if (!REGION.test(code) || USER_ASSIGNED.test(code)) {
    return null;
  }
  let name: string | undefined;
  try {
    name = REGION_NAMES.of(code);
  } catch {
    name = undefined;
  }
  if (name === undefined || name === code) {
    return null;
  }
  const letters = gdeltNameTokens(name).join('');
  return letters === '' ? null : letters;
}

/** What the query is built from. */
export interface GdeltQueryParts {
  /** Each screened name's tokens ({@link gdeltNameTokens}). */
  names: readonly (readonly string[])[];
  /** The template's category terms (the authored lexicon, C81.3). */
  terms: readonly string[];
  /** ISO 3166-1 alpha-2. */
  country?: string | undefined;
}

/** A term or a name's words, reduced and joined by single spaces. */
function wordsOf(tokens: readonly string[]): string {
  return tokens.flatMap((token) => gdeltNameTokens(token)).join(' ');
}

/** `(a OR b)` of the items, a lone item bare. */
function orGroup(items: readonly string[]): string {
  return items.length === 1 ? (items[0] ?? '') : `(${items.join(' OR ')})`;
}

/**
 * C81.2: the DOC API `query` (see the file header).
 * @throws {RangeError} when no name has a word left.
 */
export function gdeltQuery(parts: GdeltQueryParts): string {
  const phrases = [...new Set(parts.names.map(wordsOf).filter((words) => words !== ''))].map(
    (words) => `"${words}"`,
  );
  if (phrases.length === 0) {
    throw new RangeError('the GDELT query has no name word (C81.2)');
  }
  const terms = [
    ...new Set(parts.terms.map((term) => wordsOf([term])).filter((term) => term !== '')),
  ].map((term) => (term.includes(' ') ? `"${term}"` : term));
  const country = parts.country === undefined ? null : gdeltSourceCountry(parts.country);
  return [
    orGroup(phrases),
    ...(terms.length === 0 ? [] : [orGroup(terms)]),
    ...(country === null ? [] : [`sourcecountry:${country}`]),
  ].join(' ');
}
