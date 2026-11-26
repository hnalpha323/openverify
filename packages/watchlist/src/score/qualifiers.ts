/**
 * C78.4: the qualifiers of a candidate, applied by the caller when its name score is at least
 * 0.70 (`qualifier-floor`): birth dates by C58.5 over every pair of subject and entry dates, the
 * most favourable taken (`dob_exact` +0.05, `dob_transposed` −0.10, `dob_day_disjoint` −0.25 when
 * both are full dates and none agree, `dob_year_disjoint` −0.15 when no year is shared, ranges and
 * circa dates allowed one year and, with `year_plus_minus_one`, any year), `country_mismatch` −0.10
 * when both sides state countries and none is shared, and `gender_mismatch` −0.10. A filter set to
 * `off` ignores its disagreement, `penalty` (the default) applies it, `strict` drops the
 * candidate (C79.1, decision 24).
 */
import { matchPartialDates } from '@openverify/checks';
import {
  REPORT_MATCH_QUALIFIERS,
  SCREENING_CONSTANTS,
  qualifierAdjustment,
  type BirthdateMatchingMode,
  type ReportFilterMode,
  type ReportMatchQualifier,
} from '@openverify/core';
import type { WatchlistRecord } from '../record/index.js';

export interface QualifierInput {
  /** The subject's birth dates: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
  readonly subjectBirthdates: readonly string[];
  readonly entryBirthdates: WatchlistRecord['birth_dates'];
  /** ISO 3166-1 alpha-2 codes. */
  readonly subjectCountries: readonly string[];
  readonly entryCountries: readonly string[];
  readonly subjectGender: 'female' | 'male' | null;
  readonly entryGender: 'female' | 'male' | null;
}

export interface QualifierOptions {
  readonly birthdateMatching: BirthdateMatchingMode;
  readonly birthdateFilter: ReportFilterMode;
  readonly countryFilter: ReportFilterMode;
  /** PEP (C80.5): with a strict birthdate filter, keep an entry that records no birth date. */
  readonly keepWithoutBirthdate?: boolean | undefined;
}

export interface Qualification {
  /** The qualifiers that apply, in the core order. */
  readonly qualifiers: readonly ReportMatchQualifier[];
  /** Their summed score change. */
  readonly adjustment: number;
  /** A strict filter drops the candidate. */
  readonly dropped: boolean;
}

type BirthDate = WatchlistRecord['birth_dates'][number];

/** How one pair of birth dates compares, from the most to the least favourable. */
const OUTCOMES = {
  exact: ['dob_exact'],
  neutral: [],
  transposed: ['dob_transposed'],
  year: ['dob_year_disjoint'],
  day: ['dob_day_disjoint'],
  dayAndYear: ['dob_day_disjoint', 'dob_year_disjoint'],
} as const satisfies Record<string, readonly ReportMatchQualifier[]>;
type Outcome = keyof typeof OUTCOMES;

const adjustmentOf = (qualifiers: readonly ReportMatchQualifier[]) =>
  qualifiers.reduce((total, qualifier) => total + qualifierAdjustment(qualifier), 0);

const yearOf = (value: string) => Number(value.slice(0, 4));

/** One subject date against one entry date. */
function compareDates(subject: string, entry: BirthDate, mode: BirthdateMatchingMode): Outcome {
  const circa = SCREENING_CONSTANTS['dob-circa-years'].value;
  const [from, to] =
    entry.range === undefined
      ? [yearOf(entry.value), yearOf(entry.value)]
      : [yearOf(entry.range.from) - circa, yearOf(entry.range.to) + circa];
  const slack = mode === 'year_plus_minus_one' ? circa : 0;
  const year = yearOf(subject);
  const yearsShared = year + slack >= from && year - slack <= to;
  if (subject.length === 10 && entry.precision === 'day' && entry.range === undefined) {
    const match = matchPartialDates(subject, entry.value);
    if (match.level === 'full') {
      return 'exact';
    }
    if (match.flags.includes('transposed')) {
      return 'transposed';
    }
    return yearsShared ? 'day' : 'dayAndYear';
  }
  return yearsShared ? 'neutral' : 'year';
}

/** The most favourable outcome over every pair of dates, or `null` without dates. */
function bestDateOutcome(input: QualifierInput, mode: BirthdateMatchingMode): Outcome | null {
  let best: Outcome | null = null;
  for (const subject of input.subjectBirthdates) {
    for (const entry of input.entryBirthdates) {
      const outcome = compareDates(subject, entry, mode);
      if (best === null || adjustmentOf(OUTCOMES[outcome]) > adjustmentOf(OUTCOMES[best])) {
        best = outcome;
      }
    }
  }
  return best;
}

const DISAGREEMENTS: ReadonlySet<Outcome> = new Set(['year', 'day', 'dayAndYear']);

/** The qualifiers of one candidate. */
export function qualify(input: QualifierInput, options: QualifierOptions): Qualification {
  const found = new Set<ReportMatchQualifier>();
  let dropped = false;
  const dates = bestDateOutcome(input, options.birthdateMatching);
  if (dates === null) {
    dropped ||=
      options.birthdateFilter === 'strict' &&
      options.keepWithoutBirthdate === false &&
      input.subjectBirthdates.length > 0 &&
      input.entryBirthdates.length === 0;
  } else {
    const disagrees =
      DISAGREEMENTS.has(dates) ||
      (dates === 'transposed' && options.birthdateMatching === 'exact_date');
    const ignored = options.birthdateFilter === 'off' && adjustmentOf(OUTCOMES[dates]) < 0;
    if (!ignored) {
      OUTCOMES[dates].forEach((qualifier) => found.add(qualifier));
    }
    dropped ||= options.birthdateFilter === 'strict' && disagrees;
  }
  const entryCountries = new Set(input.entryCountries);
  const countriesDisjoint =
    input.subjectCountries.length > 0 &&
    entryCountries.size > 0 &&
    !input.subjectCountries.some((country) => entryCountries.has(country));
  if (countriesDisjoint && options.countryFilter !== 'off') {
    found.add('country_mismatch');
    dropped ||= options.countryFilter === 'strict';
  }
  if (
    input.subjectGender !== null &&
    input.entryGender !== null &&
    input.subjectGender !== input.entryGender
  ) {
    found.add('gender_mismatch');
  }
  const qualifiers = REPORT_MATCH_QUALIFIERS.filter((qualifier) => found.has(qualifier));
  return { qualifiers, adjustment: adjustmentOf(qualifiers), dropped };
}
