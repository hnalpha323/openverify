/**
 * C77.6, C76.2: the publication diff and the mass-removal guard, over fictional records.
 */
import { describe, expect, it } from 'vitest';
import { WatchlistParseError } from '../parsers/errors.js';
import { contentHash, riskDataHash, type WatchlistRecord } from '../record/index.js';
import {
  diffPublication,
  exceedsMassRemoval,
  PublicationDiff,
  type StoredEntryHashes,
} from './diff.js';

const named = (full: string): WatchlistRecord['names'][number] => ({
  full,
  parts: [],
  script: 'latin',
  quality: 'strong',
  primary: true,
});

function record(id: string, overrides: Partial<WatchlistRecord> = {}): WatchlistRecord {
  return {
    entry_id: id,
    kind: 'individual',
    names: [
      { full: `Synthetic ${id}`, parts: [], script: 'latin', quality: 'strong', primary: true },
    ],
    birth_dates: [],
    birth_places: [],
    countries: [],
    identifiers: [],
    addresses: [],
    crypto_addresses: [],
    programs: ['SANDBOX-1'],
    positions: [],
    relations: [],
    ...overrides,
  };
}

const stored = (entry: WatchlistRecord): StoredEntryHashes => ({
  contentHash: contentHash(entry),
  riskDataHash: riskDataHash(entry),
});

const KEPT = record('SBX-1');
const RENAMED = record('SBX-2');
const RELISTED = record('SBX-3');
const REMARKED = record('SBX-4');
const GONE = record('SBX-5');

const PREVIOUS = new Map(
  [KEPT, RENAMED, RELISTED, REMARKED, GONE].map((entry) => [entry.entry_id, stored(entry)]),
);

const NEXT = [
  KEPT,
  record('SBX-2', { names: [named('Synthetic renamed')] }),
  record('SBX-3', { programs: ['SANDBOX-1', 'SANDBOX-2'] }),
  record('SBX-4', { remarks: 'A new remark changes no hash.' }),
  record('SBX-6'),
  record('SBX-7', { names: [named('Synthetic other')], listed_at: '2026-01-01' }),
];

describe('PublicationDiff', () => {
  it('classifies each record by entry id and both hashes', () => {
    const diff = new PublicationDiff(PREVIOUS);
    const changes = NEXT.map((entry) => diff.add(entry));
    expect(
      changes.map(({ entryId, change, contentChanged, riskDataChanged }) => ({
        entryId,
        change,
        contentChanged,
        riskDataChanged,
      })),
    ).toEqual([
      { entryId: 'SBX-1', change: 'unchanged', contentChanged: false, riskDataChanged: false },
      { entryId: 'SBX-2', change: 'changed', contentChanged: true, riskDataChanged: false },
      { entryId: 'SBX-3', change: 'changed', contentChanged: false, riskDataChanged: true },
      { entryId: 'SBX-4', change: 'unchanged', contentChanged: false, riskDataChanged: false },
      { entryId: 'SBX-6', change: 'added', contentChanged: true, riskDataChanged: true },
      { entryId: 'SBX-7', change: 'added', contentChanged: true, riskDataChanged: true },
    ]);
    expect(changes[0]).toMatchObject(stored(KEPT));
    expect(diff.finish()).toEqual({
      added: ['SBX-6', 'SBX-7'],
      changed: [
        { entryId: 'SBX-2', content: true, riskData: false },
        { entryId: 'SBX-3', content: false, riskData: true },
      ],
      removed: ['SBX-5'],
      unchanged: 2,
    });
  });

  it('refuses an entry id given twice in one publication', () => {
    const diff = new PublicationDiff(new Map());
    diff.add(KEPT);
    expect(() => diff.add(KEPT)).toThrow(WatchlistParseError);
  });

  it('diffs a whole publication from a sync or an async source', async () => {
    const summary = await diffPublication(PREVIOUS, NEXT);
    async function* stream(): AsyncGenerator<WatchlistRecord> {
      for (const entry of NEXT) {
        yield await Promise.resolve(entry);
      }
    }
    expect(await diffPublication(PREVIOUS, stream())).toEqual(summary);
    expect(await diffPublication(new Map(), [])).toEqual({
      added: [],
      changed: [],
      removed: [],
      unchanged: 0,
    });
    expect((await diffPublication(PREVIOUS, [])).removed).toEqual([
      'SBX-1',
      'SBX-2',
      'SBX-3',
      'SBX-4',
      'SBX-5',
    ]);
  });
});

describe('exceedsMassRemoval', () => {
  it('allows up to 10% of a source of 100 or more, and refuses more', () => {
    expect(exceedsMassRemoval(100, 10)).toBe(false);
    expect(exceedsMassRemoval(100, 11)).toBe(true);
    expect(exceedsMassRemoval(20_000, 2_000)).toBe(false);
    expect(exceedsMassRemoval(20_000, 2_001)).toBe(true);
  });

  it('refuses only the removal of every entry of a source with fewer than 100', () => {
    expect(exceedsMassRemoval(99, 98)).toBe(false);
    expect(exceedsMassRemoval(99, 99)).toBe(true);
    expect(exceedsMassRemoval(1, 1)).toBe(true);
    expect(exceedsMassRemoval(0, 0)).toBe(false);
    expect(exceedsMassRemoval(5, 0)).toBe(false);
  });
});
