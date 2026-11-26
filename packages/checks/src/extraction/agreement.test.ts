import { describe, expect, it } from 'vitest';
import { NAME_TOKEN_THRESHOLD, confusableEqual, fieldsAgree, namesAgree } from './agreement.js';

describe('confusableEqual (C31.2)', () => {
  it.each([
    ['X12K45P78', 'X12K45P78'],
    ['X12K45P78', 'X12K4SP78'],
    ['L898902C3', 'L8989O2C3'],
    ['1990-02-14', 'I990-O2-14'],
    ['B8', '88'],
    ['Z2', '22'],
  ])('treats %j and %j as equal', (a, b) => {
    expect(confusableEqual(a, b)).toBe(true);
  });

  it.each([
    ['X12K45P78', 'X12K45P79'],
    ['X12K45P78', 'X12K45P7'],
    ['1990-02-14', '1990-02-15'],
    ['O', 'Q'],
    ['', 'A'],
  ])('tells %j from %j', (a, b) => {
    expect(confusableEqual(a, b)).toBe(false);
  });
});

describe('namesAgree (C31.2)', () => {
  it('uses Jaro-Winkler 0.92 per token', () => {
    expect(NAME_TOKEN_THRESHOLD).toBe(0.92);
  });

  it.each([
    ['VALEMONT', 'Valemont'],
    ['ANNA MARIA', 'Anna María'],
    ['MUELLER', 'Müller'],
    ['MULLER', 'Müller'],
    ['OBRIEN', "O'Brien"],
    ['SORENSEN', 'Sørensen'],
    ['SOERENSEN', 'Sørensen'],
    ['JOHANSSON', 'JOHANSON'],
    ['STROSS', 'Stroß'],
  ])('agrees on %j and %j', (a, b) => {
    expect(namesAgree(a, b)).toBe(true);
  });

  it.each([
    ['VALEMONT', 'VALENTINE'],
    ['QUINN', 'ROBIN'],
    ['ANNA', 'HANNAH'],
    ['', 'ANNA'],
    ['ANNA', '   '],
    // G007: a name that only starts like the other is another name, unless the MRZ cut it.
    // (SMITH and SMITHSON agree under C31.2 itself: their Jaro-Winkler is 0.925.)
    ['DOE', 'DOEBERT'],
    ['KIM', 'KIMBERLY'],
    ['LEE', 'LEEDS'],
    ['D', 'DOE'],
    ['ALEXANDRA B', 'Alexandra Beatrix'],
  ])('disagrees on %j and %j', (a, b) => {
    expect(namesAgree(a, b)).toBe(false);
  });

  it('pairs tokens one to one and in order between sources, none cut short', () => {
    expect(namesAgree('QUINN', 'QUINN ALEX')).toBe(false);
    expect(namesAgree('MARIA ANNA', 'ANNA MARIA')).toBe(false);
    expect(namesAgree('ANNA M', 'ANNA MARIA')).toBe(false);
    expect(namesAgree('A MARIA', 'ANNA MARIA')).toBe(false);
  });

  it('lets an MRZ name whose field was full be cut short, down to initials, and nothing else (G007)', () => {
    const truncated = { truncated: true };
    expect(namesAgree('ALEXANDRA B', 'Alexandra Beatrix', truncated)).toBe(true);
    expect(namesAgree('VANDERBERGHEHOFFMANNSCHMID', 'Vanderberghehoffmannschmidt', truncated)).toBe(
      true,
    );
    expect(namesAgree('ANNA', 'ANNA MARIA', truncated)).toBe(true);
    expect(namesAgree('A M', 'ANNA MARIA', truncated)).toBe(true);
    expect(namesAgree('ANNA MARIA', 'ANNA', truncated)).toBe(false);
    expect(namesAgree('ALEXANDRA C', 'Alexandra Beatrix', truncated)).toBe(false);
    expect(namesAgree('Alexandra Beatrix', 'ALEXANDRA B', truncated)).toBe(false);
  });

  it('lets user data leave tokens out or reorder them when asked', () => {
    const lenient = { allowMissingTokens: true };
    expect(namesAgree('QUINN', 'QUINN ALEX', lenient)).toBe(true);
    expect(namesAgree('MARIA ANNA', 'ANNA MARIA', lenient)).toBe(true);
    expect(namesAgree('ROBIN', 'QUINN ALEX', lenient)).toBe(false);
  });

  it('takes a lower threshold when asked (comparisons with user data)', () => {
    expect(namesAgree('JONATHAN', 'JONATAN', 0.92)).toBe(true);
    expect(namesAgree('STEPHEN', 'STEVEN', 0.92)).toBe(false);
    expect(namesAgree('STEPHEN', 'STEVEN', 0.85)).toBe(true);
    expect(namesAgree('STEPHEN', 'STEVEN', { threshold: 0.85 })).toBe(true);
  });
});

describe('fieldsAgree (C31.2)', () => {
  it.each([
    ['birthdate', '1990-02-14', '1990-02-14', true],
    ['birthdate', '1990-02-14', '1990-02-15', false],
    ['identification-number', 'X12K45P78', 'X12K4SP78', true],
    ['identification-number', 'x12 k45-p78', 'X12K45P78', true],
    ['identification-number', 'X12K45P78', 'X12K45P79', false],
    ['personal-number', '12345678Z', '1234567BZ', true],
    ['name-last', 'VALEMONT', 'Valemont', true],
    ['name-first', 'QUINN', 'ROBIN', false],
    ['name-last', 'DOE', 'DOEBERT', false],
    ['sex', 'F', 'f', true],
    ['sex', 'F', 'M', false],
    ['nationality', 'D', 'DEU', true],
    ['nationality', 'UTO', 'GBR', false],
    ['issuing-authority-code', '636014', '636014', true],
    ['issuing-authority-code', 'UTO', 'UT0', false],
    ['issuing-authority-code', 'D', 'DEU', true],
    ['issuing-authority-code', 'UTO', 'DEU', false],
    ['address-postal-code', '95814', '95814-1234', true],
    ['address-postal-code', '95814', '95815', false],
    ['address-postal-code', 'A1A 1A1', 'A1A1A1', true],
    ['address-street-1', '1200 VERIFICATION AVE', '1200 Verification Avenue', true],
    ['address-street-1', '12 LANTERN ROW', '14 LANTERN ROW', false],
    ['address-city', 'NORTH HAVEN', 'North Haven', true],
    ['address-subdivision', 'CA', 'ca', true],
    ['address-country-code', 'US', 'CA', false],
    ['vehicle-class', 'C', 'c', true],
    ['endorsements', 'NONE', 'M', false],
  ] as const)('%s: %j and %j agree: %j', (field, a, b, expected) => {
    expect(fieldsAgree(field, a, b)).toBe(expected);
  });
});
