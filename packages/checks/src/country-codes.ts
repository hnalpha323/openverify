/**
 * Country and issuer codes (C33). ISO 3166-1 comes from the generated `data/iso3166.ts`; the
 * ICAO Doc 9303 Part 3 §5 codes that machine-readable documents also use come from
 * `data/icao-codes.ts`. These are the only copies; Python never duplicates them.
 */
import { ICAO_PART3_SECTION5_CODES } from './data/icao-codes.js';
import { ISO3166_COUNTRIES } from './data/iso3166.js';

/** ISO 3166-1 alpha-2 to alpha-3, in alpha-2 order. */
export const ISO_ALPHA2_TO_ALPHA3: ReadonlyMap<string, string> = new Map(
  ISO3166_COUNTRIES.map(([alpha2, alpha3]) => [alpha2, alpha3]),
);

const ISO_ALPHA3_TO_ALPHA2: ReadonlyMap<string, string> = new Map(
  ISO3166_COUNTRIES.map(([alpha2, alpha3]) => [alpha3, alpha2]),
);

const ICAO_CODES: ReadonlyMap<string, string | null> = new Map(
  ICAO_PART3_SECTION5_CODES.map((entry) => [entry.code, entry.alpha2]),
);

/** Codes whose MRZ form is not the ISO alpha-3 code. */
const ICAO_ALIASES: Readonly<Record<string, string>> = {
  D: 'DEU',
  XK: 'RKS',
};

/** Upper-cased, trimmed, trailing MRZ fillers removed. */
function clean(code: string): string {
  return code.trim().toUpperCase().replace(/<+$/, '');
}

/**
 * Normalizes an ISO alpha-2, ISO alpha-3 or ICAO MRZ country code (trailing
 * fillers allowed, any case) to a three-letter code. Three-letter codes pass
 * through, so ICAO-only codes such as UTO, XXA or RKS are kept. Returns `null`
 * for anything that is not a known two-letter code, `D`, or three letters.
 */
export function normalizeCountryCode(code: string): string | null {
  const upper = clean(code);
  if (!/^[A-Z]{1,3}$/.test(upper)) {
    return null;
  }
  const alias = ICAO_ALIASES[upper];
  if (alias) {
    return alias;
  }
  if (upper.length === 3) {
    return upper;
  }
  return ISO_ALPHA2_TO_ALPHA3.get(upper) ?? null;
}

/**
 * The ISO alpha-2 country of an ISO alpha-3 or ICAO issuer or nationality code: `D` is `DE` and
 * `RKS` is `XK`. Any other §5 code (an organisation or a status), an unknown code and the specimen
 * state Utopia (`UTO`) have no country, so `null` (C30.7).
 */
export function alpha3ToAlpha2(code: string): string | null {
  const upper = clean(code);
  return ISO_ALPHA3_TO_ALPHA2.get(upper) ?? ICAO_CODES.get(upper) ?? null;
}

/**
 * Whether a code may stand as an issuing state or nationality in an MRZ: an ISO alpha-3 code or a
 * Part 3 §5 code. Utopia (`UTO`) is the specimen state of the examples, not an issuer.
 */
export function isIcaoIssuerCode(code: string): boolean {
  const upper = clean(code);
  return ISO_ALPHA3_TO_ALPHA2.has(upper) || ICAO_CODES.has(upper);
}
