/**
 * C78.3, C79.2: identifier normalisation, the same on the list side (`watchlist_identifiers.
 * value_normalised`) and the query side, so identifier retrieval is an exact lookup on
 * `(kind, value_normalised)`:
 * - document, tax and registration numbers, aircraft serials and tails: letters and digits, upper
 *   case;
 * - LEI: 20 characters with the ISO 17442 check (mod 97 equals 1);
 * - SWIFT/BIC: its first 8 characters (an 11-character BIC names a branch of the same bank);
 * - IMO: 7 digits with the check digit (the sum of the first six digits times 7 down to 2, mod
 *   10);
 * - MMSI: 9 digits;
 * - website: the host, lower case, without `www.` (IDN as punycode);
 * - email: lower case.
 *
 * A check that fails keeps the value (an exact match of a mistyped number is still exact) and
 * says so; a value with nothing left is `null`.
 */
import type { IDENTIFIER_KINDS, WatchlistRecord } from '../record/index.js';

/** The version of these rules; `keysVersion` joins it (V04). */
export const IDENTIFIER_NORMALISER_VERSION = 'identifiers-1';

export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

export interface NormalisedIdentifier {
  readonly kind: IdentifierKind;
  readonly value: string;
  /** ISO 3166-1 alpha-2, upper case, or `null`. */
  readonly country: string | null;
  /** The kind's check: `valid`, `invalid`, or `none` for a kind without one. */
  readonly check: 'valid' | 'invalid' | 'none';
}

const COUNTRY = /^[A-Z]{2}$/u;
const LEI = /^[0-9A-Z]{18}\d{2}$/u;
const BIC = /^[A-Z]{6}[A-Z0-9]{2}$/u;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;
const EMAIL = /^[^@\s]+@[^@\s]+$/u;

/** Letters and digits, upper case, marks folded away. */
const compact = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/gu, '');

const digits = (value: string) => value.replace(/\D/gu, '');

/** ISO 17442: the 20 characters as base-36 digits, mod 97, equal 1. */
function leiCheck(value: string): 'valid' | 'invalid' {
  if (!LEI.test(value)) {
    return 'invalid';
  }
  let remainder = 0;
  for (const character of value) {
    for (const digit of String(Number.parseInt(character, 36))) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1 ? 'valid' : 'invalid';
}

/** The IMO check digit: the first six digits times 7 down to 2, summed, mod 10. */
function imoCheck(value: string): 'valid' | 'invalid' {
  if (value.length !== 7) {
    return 'invalid';
  }
  const sum = Array.from(value.slice(0, 6)).reduce(
    (total, digit, index) => total + Number(digit) * (7 - index),
    0,
  );
  return sum % 10 === Number(value[6]) ? 'valid' : 'invalid';
}

/** A website's host, lower case, without `www.` or a final dot; `null` for no domain. */
function websiteHost(value: string): string | null {
  const text = value.trim();
  let url: URL;
  try {
    url = new URL(SCHEME.test(text) ? text : `http://${text}`);
  } catch {
    return null;
  }
  let host = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (host.startsWith('www.')) {
    host = host.slice(4);
  }
  return host.includes('.') && !host.startsWith('.') ? host : null;
}

function normalisedValue(
  kind: IdentifierKind,
  value: string,
): Pick<NormalisedIdentifier, 'value' | 'check'> | null {
  switch (kind) {
    case 'lei': {
      const lei = compact(value);
      return lei === '' ? null : { value: lei, check: leiCheck(lei) };
    }
    case 'swift_bic': {
      const bic = compact(value);
      const head = bic.slice(0, 8);
      return bic === '' ? null : { value: head, check: BIC.test(head) ? 'valid' : 'invalid' };
    }
    case 'imo': {
      const imo = digits(value);
      return imo === '' ? null : { value: imo, check: imoCheck(imo) };
    }
    case 'mmsi': {
      const mmsi = digits(value);
      return mmsi === '' ? null : { value: mmsi, check: mmsi.length === 9 ? 'valid' : 'invalid' };
    }
    case 'website': {
      const host = websiteHost(value);
      return host === null ? null : { value: host, check: 'none' };
    }
    case 'email': {
      const email = value.trim().toLowerCase();
      return EMAIL.test(email) ? { value: email, check: 'none' } : null;
    }
    default: {
      const text = compact(value);
      return text === '' ? null : { value: text, check: 'none' };
    }
  }
}

/** Normalises one identifier; `null` when nothing comparable is left. */
export function normaliseIdentifier(
  kind: IdentifierKind,
  value: string,
  country?: string | null,
): NormalisedIdentifier | null {
  const normalised = normalisedValue(kind, value);
  if (normalised === null) {
    return null;
  }
  const code = (country ?? '').trim().toUpperCase();
  return { kind, ...normalised, country: COUNTRY.test(code) ? code : null };
}

/** The `watchlist_identifiers` rows of a record: each identifier normalised, duplicates dropped. */
export function recordIdentifierRows(
  record: Pick<WatchlistRecord, 'identifiers'>,
): NormalisedIdentifier[] {
  const rows = new Map<string, NormalisedIdentifier>();
  for (const identifier of record.identifiers) {
    const row = normaliseIdentifier(identifier.kind, identifier.value, identifier.country);
    if (row !== null) {
      const key = JSON.stringify([row.kind, row.value, row.country]);
      if (!rows.has(key)) {
        rows.set(key, row);
      }
    }
  }
  return [...rows.values()];
}
