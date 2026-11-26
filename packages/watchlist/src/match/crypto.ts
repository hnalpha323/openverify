/**
 * C79.3: the crypto-address screening. The query address is canonicalised by the format table and
 * an exact match on the canonical form is the only match (R): score 1, `crypto_address_exact`. An
 * unclassified query format is stated in `coverage.limits`.
 */
import {
  canonicaliseCryptoAddress,
  recordCryptoRows,
  type CanonicalCryptoAddress,
} from '../crypto/index.js';
import { screeningCoverage, type ScreeningCoverage } from './coverage.js';
import { entryKey } from './evidence.js';
import type { EntryMatch, ScreeningCandidate } from './screen.js';

export interface CryptoQuery {
  readonly 'crypto-address': string;
  readonly 'chain-id'?: string | null | undefined;
}

export interface CryptoScreening {
  /** `null` when nothing is left of the address (the run errors `insufficient_input`). */
  readonly address: CanonicalCryptoAddress | null;
  readonly matches: readonly EntryMatch[];
  readonly coverage: ScreeningCoverage;
}

/** Screens a crypto address against candidate entries. */
export function screenCryptoAddress(
  query: CryptoQuery,
  candidates: readonly ScreeningCandidate[],
): CryptoScreening {
  const address = canonicaliseCryptoAddress(query['crypto-address'], {
    chainId: query['chain-id'] ?? null,
  });
  const coverage = screeningCoverage([], {
    sourceIds: [],
    truncated: false,
    unclassifiedFormat: address?.format === 'unclassified',
  });
  if (address === null) {
    return { address, matches: [], coverage };
  }
  const matches = candidates
    .filter(({ record }) =>
      recordCryptoRows(record).some((row) => row.canonical === address.canonical),
    )
    .map(({ sourceId, record }): EntryMatch => ({
      sourceId,
      entryId: record.entry_id,
      entryKey: entryKey(sourceId, record.entry_id),
      score: 1,
      aboveMinimum: true,
      matchTypes: ['crypto_address_exact'],
      qualifiers: [],
      aliasType: 'primary_name',
      subjectName: null,
      listName: record.names.find((name) => name.primary)?.full ?? record.names[0]?.full ?? '',
      nameScore: 0,
      nameLevel: null,
      methods: ['crypto-address-exact'],
      lossy: false,
    }))
    .sort((left, right) => (left.entryKey < right.entryKey ? -1 : 1));
  return { address, matches, coverage };
}
