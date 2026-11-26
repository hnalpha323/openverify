/**
 * C76, C78.3: the shared setup of the watchlist repository tests (`watchlists.test.ts`,
 * `watchlist-reads.test.ts`, `watchlist-key-df.test.ts`): the synthetic sources, entries, syncs and
 * retrieval queries. Every list value is synthetic: fictional names, `SYN-` ids.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { RetrieveCandidatesQuery } from './watchlist-reads.js';
import {
  insertWatchlistSync,
  reconcileWatchlistSourceRows,
  writeWatchlistEntries,
  type WatchlistEntryWrite,
} from './watchlists.js';

export const LIST = 'synthetic-list';
export const SANDBOX = 'synthetic-sandbox';
export const OTHER = 'synthetic-other';
export const HASH = (digit: string) => digit.repeat(64);
export const NOW = new Date('2026-10-27T12:00:00.000Z');

/** Empties the list tables and reconciles the three synthetic sources. */
export async function resetWatchlists(db: Db): Promise<void> {
  await db.execute(
    sql`truncate watchlist_key_df, watchlist_names, watchlist_identifiers, watchlist_crypto_addresses, watchlist_entries, watchlist_syncs, watchlist_sources cascade`,
  );
  await reconcileWatchlistSourceRows(db, [
    { id: LIST, enabled: true, sandboxOnly: false },
    { id: SANDBOX, enabled: true, sandboxOnly: true },
    { id: OTHER, enabled: true, sandboxOnly: false },
  ]);
}

export interface EntrySpec {
  id: string;
  names: { name: string; keys: string[]; quality?: 'strong' | 'weak'; normalised?: string }[];
  kind?: WatchlistEntryWrite['kind'];
  identifiers?: { kind: string; value: string; country?: string | null }[];
  crypto?: string[];
  content?: string;
  risk?: string;
  change?: WatchlistEntryWrite['change'];
}

export function entry(spec: EntrySpec): WatchlistEntryWrite {
  const change = spec.change ?? 'added';
  return {
    entryId: spec.id,
    kind: spec.kind ?? 'individual',
    contentHash: HASH(spec.content ?? 'a'),
    riskDataHash: HASH(spec.risk ?? 'b'),
    data: { entry_id: spec.id, synthetic: true },
    programs: ['SYNTHETIC-ALPHA'],
    listedAt: '2026-01-01',
    change,
    contentChanged: change !== 'unchanged',
    riskDataChanged: change !== 'unchanged',
    names: spec.names.map((name, ordinal) => ({
      ordinal,
      name: name.name,
      normalised: name.normalised ?? name.name.toLowerCase(),
      script: 'latin',
      quality: name.quality ?? 'strong',
      primary: ordinal === 0,
      keys: name.keys,
    })),
    identifiers: (spec.identifiers ?? []).map((identifier) => ({
      kind: identifier.kind,
      value: identifier.value,
      country: identifier.country ?? null,
    })),
    cryptoAddresses: (spec.crypto ?? []).map((canonical) => ({
      chain: 'unknown',
      canonical,
      raw: canonical,
      ticker: 'XBT',
    })),
  };
}

/** An applied sync row of `sourceId`, at {@link NOW}. */
export async function insertTestSync(db: Db, sourceId: string): Promise<number> {
  return insertWatchlistSync(db, {
    sourceId,
    startedAt: NOW,
    finishedAt: NOW,
    outcome: 'applied',
    actor: 'cli',
  });
}

/** Writes `count` filler entries with keys of their own, so the 2% rule has a population. */
export async function writeFillers(
  db: Db,
  sourceId: string,
  syncId: number,
  count: number,
): Promise<void> {
  const entries = Array.from({ length: count }, (_, index) =>
    entry({
      id: `SYN-F${String(index).padStart(4, '0')}`,
      names: [
        { name: `Filler Person ${String(index)}`, keys: [`t:filler${String(index)}`, 't:person'] },
      ],
    }),
  );
  await writeWatchlistEntries(db, { sourceId, syncId, entries });
}

export const candidateQuery = (
  overrides: Partial<RetrieveCandidatesQuery>,
): RetrieveCandidatesQuery => ({
  environmentKind: 'sandbox',
  sourceIds: [LIST, SANDBOX, OTHER],
  keys: [],
  identifiers: [],
  cryptoAddresses: [],
  normalisedName: null,
  cap: 2000,
  ...overrides,
});
