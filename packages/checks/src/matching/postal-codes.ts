/**
 * Postal codes (C58.4): canonical form, validation against the country's libaddressinput pattern
 * (`postal-codes.json`, CC BY 4.0, attributed in `data/NOTICE`), and comparison. A pattern is
 * applied anchored to a code of at most 20 characters, so no pattern can run long.
 */

import { z } from 'zod';
import { ISO_ALPHA2_TO_ALPHA3, alpha3ToAlpha2 } from '../country-codes.js';
import { presentText } from '../result.js';
import { readMatchingData } from './data-files.js';
import { capText } from './limits.js';

/** How two components of an address compare. */
export type ComponentMatch = 'exact' | 'fuzzy' | 'mismatch' | 'one-sided' | 'absent';

/** No postal code is longer; a longer value is not one (and is never matched). */
const MAX_POSTAL_CODE_LENGTH = 20;
/** The longest line searched for a code (a document line, C58.7). */
const MAX_LINE_LENGTH = 300;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const ZIP = /^\d{5}(?:\d{4})?$/;

/** An ISO 3166-1 alpha-2 code from an alpha-2 or alpha-3 one; `null` for anything else. */
export function countryAlpha2(code: string | null | undefined): string | null {
  const text = presentText(code)?.toUpperCase() ?? null;
  if (text === null) {
    return null;
  }
  if (/^[A-Z]{2}$/.test(text)) {
    return ISO_ALPHA2_TO_ALPHA3.has(text) ? text : null;
  }
  return /^[A-Z]{3}$/.test(text) ? alpha3ToAlpha2(text) : null;
}

const postalCodesSchema = z.object({
  countries: z.record(
    z.string(),
    z.object({ pattern: z.string().min(1), examples: z.array(z.string()) }),
  ),
});

interface CountryPattern {
  readonly anchored: RegExp;
  readonly search: RegExp;
}

let patterns: ReadonlyMap<string, CountryPattern> | undefined;

function patternOf(country: string | null): CountryPattern | null {
  if (patterns === undefined) {
    const { countries } = postalCodesSchema.parse(readMatchingData('postal-codes.json'));
    patterns = new Map(
      Object.entries(countries).map(([code, { pattern }]) => [
        code,
        {
          anchored: new RegExp(`^(?:${pattern})$`),
          search: new RegExp(`(?:^|[\\s,])(${pattern})(?=$|[\\s,])`),
        },
      ]),
    );
  }
  return country === null ? null : (patterns.get(country) ?? null);
}

/** A postal code as compared: upper case, letters and digits only. */
export function canonicalPostalCode(code: string): string {
  return capText(code, 64)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

/** Whether a code fits its country's pattern; `null` for a country without one. */
export function isValidPostalCode(code: string, country: string): boolean | null {
  const pattern = patternOf(countryAlpha2(country));
  if (pattern === null) {
    return null;
  }
  const text = code.trim().toUpperCase();
  return text.length <= MAX_POSTAL_CODE_LENGTH && pattern.anchored.test(text);
}

/**
 * Two postal codes of one country: `exact` when canonically equal (a US ZIP+4 against its
 * five-digit ZIP too), `fuzzy` for two ZIP+4 codes of one ZIP, `mismatch` otherwise; `absent`
 * or `one-sided` when either has none.
 */
export function comparePostalCodes(
  a: string | null | undefined,
  b: string | null | undefined,
  country: string | null,
): ComponentMatch {
  const left = presentText(a);
  const right = presentText(b);
  if (left === null || right === null) {
    return left === null && right === null ? 'absent' : 'one-sided';
  }
  const x = canonicalPostalCode(left);
  const y = canonicalPostalCode(right);
  if (x === y) {
    return 'exact';
  }
  const alpha2 = countryAlpha2(country);
  if (
    (alpha2 === 'US' || alpha2 === null) &&
    ZIP.test(x) &&
    ZIP.test(y) &&
    x.slice(0, 5) === y.slice(0, 5)
  ) {
    return x.length === y.length ? 'fuzzy' : 'exact';
  }
  return 'mismatch';
}

/** The first code of `country`'s pattern found as a whole word in a line, or `null`. */
export function findPostalCode(line: string, country: string): string | null {
  const pattern = patternOf(countryAlpha2(country));
  if (pattern === null) {
    return null;
  }
  return pattern.search.exec(capText(line, MAX_LINE_LENGTH).toUpperCase())?.[1] ?? null;
}
