/**
 * Synthetic list entries for the match tests: fictional persons, a fictional company and a
 * fictional vessel (the sandbox LEI and IMO number of C82.4), never a listed party.
 */
import type { WatchlistRecord } from '../record/index.js';

type RecordName = WatchlistRecord['names'][number];

export const SOURCE = 'test-src';

export function name(
  full: string,
  options: Partial<Pick<RecordName, 'quality' | 'primary' | 'script'>> = {},
): RecordName {
  return {
    full,
    parts: [],
    script: options.script ?? 'latin',
    quality: options.quality ?? 'strong',
    primary: options.primary ?? false,
  };
}

export function entry(
  entryId: string,
  kind: WatchlistRecord['kind'],
  names: RecordName[],
  rest: Partial<Omit<WatchlistRecord, 'entry_id' | 'kind' | 'names'>> = {},
): WatchlistRecord {
  return {
    entry_id: entryId,
    kind,
    names,
    birth_dates: [],
    birth_places: [],
    countries: [],
    identifiers: [],
    addresses: [],
    crypto_addresses: [],
    programs: [],
    positions: [],
    relations: [],
    ...rest,
  };
}

/** A listed fictional person with an alias, a weak alias, a birth date and a passport. */
export const ORLAN = entry(
  'A-1',
  'individual',
  [
    name('VEXBY, Orlan', { primary: true }),
    name('Orlan Vexbie'),
    name('Orly Vex', { quality: 'weak' }),
  ],
  {
    birth_dates: [{ value: '1971-03-09', precision: 'day' }],
    countries: [{ code: 'GB', role: 'nationality' }],
    gender: 'male',
    identifiers: [{ kind: 'passport', value: 'X12345', country: 'GB' }],
    programs: ['TEST-PROGRAM'],
  },
);

export const TALIA = entry('B-2', 'individual', [name('MORROW-QUIST, Talia', { primary: true })]);

export const HOLDINGS = entry(
  'C-3',
  'entity',
  [name('Sandbox Sanctioned Holdings Ltd', { primary: true })],
  {
    countries: [{ code: 'GB', role: 'registration' }],
    identifiers: [{ kind: 'lei', value: '5299000SANDBOXLEI047' }],
    crypto_addresses: [{ raw: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', ticker: 'ETH' }],
  },
);

export const VESSEL = entry('D-4', 'vessel', [name('MARLIN DAWN', { primary: true })], {
  identifiers: [{ kind: 'imo', value: 'IMO 9999993' }],
});

/** A fictional office holder whose position is in FR while the record names GB. */
export const OFFICE_HOLDER = entry(
  'E-5',
  'individual',
  [name('QUILLON, Maren', { primary: true })],
  {
    countries: [{ code: 'GB', role: 'citizenship' }],
    positions: [
      {
        position: 'Q-test-1',
        label: 'Fictional minister',
        pep_class: 1,
        country: 'FR',
        start: '2020',
        end: null,
        in_office: 'yes',
      },
    ],
  },
);

export const candidates = (...records: WatchlistRecord[]) =>
  records.map((record) => ({ sourceId: SOURCE, record }));
