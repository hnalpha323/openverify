/**
 * C76.2 step 6, C78.3: the rows a record gives the watchlist tables, with the keys of one keys
 * version: its names (`recordNameRows`), identifiers (`recordIdentifierRows`) and crypto addresses
 * (`recordCryptoRows`) from `@openverify/watchlist`. An unchanged entry keeps its rows, so they
 * are computed only for an added entry or one whose content changed.
 */
import type { WatchlistEntryParts, WatchlistEntryWrite } from '@openverify/db';
import {
  recordCryptoRows,
  recordIdentifierRows,
  recordNameRows,
  type EntryChange,
  type VariantGroups,
  type WatchlistRecord,
} from '@openverify/watchlist';

/** The derived rows of a record. */
export function entryPartsOf(record: WatchlistRecord, groups: VariantGroups): WatchlistEntryParts {
  return {
    entryId: record.entry_id,
    names: recordNameRows(record, groups).map((row) => ({
      ordinal: row.ordinal,
      name: row.name,
      normalised: row.normalised,
      script: row.script,
      quality: row.quality,
      primary: row.primary,
      keys: [...row.keys],
    })),
    identifiers: recordIdentifierRows(record).map(({ kind, value, country }) => ({
      kind,
      value,
      country,
    })),
    cryptoAddresses: recordCryptoRows(record).map(({ chain, canonical, raw, ticker }) => ({
      chain,
      canonical,
      raw,
      ticker,
    })),
  };
}

/** One record of a publication as the sync writes it, classified by the diff. */
export function entryWriteOf(
  record: WatchlistRecord,
  change: EntryChange,
  groups: VariantGroups,
): WatchlistEntryWrite {
  const rebuilt = change.change === 'added' || change.contentChanged;
  const parts = rebuilt
    ? entryPartsOf(record, groups)
    : { entryId: record.entry_id, names: [], identifiers: [], cryptoAddresses: [] };
  return {
    ...parts,
    kind: record.kind,
    contentHash: change.contentHash,
    riskDataHash: change.riskDataHash,
    data: record,
    programs: record.programs,
    listedAt: record.listed_at ?? null,
    change: change.change,
    contentChanged: change.contentChanged,
    riskDataChanged: change.riskDataChanged,
  };
}
