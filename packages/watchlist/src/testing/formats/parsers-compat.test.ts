/**
 * Compatibility of the synthetic publisher files with `watchlist-ingest`'s parsers (C77.2, C77.5):
 * what a writer states, the parser must read back. Written after both sides existed, so it is a
 * characterization test, not a RED step; a failure names which side departs from the format.
 */
import { describe, expect, it } from 'vitest';
import {
  parseEuFsf,
  parseOfacEnhanced,
  parseOfacEnhancedZip,
  parseUkSanctionsList,
  parseUnConsolidated,
} from '../../parsers/index.js';
import type { WatchlistRecord } from '../../record/index.js';
import { bytesSource } from '../../zip/reader.js';
import { syntheticWatchlist } from '../records.js';
import { lowerBound, upperBound } from './parts.js';
import { euFsfXml } from './eu.js';
import { OFAC_LIST_NAMES, ofacEnhancedXml, ofacSdnEnhancedZip } from './ofac.js';
import { ukSanctionsListXml } from './uk.js';
import { unConsolidatedXml } from './un.js';

async function collect(
  parse: AsyncGenerator<WatchlistRecord, { publishedAt: string; entries: number }>,
): Promise<{ records: WatchlistRecord[]; publishedAt: string }> {
  const records: WatchlistRecord[] = [];
  for (;;) {
    const step = await parse.next();
    if (step.done === true) {
      return { records, publishedAt: step.value.publishedAt };
    }
    records.push(step.value);
  }
}

const sortedJson = (items: readonly unknown[]): string[] =>
  items.map((item) => JSON.stringify(item)).sort();

const bounds = (date: WatchlistRecord['birth_dates'][number]): readonly [string, string] => [
  lowerBound(date.range?.from ?? date.value),
  upperBound(date.range?.to ?? date.value),
];

/**
 * The facts a publisher file carries, compared as sets. Dates compare by the days they can mean
 * (the parser reads a month or circa date as a year range); an IMO number with or without OFAC's
 * `IMO ` prefix; and only the country roles the parser reads (nationality, citizenship, a vessel's
 * flag; it leaves out an entity's `Nationality of Registration`, reported to its owner).
 */
function carried(record: WatchlistRecord) {
  return {
    entry_id: record.entry_id,
    kind: record.kind,
    names: sortedJson(record.names.map(({ full, script, quality }) => ({ full, script, quality }))),
    birth_dates: sortedJson(record.birth_dates.map(bounds)),
    identifiers: sortedJson(
      record.identifiers.map(({ kind, value, country }) => ({
        kind,
        value: kind === 'imo' ? value.replace(/^IMO /u, '') : value,
        country: country ?? null,
      })),
    ),
    countries: sortedJson(
      record.countries.filter(
        ({ code, role }) =>
          code !== null &&
          (role === 'nationality' ||
            role === 'citizenship' ||
            (record.kind === 'vessel' && role === 'registration')),
      ),
    ),
    addresses: sortedJson(record.addresses),
    crypto_addresses: sortedJson(record.crypto_addresses),
    programs: [...record.programs].sort(),
    listed_at: record.listed_at,
    gender: record.gender,
  };
}

describe('the synthetic OFAC files through the OFAC parser', () => {
  const records = syntheticWatchlist({ seed: 'compat', idStyle: 'ofac' });
  const options = { dataAsOf: '2026-01-05T00:00:00-05:00' } as const;

  it('reads back every entry the enhanced XML states', async () => {
    const xml = new TextEncoder().encode(ofacEnhancedXml(records, options));
    const parsed = await collect(parseOfacEnhanced([xml], { maxBytes: 50_000_000 }));
    expect(parsed.publishedAt).toBe('2026-01-05T05:00:00.000Z');
    expect(parsed.records.map(carried)).toEqual(records.map(carried));
  });

  it('reads back the list memberships of a Consolidated file (owner decision 9 after 6B)', async () => {
    const [tied, several, plain] = records;
    if (tied === undefined || several === undefined || plain === undefined) {
      throw new Error('too few records');
    }
    const written: WatchlistRecord[] = [
      {
        ...tied,
        programs: ['SANDBOX-SSI-1'],
        list_memberships: [{ list: OFAC_LIST_NAMES.consolidated, program: 'SANDBOX-SSI-1' }],
      },
      {
        ...several,
        list_memberships: [
          { list: OFAC_LIST_NAMES.consolidated, program: null },
          { list: 'Non-SDN Menu-Based Sanctions List', program: null },
        ],
      },
      plain,
    ];
    const xml = new TextEncoder().encode(
      ofacEnhancedXml(written, { ...options, list: 'consolidated' }),
    );
    const parsed = await collect(parseOfacEnhanced([xml], { maxBytes: 50_000_000 }));

    expect(parsed.records.map((record) => record.list_memberships)).toEqual([
      written[0]?.list_memberships,
      written[1]?.list_memberships,
      // A record without memberships is written under the Consolidated list's name alone, so
      // each of its programmes reads back tied to that list.
      plain.programs.map((program) => ({ list: OFAC_LIST_NAMES.consolidated, program })),
    ]);
    const sdn = await collect(
      parseOfacEnhanced([new TextEncoder().encode(ofacEnhancedXml([plain], options))], {
        maxBytes: 50_000_000,
      }),
    );
    expect(sdn.records[0]).not.toHaveProperty('list_memberships');
  });

  it('reads back the SDN list from its single-member ZIP', async () => {
    const archive = ofacSdnEnhancedZip(records, options);
    const parsed = await collect(
      parseOfacEnhancedZip(bytesSource(archive), {
        maxBytes: 50_000_000,
        maxCompressedBytes: 10_000_000,
      }),
    );
    expect(parsed.records.map((record) => record.entry_id)).toEqual(
      records.map((record) => record.entry_id),
    );
  });
});

/**
 * The EU, UK and UN files carry less than the record (no crypto in the EU and UN files, fewer
 * identifier kinds, one original-script name in the UN file), as each writer documents; every
 * entry still reads back under its id and publication time, with the kinds the format states
 * (persons and entities, and the UK's ships).
 */
describe('the synthetic EU, UK and UN files through their parsers', () => {
  const encode = (text: string): Uint8Array[] => [new TextEncoder().encode(text)];
  const options = { maxBytes: 50_000_000 };

  it.each([
    [
      'EU FSF',
      'eu',
      (records: readonly WatchlistRecord[]) =>
        parseEuFsf(
          encode(
            euFsfXml(records, {
              generationDate: '2026-01-05T12:00:00.000+01:00',
              globalFileId: 900001,
            }),
          ),
          options,
        ),
      '2026-01-05T11:00:00.000Z',
    ],
    [
      'UK Sanctions List',
      'uk',
      (records: readonly WatchlistRecord[]) =>
        parseUkSanctionsList(
          encode(ukSanctionsListXml(records, { dateGenerated: '2026-01-05' })),
          options,
        ),
      null,
    ],
    [
      'UN consolidated',
      'un',
      (records: readonly WatchlistRecord[]) =>
        parseUnConsolidated(
          encode(unConsolidatedXml(records, { dateGenerated: '2026-01-05T23:00:00.000Z' })),
          options,
        ),
      '2026-01-05T23:00:00.000Z',
    ],
  ] as const)('reads back every %s entry', async (_, idStyle, parse, publishedAt) => {
    const records = syntheticWatchlist({ seed: 'compat', idStyle });
    const parsed = await collect(parse(records));
    expect(parsed.records.map(({ entry_id, kind }) => [entry_id, kind])).toEqual(
      records.map(({ entry_id, kind }) => [
        entry_id,
        kind === 'individual' || (kind === 'vessel' && idStyle === 'uk') ? kind : 'entity',
      ]),
    );
    if (publishedAt !== null) {
      expect(parsed.publishedAt).toBe(publishedAt);
    }
  });
});
