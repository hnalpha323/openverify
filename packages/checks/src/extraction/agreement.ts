/**
 * The agreement rules every check that compares sources shares (C31.2):
 * - an absent field is never a mismatch (callers compare only fields both sides read);
 * - dates and numbers compare exactly, position by position, with the confusables `O`/`0`,
 *   `I`/`1`, `S`/`5`, `B`/`8` and `Z`/`2` taken as equal;
 * - names compare after ICAO transliteration, token by token, with Jaro-Winkler at least 0.92;
 * - codes compare exactly, ICAO issuer codes as countries (`D` is `DEU`), and an AAMVA IIN is
 *   never compared with an ICAO code; addresses after normalization.
 */
import type { ExtractionField } from '@openverify/core';
import { normalizeCountryCode } from '../country-codes.js';
import { jaroWinkler } from '../name-matching.js';

/** The Jaro-Winkler score at or above which two name tokens agree (C31.2). */
export const NAME_TOKEN_THRESHOLD = 0.92;

const CONFUSABLE: Readonly<Record<string, string>> = {
  O: '0',
  '0': 'O',
  I: '1',
  '1': 'I',
  S: '5',
  '5': 'S',
  B: '8',
  '8': 'B',
  Z: '2',
  '2': 'Z',
};

/** Equal length, and every position equal or a confusable pair (C31.2). */
export function confusableEqual(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a.charAt(index);
    const right = b.charAt(index);
    if (left !== right && CONFUSABLE[left] !== right) {
      return false;
    }
  }
  return true;
}

/**
 * ICAO 9303-3 transliterations that are not plain diacritic removal (§6.A). Exported unchanged
 * for the watchlist matcher's fold (Phase 6, C78.1, F21).
 */
export const ICAO_LATIN_TRANSLITERATIONS: Readonly<Record<string, string>> = Object.freeze({
  Æ: 'AE',
  Œ: 'OE',
  Þ: 'TH',
  Ð: 'D',
  Đ: 'D',
  Ł: 'L',
  Ħ: 'H',
});
/**
 * Letters with two MRZ forms: expanded (Ä → AE) or simplified (Ä → A). ICAO writes Ø as OE; the
 * simplified O is accepted too, since issuers have used it. Exported unchanged (C78.1, F21).
 */
export const ICAO_LATIN_EXPANDED_FORMS: Readonly<Record<string, string>> = Object.freeze({
  Ä: 'AE',
  Ö: 'OE',
  Ü: 'UE',
  Å: 'AA',
  Ø: 'OE',
});
const ALWAYS = ICAO_LATIN_TRANSLITERATIONS;
const EXPANDED = ICAO_LATIN_EXPANDED_FORMS;

/** A name's tokens under each permitted transliteration: expanded, then simplified. */
function renderings(name: string): string[][] {
  const render = (expand: boolean): string[] => {
    let text = name.toUpperCase();
    text = expand
      ? text.replace(/[ÄÖÜÅØ]/g, (letter) => EXPANDED[letter] ?? letter)
      : text.replace(/Ø/g, 'O');
    return text
      .replace(/[ÆŒÞÐĐŁĦ]/g, (letter) => ALWAYS[letter] ?? letter)
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .replace(/['’‘`´ʼ]/g, '')
      .split(/[^A-Z]+/)
      .filter(Boolean);
  };
  return [render(true), render(false)];
}

const tokenAgrees = (a: string, b: string, threshold: number): boolean =>
  a === b || jaroWinkler(a, b) >= threshold;

/**
 * One to one and in order: the same number of tokens, each agreeing. When `a` is an MRZ name its
 * full field may have cut (ICAO 9303 Part 3), its tokens may be cut short, down to initials, and
 * its trailing tokens missing; never the other way round, and never for any other name (G007).
 */
function tokensPair(
  a: readonly string[],
  b: readonly string[],
  threshold: number,
  truncated: boolean,
): boolean {
  return (
    a.length > 0 &&
    (truncated ? a.length <= b.length : a.length === b.length) &&
    a.every((token, index) => {
      const other = b[index] ?? '';
      return tokenAgrees(token, other, threshold) || (truncated && other.startsWith(token));
    })
  );
}

/** Every token of the shorter list agrees with a distinct token of the longer one, in any order. */
function tokensCovered(a: readonly string[], b: readonly string[], threshold: number): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length === 0) {
    return false;
  }
  const free = [...longer];
  return shorter.every((token) => {
    const index = free.findIndex((candidate) => tokenAgrees(candidate, token, threshold));
    if (index === -1) {
      return false;
    }
    free.splice(index, 1);
    return true;
  });
}

export interface NamesAgreeOptions {
  /** Jaro-Winkler per token; defaults to 0.92 (C31.2). */
  threshold?: number | undefined;
  /**
   * Let one name leave tokens out or order them differently, as user data does (a middle name not
   * entered). Off between document sources, which print the same name.
   */
  allowMissingTokens?: boolean | undefined;
  /**
   * `a` is an MRZ name whose field was full, so ICAO 9303 may have cut it: its tokens may be cut
   * short, down to initials, and its trailing tokens left out (G007). Off for every other name.
   */
  truncated?: boolean | undefined;
}

/**
 * Whether two names agree (C31.2): after ICAO transliteration (either permitted form), token by
 * token with Jaro-Winkler at least the threshold. Between document sources the tokens pair one to
 * one and in order, an MRZ name its full field cut (`truncated`) aside; with `allowMissingTokens`
 * every token of the shorter name needs an agreeing token of the longer one. An empty name never
 * agrees.
 */
export function namesAgree(
  a: string,
  b: string,
  options: number | NamesAgreeOptions = {},
): boolean {
  const {
    threshold = NAME_TOKEN_THRESHOLD,
    allowMissingTokens = false,
    truncated = false,
  } = typeof options === 'number' ? { threshold: options } : options;
  const agree = (left: readonly string[], right: readonly string[]): boolean =>
    allowMissingTokens
      ? tokensCovered(left, right, threshold)
      : tokensPair(left, right, threshold, truncated);
  return renderings(a).some((left) => renderings(b).some((right) => agree(left, right)));
}

const alphanumeric = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

const ADDRESS_WORDS: Readonly<Record<string, string>> = {
  AVENUE: 'AVE',
  AV: 'AVE',
  STREET: 'ST',
  ROAD: 'RD',
  BOULEVARD: 'BLVD',
  DRIVE: 'DR',
  LANE: 'LN',
  COURT: 'CT',
  PLACE: 'PL',
  APARTMENT: 'APT',
  SUITE: 'STE',
  CRESCENT: 'CRES',
};

function addressTokens(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((token) => ADDRESS_WORDS[token] ?? token);
}

/** Same tokens in order: numbers exactly, words with Jaro-Winkler at least 0.92. */
function addressesAgree(a: string, b: string): boolean {
  const left = addressTokens(a);
  const right = addressTokens(b);
  return (
    left.length > 0 &&
    left.length === right.length &&
    left.every((token, index) => {
      const other = right[index] ?? '';
      return /\d/.test(token) || /\d/.test(other)
        ? token === other
        : jaroWinkler(token, other) >= NAME_TOKEN_THRESHOLD;
    })
  );
}

function postalCodesAgree(a: string, b: string): boolean {
  const left = alphanumeric(a);
  const right = alphanumeric(b);
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return (
    shorter.length > 0 &&
    (shorter === longer || (shorter.length >= 5 && longer.startsWith(shorter)))
  );
}

/**
 * The scheme of an `issuing-authority-code` (C31.5): an AAMVA IIN (six digits) or an ICAO code
 * (one to three letters, `D` for Germany); `null` for anything else.
 */
function issuerScheme(code: string): 'aamva' | 'icao' | null {
  const upper = code.trim().toUpperCase();
  if (/^\d{6}$/.test(upper)) {
    return 'aamva';
  }
  return /^[A-Z]{1,3}$/.test(upper) ? 'icao' : null;
}

/**
 * Whether two readings of one field can be compared at all (Workflow 3B review, G004). Only
 * `issuing-authority-code` has readings that cannot: C31.5 lets it hold an AAMVA IIN or an ICAO
 * code, and no rule maps one to the other (a licence's IIN names its jurisdiction, the country
 * code its header prints names a state). Readings of different schemes are neither agreement
 * nor disagreement.
 */
export function fieldsComparable(field: ExtractionField, a: string, b: string): boolean {
  if (field !== 'issuing-authority-code') {
    return true;
  }
  const scheme = issuerScheme(a);
  return scheme === issuerScheme(b);
}

/** ICAO codes compare as countries (`D` is `DEU`); anything else exactly. */
function issuerCodesAgree(a: string, b: string): boolean {
  if (issuerScheme(a) === 'icao' && issuerScheme(b) === 'icao') {
    const left = normalizeCountryCode(a);
    if (left !== null) {
      return left === normalizeCountryCode(b);
    }
  }
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/**
 * Whether two readings of one field agree under the C31.2 rules. Callers compare only readings
 * that {@link fieldsComparable} allows; readings of different issuer schemes never agree.
 * `truncated` names the reading that is an MRZ name its full field may have cut (G007).
 */
export function fieldsAgree(
  field: ExtractionField,
  a: string,
  b: string,
  truncated?: 'a' | 'b',
): boolean {
  switch (field) {
    case 'birthdate':
    case 'issue-date':
    case 'expiration-date':
      return confusableEqual(a.trim(), b.trim());
    case 'identification-number':
    case 'personal-number':
      return confusableEqual(alphanumeric(a), alphanumeric(b));
    case 'name-first':
    case 'name-middle':
    case 'name-last':
      return truncated === 'b'
        ? namesAgree(b, a, { truncated: true })
        : namesAgree(a, b, { truncated: truncated === 'a' });
    case 'nationality': {
      const left = normalizeCountryCode(a);
      return left !== null && left === normalizeCountryCode(b);
    }
    case 'address-postal-code':
      return postalCodesAgree(a, b);
    case 'address-street-1':
    case 'address-street-2':
    case 'address-city':
      return addressesAgree(a, b);
    case 'issuing-authority-code':
      return fieldsComparable(field, a, b) && issuerCodesAgree(a, b);
    case 'sex':
    case 'address-subdivision':
    case 'address-country-code':
    case 'endorsements':
    case 'restrictions':
    case 'vehicle-class':
      return a.trim().toUpperCase() === b.trim().toUpperCase();
  }
}
