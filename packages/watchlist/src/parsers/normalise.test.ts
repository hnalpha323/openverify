/**
 * C77.1: the normalisation every publisher parser shares. Names, numbers and places are fictional;
 * country names are the public forms the lists print.
 */
import { describe, expect, it } from 'vitest';
import { WatchlistParseError } from './errors.js';
import {
  birthDate,
  calendarDate,
  cleanText,
  countryCode,
  dayMonthYear,
  finishRecord,
  identifierKindOf,
  nameScript,
  partialDate,
  publicationTime,
  recordName,
  truncateText,
  type RecordDraft,
} from './normalise.js';

describe('text', () => {
  it('trims and collapses whitespace, non-breaking spaces included, and drops empty text', () => {
    expect(cleanText('  Avery\n\t  Sandbox Quillfeather ')).toBe('Avery Sandbox Quillfeather');
    expect(cleanText(' \n ')).toBeNull();
    expect(cleanText(null)).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });

  it('truncates without splitting a surrogate pair', () => {
    expect(truncateText('synthetic', 4)).toBe('synt');
    expect(truncateText('a😀b', 2)).toBe('a');
    expect(truncateText('a😀b', 3)).toBe('a😀');
    expect(truncateText('short', 10)).toBe('short');
  });
});

describe('names', () => {
  it('gives the writing system most letters use, or other', () => {
    expect(nameScript('QUILLFEATHER, Avery')).toBe('latin');
    expect(nameScript('Квиллфезер Эйвери')).toBe('cyrillic');
    expect(nameScript('Квиллфезер A.')).toBe('cyrillic');
    expect(nameScript('كويلفذر')).toBe('arabic');
    expect(nameScript('1234')).toBe('other');
  });

  it('builds a record name with its script, quality and primary flag, or null', () => {
    expect(
      recordName('  QUILLFEATHER,  Avery ', {
        parts: [
          { role: 'family', value: ' QUILLFEATHER ' },
          { role: 'given', value: '  ' },
        ],
        quality: 'weak',
      }),
    ).toEqual({
      full: 'QUILLFEATHER, Avery',
      parts: [{ role: 'family', value: 'QUILLFEATHER' }],
      script: 'latin',
      quality: 'weak',
      primary: false,
    });
    expect(recordName('Avery', { primary: true })).toMatchObject({
      quality: 'strong',
      primary: true,
    });
    expect(recordName('   ')).toBeNull();
  });
});

describe('countryCode', () => {
  it('reads codes and the English names the lists print', () => {
    const cases: Record<string, string> = {
      GB: 'GB',
      gb: 'GB',
      XK: 'XK',
      'United Kingdom': 'GB',
      'United States': 'US',
      'United States of America': 'US',
      'Russian Federation': 'RU',
      Russia: 'RU',
      'Korea, North': 'KP',
      "Democratic People's Republic of Korea": 'KP',
      'Iran (Islamic Republic of)': 'IR',
      Burma: 'MM',
      Myanmar: 'MM',
      "Côte d'Ivoire": 'CI',
      'Cote d’Ivoire': 'CI',
      'SYRIA ': 'SY',
      'Syrian Arab Republic': 'SY',
      Turkey: 'TR',
      'Saint Kitts and Nevis': 'KN',
      'Congo, Democratic Republic of the': 'CD',
      'Viet Nam': 'VN',
      Kosovo: 'XK',
    };
    for (const [value, code] of Object.entries(cases)) {
      expect(countryCode(value), value).toBe(code);
    }
  });

  it('answers null for nothing, an unknown name, a region that is not a country and placeholders', () => {
    for (const value of [
      null,
      undefined,
      '',
      'Atlantis',
      'European Union',
      'EU',
      'ZZ',
      '00',
      'X',
    ]) {
      expect(countryCode(value), String(value)).toBeNull();
    }
  });
});

describe('dates', () => {
  it('builds partial dates and refuses parts out of range', () => {
    expect(partialDate(1980)).toBe('1980');
    expect(partialDate(1980, 4)).toBe('1980-04');
    expect(partialDate(1980, 4, 12)).toBe('1980-04-12');
    expect(partialDate(1980, null, 12)).toBe('1980');
    expect(partialDate(980, 1, 1)).toBe('0980-01-01');
    for (const date of [
      partialDate(null),
      partialDate(1980, 13),
      partialDate(1980, 2, 30),
      partialDate(0),
      partialDate(10000),
    ]) {
      expect(date).toBeNull();
    }
  });

  it('builds birth dates at their precision, widening circa dates to a year either side', () => {
    expect(birthDate('1980-04-12')).toEqual({ value: '1980-04-12', precision: 'day' });
    expect(birthDate('1980-04')).toEqual({ value: '1980-04', precision: 'month' });
    expect(birthDate('1980', { circa: true })).toEqual({
      value: '1980',
      precision: 'year',
      range: { from: '1979', to: '1981' },
    });
    expect(birthDate('1980-04-12', { circa: true })).toMatchObject({
      range: { from: '1979', to: '1981' },
    });
    expect(birthDate('1958', { range: { from: '1958', to: '1960' } })).toEqual({
      value: '1958',
      precision: 'year',
      range: { from: '1958', to: '1960' },
    });
    expect(birthDate(null)).toBeNull();
  });

  it('reads publication times with or without an offset, dates and dd/mm/yyyy, in UTC', () => {
    const cases: Record<string, string> = {
      '2026-10-21T00:00:00-04:00': '2026-10-21T04:00:00.000Z',
      '2026-10-21T00:00:00': '2026-10-21T00:00:00.000Z',
      '2026-10-15T12:10:34.160+02:00': '2026-10-15T10:10:34.160Z',
      '2026-10-22T23:00:06.809Z': '2026-10-22T23:00:06.809Z',
      '2026-10-21': '2026-10-21T00:00:00.000Z',
      '16/10/2026': '2026-10-16T00:00:00.000Z',
    };
    for (const [value, iso] of Object.entries(cases)) {
      expect(publicationTime(value), value).toBe(iso);
    }
    for (const value of ['yesterday', '2026-13-01', '2026-02-30', '31/02/2026', '', null]) {
      expect(publicationTime(value), String(value)).toBeNull();
    }
  });

  it('reads dd/mm/yyyy dates whose unknown parts are placeholders', () => {
    expect(dayMonthYear('12/04/1980')).toBe('1980-04-12');
    expect(dayMonthYear('dd/mm/1980')).toBe('1980');
    expect(dayMonthYear('DD/04/1980')).toBe('1980-04');
    expect(dayMonthYear('00/00/1980')).toBe('1980');
    expect(dayMonthYear('12/mm/1980')).toBe('1980');
    for (const value of ['dd/mm/yyyy', '31/02/1980', '1980-04-12', '', null]) {
      expect(dayMonthYear(value), String(value)).toBeNull();
    }
  });
});

describe('identifierKindOf', () => {
  it('reads the kind a document type names, by keyword, else other', () => {
    const cases: Record<string, string> = {
      Passport: 'passport',
      'Diplomatic Passport': 'passport',
      'National passport': 'passport',
      MMSI: 'mmsi',
      'SWIFT/BIC': 'swift_bic',
      'Legal Entity Number': 'lei',
      lei: 'lei',
      'Tax ID No.': 'tax_id',
      'Fiscal Code': 'tax_id',
      'IMO number': 'imo',
      'Aircraft Manufacturer’s Serial Number (MSN)': 'aircraft_serial',
      'Aircraft Tail Number': 'aircraft_tail',
      'Registration Number': 'registration_number',
      'Commercial Registry Number': 'registration_number',
      'Certificate of Incorporation Number': 'registration_number',
      'Unified Social Credit Code (USCC)': 'registration_number',
      'National ID No.': 'national_id',
      'National identification card': 'national_id',
      'Identity Card': 'national_id',
      'Cedula No.': 'national_id',
      "Driver's License No.": 'other',
      '': 'other',
    };
    for (const [type, kind] of Object.entries(cases)) {
      expect(identifierKindOf(type), type).toBe(kind);
    }
    expect(identifierKindOf(null)).toBe('other');
  });

  it('reads calendar dates that exist', () => {
    expect(calendarDate('2024-02-29')).toBe('2024-02-29');
    for (const value of ['2023-02-29', '2024-2-9', '2024', null, undefined]) {
      expect(calendarDate(value), String(value)).toBeNull();
    }
  });
});

describe('finishRecord', () => {
  const name = (full: string, primary = false) => ({
    full,
    parts: [],
    script: 'latin' as const,
    quality: 'strong' as const,
    primary,
  });
  const DRAFT: RecordDraft = {
    entry_id: 'SBX-7',
    kind: 'individual',
    names: [name('Avery Quillfeather'), name('Avery Quillfeather', true), name('Avy Q')],
    birth_dates: [
      { value: '1980', precision: 'year' },
      { value: '1980', precision: 'year' },
    ],
    countries: [
      { code: 'GB', role: 'nationality' },
      { code: 'GB', role: 'nationality' },
      { code: 'GB', role: 'residence' },
    ],
    identifiers: [
      { kind: 'passport', value: 'SBX000001', country: 'GB' },
      { kind: 'passport', value: 'SBX000001', country: 'GB' },
    ],
    programs: ['SANDBOX-1', 'SANDBOX-1', 'SANDBOX-2'],
  };

  it('drops duplicates, keeps any primary flag, fills the empty lists and validates', () => {
    expect(finishRecord(DRAFT, 7)).toEqual({
      entry_id: 'SBX-7',
      kind: 'individual',
      names: [name('Avery Quillfeather', true), name('Avy Q')],
      birth_dates: [{ value: '1980', precision: 'year' }],
      birth_places: [],
      countries: [
        { code: 'GB', role: 'nationality' },
        { code: 'GB', role: 'residence' },
      ],
      identifiers: [{ kind: 'passport', value: 'SBX000001', country: 'GB' }],
      addresses: [],
      crypto_addresses: [],
      programs: ['SANDBOX-1', 'SANDBOX-2'],
      positions: [],
      relations: [],
    });
  });

  it('refuses a record the schema refuses, naming the ordinal and the path, not the value', () => {
    const secret = `QUILLFEATHER${'Q'.repeat(300)}`;
    const cases: RecordDraft[] = [
      { ...DRAFT, names: [name(secret)] },
      { ...DRAFT, names: [] },
      { ...DRAFT, identifiers: [{ kind: 'passport', value: secret }] },
      { ...DRAFT, entry_id: '' },
    ];
    for (const draft of cases) {
      let error: unknown;
      try {
        finishRecord(draft, 7);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(WatchlistParseError);
      const refusal = error as WatchlistParseError;
      expect(refusal.code).toBe('schema');
      expect(refusal.message).toContain('entry 7');
      expect(refusal.message).not.toContain('QUILLFEATHER');
    }
  });
});
