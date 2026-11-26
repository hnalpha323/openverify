/** C78.4: birth date, country and gender qualifiers and the filters (C79.1). */
import { describe, expect, it } from 'vitest';
import type { WatchlistRecord } from '../record/index.js';
import { qualify, type QualifierInput, type QualifierOptions } from './index.js';

type BirthDate = WatchlistRecord['birth_dates'][number];
const day = (value: string): BirthDate => ({ value, precision: 'day' });
const year = (value: string, range?: { from: string; to: string }): BirthDate =>
  range === undefined ? { value, precision: 'year' } : { value, precision: 'year', range };

const NONE: QualifierInput = {
  subjectBirthdates: [],
  entryBirthdates: [],
  subjectCountries: [],
  entryCountries: [],
  subjectGender: null,
  entryGender: null,
};
const PENALTY: QualifierOptions = {
  birthdateMatching: 'year_plus_minus_one',
  birthdateFilter: 'penalty',
  countryFilter: 'penalty',
};
const dates = (subject: string[], entry: BirthDate[], options = PENALTY) =>
  qualify({ ...NONE, subjectBirthdates: subject, entryBirthdates: entry }, options);

describe('birth dates', () => {
  it('adds 0.05 for an exact date and nothing without dates', () => {
    expect(dates(['1980-05-17'], [day('1980-05-17')])).toEqual({
      qualifiers: ['dob_exact'],
      adjustment: 0.05,
      dropped: false,
    });
    expect(qualify(NONE, PENALTY)).toEqual({ qualifiers: [], adjustment: 0, dropped: false });
  });

  it('takes 0.10 for day and month transposed, 0.25 for a disjoint day, 0.40 with another year', () => {
    expect(dates(['1980-05-07'], [day('1980-07-05')]).qualifiers).toEqual(['dob_transposed']);
    const disjoint = dates(['1980-05-17'], [day('1980-06-20')]);
    expect(disjoint.qualifiers).toEqual(['dob_day_disjoint']);
    expect(disjoint.adjustment).toBeCloseTo(-0.25, 10);
    const apart = dates(['1980-05-17'], [day('1990-01-01')]);
    expect(apart.qualifiers).toEqual(['dob_day_disjoint', 'dob_year_disjoint']);
    expect(apart.adjustment).toBeCloseTo(-0.4, 10);
  });

  it('allows a year either side with year_plus_minus_one, and ranges a year either side always', () => {
    expect(dates(['1980'], [day('1981-02-02')]).qualifiers).toEqual([]);
    expect(
      dates(['1980'], [day('1981-02-02')], { ...PENALTY, birthdateMatching: 'exact_year' })
        .qualifiers,
    ).toEqual(['dob_year_disjoint']);
    const range = year('1975', { from: '1975', to: '1977' });
    expect(
      dates(['1978-01-01'], [range], { ...PENALTY, birthdateMatching: 'exact_year' }).qualifiers,
    ).toEqual([]);
    expect(dates(['1980'], [range]).qualifiers).toEqual(['dob_year_disjoint']);
  });

  it('takes the most favourable pair of dates', () => {
    expect(dates(['1980-05-17'], [day('1990-01-01'), day('1980-05-17')]).qualifiers).toEqual([
      'dob_exact',
    ]);
    expect(dates(['1980-05-17'], [day('1980-06-20'), year('1980')]).qualifiers).toEqual([]);
  });

  it('ignores a disagreement with filter off and drops the candidate with strict', () => {
    const off = dates(['1980-05-17'], [day('1990-01-01')], { ...PENALTY, birthdateFilter: 'off' });
    expect(off).toEqual({ qualifiers: [], adjustment: 0, dropped: false });
    expect(
      dates(['1980-05-17'], [day('1990-01-01')], { ...PENALTY, birthdateFilter: 'strict' }).dropped,
    ).toBe(true);
    expect(
      dates(['1980-05-17'], [day('1980-05-17')], { ...PENALTY, birthdateFilter: 'strict' }).dropped,
    ).toBe(false);
    expect(
      dates(['1980-05-07'], [day('1980-07-05')], {
        ...PENALTY,
        birthdateFilter: 'strict',
        birthdateMatching: 'exact_date',
      }).dropped,
    ).toBe(true);
  });

  it('keeps an entry without a birth date under strict unless keep-without-birthdate is false', () => {
    const strict = { ...PENALTY, birthdateFilter: 'strict' } as const;
    expect(dates(['1980'], [], strict).dropped).toBe(false);
    expect(dates(['1980'], [], { ...strict, keepWithoutBirthdate: false }).dropped).toBe(true);
  });
});

describe('countries and gender', () => {
  const countries = (subject: string[], entry: string[], options = PENALTY) =>
    qualify({ ...NONE, subjectCountries: subject, entryCountries: entry }, options);

  it('takes 0.10 when both sides state countries and none is shared', () => {
    expect(countries(['GB'], ['FR', 'DE'])).toEqual({
      qualifiers: ['country_mismatch'],
      adjustment: -0.1,
      dropped: false,
    });
    expect(countries(['GB'], ['FR', 'GB']).qualifiers).toEqual([]);
    expect(countries(['GB'], []).qualifiers).toEqual([]);
    expect(countries(['GB'], ['FR'], { ...PENALTY, countryFilter: 'off' }).qualifiers).toEqual([]);
    expect(countries(['GB'], ['FR'], { ...PENALTY, countryFilter: 'strict' }).dropped).toBe(true);
  });

  it('takes 0.10 when both genders are recorded and differ', () => {
    expect(
      qualify({ ...NONE, subjectGender: 'female', entryGender: 'male' }, PENALTY).qualifiers,
    ).toEqual(['gender_mismatch']);
    expect(qualify({ ...NONE, subjectGender: 'female' }, PENALTY).qualifiers).toEqual([]);
  });

  it('sums every qualifier in the core order', () => {
    const all = qualify(
      {
        subjectBirthdates: ['1980-05-17'],
        entryBirthdates: [day('1980-05-17')],
        subjectCountries: ['GB'],
        entryCountries: ['FR'],
        subjectGender: 'female',
        entryGender: 'male',
      },
      PENALTY,
    );
    expect(all.qualifiers).toEqual(['dob_exact', 'country_mismatch', 'gender_mismatch']);
    expect(all.adjustment).toBeCloseTo(0.05 - 0.1 - 0.1, 10);
  });
});
