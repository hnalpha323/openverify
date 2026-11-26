import { validateCryptoAddress } from '@openverify/checks';
import { describe, expect, it } from 'vitest';
import { contentHash, watchlistRecordSchema, type WatchlistRecord } from '../record/index.js';
import { isValidImo, isValidLei } from './identifiers.js';
import {
  SYNTHETIC_COUNTRIES,
  SYNTHETIC_PROGRAMS,
  syntheticEntryId,
  syntheticWatchlist,
} from './records.js';

const BITCOIN = 'bip122:000000000019d6689c085ae165831e93';

const identifiersOf = (records: readonly WatchlistRecord[], kind: string): string[] =>
  records.flatMap((record) =>
    record.identifiers.filter((identifier) => identifier.kind === kind).map(({ value }) => value),
  );

describe('syntheticEntryId', () => {
  it('writes each publisher’s id style', () => {
    expect(syntheticEntryId('synthetic', 'individual', 1)).toBe('SYN-1001');
    expect(syntheticEntryId('ofac', 'entity', 12)).toBe('900012');
    expect(syntheticEntryId('eu', 'individual', 3)).toBe('700003');
    expect(syntheticEntryId('uk', 'vessel', 7)).toBe('SYN0007');
    expect(syntheticEntryId('un', 'individual', 4)).toBe('SYi.004');
    expect(syntheticEntryId('un', 'entity', 5)).toBe('SYe.005');
    expect(() => syntheticEntryId('uk', 'entity', 0)).toThrow(RangeError);
  });
});

describe('syntheticWatchlist', () => {
  it('writes the default mix of kinds, each record valid under the frozen schema', () => {
    const records = syntheticWatchlist({ seed: 'defaults' });
    expect(records.map((record) => record.kind)).toEqual([
      ...Array<string>(6).fill('individual'),
      'entity',
      'entity',
      'entity',
      'vessel',
      'aircraft',
    ]);
    for (const record of records) {
      expect(() => watchlistRecordSchema.parse(record)).not.toThrow();
      expect(record.names.filter((name) => name.primary)).toHaveLength(1);
      expect(record.positions).toEqual([]);
      expect(record.relations).toEqual([]);
      expect(record.programs.length).toBeGreaterThan(0);
      expect(record.programs.every((program) => SYNTHETIC_PROGRAMS.includes(program))).toBe(true);
      expect(record.listed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const country of record.countries) {
        expect(country.code === null || SYNTHETIC_COUNTRIES.includes(country.code)).toBe(true);
      }
    }
  });

  it('is reproducible from its seed', () => {
    expect(syntheticWatchlist({ seed: 'same' })).toEqual(syntheticWatchlist({ seed: 'same' }));
    expect(syntheticWatchlist({ seed: 'same' })).not.toEqual(syntheticWatchlist({ seed: 'other' }));
  });

  it.each(['coverage-1', 'coverage-2', 'coverage-3'])(
    'covers every feature the parsers and matcher handle, whatever the seed (%s)',
    (seed) => {
      const records = syntheticWatchlist({ seed });
      const names = records.flatMap((record) => record.names);
      expect(new Set(names.map((name) => name.script))).toEqual(
        new Set(['latin', 'cyrillic', 'arabic', 'han']),
      );
      expect(names.some((name) => name.quality === 'weak')).toBe(true);
      const roles = new Set(names.flatMap((name) => name.parts.map((part) => part.role)));
      for (const role of ['given', 'family', 'middle']) {
        expect(roles.has(role as never)).toBe(true);
      }
      const dates = records.flatMap((record) => record.birth_dates);
      expect(dates.some((date) => date.precision === 'day')).toBe(true);
      expect(dates.some((date) => date.precision === 'year' && date.range !== undefined)).toBe(
        true,
      );
      expect(records.some((record) => record.gender !== undefined)).toBe(true);
      expect(records.some((record) => record.birth_places.length > 0)).toBe(true);
      expect(records.some((record) => record.addresses.length > 0)).toBe(true);

      for (const kind of [
        'passport',
        'national_id',
        'tax_id',
        'registration_number',
        'lei',
        'swift_bic',
        'imo',
        'mmsi',
        'aircraft_serial',
        'aircraft_tail',
        'website',
        'email',
      ]) {
        expect(identifiersOf(records, kind).length, kind).toBeGreaterThan(0);
      }
      expect(identifiersOf(records, 'lei').every(isValidLei)).toBe(true);
      expect(identifiersOf(records, 'imo').every(isValidImo)).toBe(true);
      expect(identifiersOf(records, 'website').every((site) => site.endsWith('.example'))).toBe(
        true,
      );

      const crypto = records.flatMap((record) => record.crypto_addresses);
      expect(crypto.some(({ ticker, raw }) => ticker === 'USDT' && raw.startsWith('T'))).toBe(true);
      expect(crypto.some(({ ticker, raw }) => ticker === 'ETH' && raw !== raw.toLowerCase())).toBe(
        true,
      );
      expect(
        crypto.some(({ raw }) => {
          const checked = validateCryptoAddress(BITCOIN, raw);
          return !checked.valid && checked.reason === 'address_checksum_invalid';
        }),
      ).toBe(true);
      expect(crypto.some(({ raw }) => raw.startsWith('SYN-'))).toBe(true);
    },
  );

  it('ties vessels to their IMO and MMSI and aircraft to their serial and tail', () => {
    const records = syntheticWatchlist({ seed: 'objects', vessels: 2, aircraft: 2 });
    for (const vessel of records.filter((record) => record.kind === 'vessel')) {
      expect(vessel.identifiers.map(({ kind }) => kind).sort()).toEqual(['imo', 'mmsi']);
    }
    for (const plane of records.filter((record) => record.kind === 'aircraft')) {
      expect(plane.identifiers.map(({ kind }) => kind).sort()).toEqual([
        'aircraft_serial',
        'aircraft_tail',
      ]);
    }
  });

  it('keeps names and ids unique in a large list, and numbers from firstNumber', () => {
    const records = syntheticWatchlist({
      seed: 'large',
      individuals: 150,
      entities: 40,
      vessels: 5,
      aircraft: 5,
      idStyle: 'ofac',
      firstNumber: 101,
    });
    expect(records).toHaveLength(200);
    expect(records[0]?.entry_id).toBe('900101');
    expect(new Set(records.map((record) => record.entry_id)).size).toBe(200);
    const primary = records.map((record) => record.names.find((name) => name.primary)?.full);
    expect(new Set(primary).size).toBe(200);
    expect(new Set(records.map(contentHash)).size).toBe(200);
  });

  it('leaves Han names out when asked, as committed lists do (C89.1)', () => {
    const records = syntheticWatchlist({ seed: 'no-han', individuals: 30, hanNames: false });
    const scripts = new Set(records.flatMap((record) => record.names.map((name) => name.script)));
    expect(scripts.has('han')).toBe(false);
    expect(scripts.has('cyrillic')).toBe(true);
    const second = records[1]?.names[0];
    expect(second?.parts.map((part) => part.role)).toContain('given');
  });

  it('writes an empty list when every count is zero', () => {
    expect(
      syntheticWatchlist({ seed: 'empty', individuals: 0, entities: 0, vessels: 0, aircraft: 0 }),
    ).toEqual([]);
  });
});
