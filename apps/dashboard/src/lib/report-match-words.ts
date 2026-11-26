/**
 * Report matches in words (C75, C78.4, C78.5, C86): how a match was made (its match types, the
 * name pair's level and methods, the qualifiers with the score change each applies) and where it
 * stands (its status, review status and risk level). Keyed by the contract vocabularies; each
 * test iterates the contract's list first. A method the console has no words for shows as its
 * code.
 */
import {
  qualifierAdjustment,
  type MATCH_LEVELS,
  type ReportMatchQualifier,
  type ReportMatchStatus,
  type ReportMatchType,
  type ReportReviewStatus,
  type ReportRiskLevel,
} from '@openverify/core';

export type MatchLevel = (typeof MATCH_LEVELS)[number];

/** C78.5: the public `match-types`, plus ours (the weak alias and the media title types). */
export const REPORT_MATCH_TYPE_WORDS: Readonly<Record<ReportMatchType, string>> = Object.freeze({
  name_exact: 'Name equal after normalisation',
  name_fuzzy: 'Name similar',
  birthdate_exact: 'Date of birth equal',
  identifier_exact: 'Identifier equal',
  crypto_address_exact: 'Crypto address equal',
  weak_alias: 'Weak alias, corroborated',
  title_full_name: 'Whole name in the title',
  title_all_tokens: 'Every name token in the title',
});

/** C78.4: the qualifiers a match records beside its name score. */
export const REPORT_MATCH_QUALIFIER_WORDS: Readonly<Record<ReportMatchQualifier, string>> =
  Object.freeze({
    dob_day_disjoint: 'Birth dates differ by more than a day',
    dob_transposed: 'Day and month of birth swapped',
    dob_year_disjoint: 'Birth years differ',
    dob_exact: 'Date of birth equal',
    country_mismatch: 'Countries differ',
    gender_mismatch: 'Genders differ',
  });

/** How far the matched name pair agreed (C58's levels). */
export const MATCH_LEVEL_LABELS: Readonly<Record<MatchLevel, string>> = Object.freeze({
  full: 'Full',
  partial: 'Partial',
  none: 'None',
  missing: 'Missing',
});

/** C75.8: an open match counts in `has-match`; a dismissed or delisted one does not. */
export const REPORT_MATCH_STATUS_LABELS: Readonly<Record<ReportMatchStatus, string>> =
  Object.freeze({
    open: 'Open',
    dismissed: 'Dismissed',
    delisted: 'Delisted',
  });

export const REPORT_REVIEW_STATUS_LABELS: Readonly<Record<ReportReviewStatus, string>> =
  Object.freeze({
    pending: 'Not reviewed',
    indeterminate: 'Indeterminate',
    true_positive: 'True positive',
    false_positive: 'False positive',
  });

export const REPORT_RISK_LEVEL_LABELS: Readonly<Record<ReportRiskLevel, string>> = Object.freeze({
  material: 'Material',
  immaterial: 'Immaterial',
});

/**
 * The methods a match's `components.methods` names (the matcher's name-score methods, kebab-case,
 * and the identifier, weak-alias and crypto rules). Not a contract list: one without words shows
 * as its code.
 */
const MATCH_METHOD_WORDS: ReadonlyMap<string, string> = new Map([
  ['equal', 'Equal after normalisation'],
  ['original-script', 'Equal in the original script'],
  ['icao-transliteration', 'Equal after ICAO transliteration'],
  ['lossy-transliteration', 'Lossy transliteration (score capped)'],
  ['variant-group', 'Same name in a variant group'],
  ['nickname', 'Nickname'],
  ['initial', 'Initial'],
  ['typo', 'A typo within the budget'],
  ['legal-form', 'Legal form'],
  ['joined', 'Joined tokens'],
  ['subset', 'Subset of the longer name'],
  ['role-swap', 'Given and family names swapped'],
  ['identifier-exact', 'Identifier equal'],
  ['weak-alias', 'Weak alias, corroborated'],
  ['crypto-address-exact', 'Crypto address equal'],
]);

/** The words of a match method, or `undefined` for one the console has no words for. */
export function matchMethodWords(method: string): string | undefined {
  return MATCH_METHOD_WORDS.get(method);
}

const signed = (value: number) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(2)}`;

/** A qualifier with the score change it applied, such as "Countries differ (−0.10)". */
export function qualifierText(qualifier: ReportMatchQualifier): string {
  return `${REPORT_MATCH_QUALIFIER_WORDS[qualifier]} (${signed(qualifierAdjustment(qualifier))})`;
}
