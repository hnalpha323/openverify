/**
 * C77.6: the diff of a new publication against the source's stored entries, by entry id and the
 * frozen hashes (C77.3): added, changed (its content hash, its risk-data hash or both), removed
 * and unchanged. OFAC's delta files are not used: OFAC advises full refreshes, and every other
 * publisher ships full files. The sync sets `changed_sync_id` on added entries and on entries
 * whose content or risk-data hash changed, `removed_at` on removed ones, and `rescreen_state`
 * `pending` when anything was added or changed (C76.2 step 6, C74.4).
 */
import { WatchlistParseError } from '../parsers/errors.js';
import { contentHash, riskDataHash, type WatchlistRecord } from '../record/index.js';

/** A stored entry's hashes, lower-case hex as `contentHash` and `riskDataHash` give them. */
export interface StoredEntryHashes {
  readonly contentHash: string;
  readonly riskDataHash: string;
}

/** One record of the new publication, classified, with its hashes. */
export interface EntryChange {
  readonly entryId: string;
  readonly change: 'added' | 'changed' | 'unchanged';
  readonly contentHash: string;
  readonly riskDataHash: string;
  /** True for an added entry, or a stored one whose content hash differs. */
  readonly contentChanged: boolean;
  /** True for an added entry, or a stored one whose risk-data hash differs. */
  readonly riskDataChanged: boolean;
}

export interface WatchlistDiffSummary {
  readonly added: readonly string[];
  readonly changed: readonly {
    readonly entryId: string;
    readonly content: boolean;
    readonly riskData: boolean;
  }[];
  /** Stored entries the publication no longer holds. */
  readonly removed: readonly string[];
  readonly unchanged: number;
}

/** A diff built one record at a time, so the sync applies each record as the parser yields it. */
export class PublicationDiff {
  private readonly previous: ReadonlyMap<string, StoredEntryHashes>;
  private readonly seen = new Set<string>();
  private readonly added: string[] = [];
  private readonly changed: { entryId: string; content: boolean; riskData: boolean }[] = [];
  private unchanged = 0;

  /** `previous`: the source's entries not yet removed, by entry id. */
  constructor(previous: ReadonlyMap<string, StoredEntryHashes>) {
    this.previous = previous;
  }

  /**
   * Classifies one record of the new publication.
   * @throws {WatchlistParseError} `schema` for an entry id the publication gives twice.
   */
  add(record: WatchlistRecord): EntryChange {
    const entryId = record.entry_id;
    if (this.seen.has(entryId)) {
      throw new WatchlistParseError(
        'schema',
        `entry ${String(this.seen.size + 1)}: its id is given twice`,
      );
    }
    this.seen.add(entryId);
    const hashes = { contentHash: contentHash(record), riskDataHash: riskDataHash(record) };
    const stored = this.previous.get(entryId);
    if (stored === undefined) {
      this.added.push(entryId);
      return { entryId, change: 'added', ...hashes, contentChanged: true, riskDataChanged: true };
    }
    const content = stored.contentHash !== hashes.contentHash;
    const riskData = stored.riskDataHash !== hashes.riskDataHash;
    if (content || riskData) {
      this.changed.push({ entryId, content, riskData });
    } else {
      this.unchanged += 1;
    }
    return {
      entryId,
      change: content || riskData ? 'changed' : 'unchanged',
      ...hashes,
      contentChanged: content,
      riskDataChanged: riskData,
    };
  }

  /** The summary, with every stored entry the publication did not hold as removed. */
  finish(): WatchlistDiffSummary {
    return {
      added: [...this.added],
      changed: [...this.changed],
      removed: [...this.previous.keys()].filter((entryId) => !this.seen.has(entryId)),
      unchanged: this.unchanged,
    };
  }
}

/** Diffs a whole publication. */
export async function diffPublication(
  previous: ReadonlyMap<string, StoredEntryHashes>,
  records: Iterable<WatchlistRecord> | AsyncIterable<WatchlistRecord>,
): Promise<WatchlistDiffSummary> {
  const diff = new PublicationDiff(previous);
  for await (const record of records) {
    diff.add(record);
  }
  return diff.finish();
}

/** C76.2 step 6: the mass-removal guard (provisional, ours). */
export const MASS_REMOVAL_GUARD = Object.freeze({
  /** A source of at least `smallSource` entries may lose at most this share in one sync. */
  maxShare: 0.1,
  /** Below this many entries, only the removal of every entry is refused. */
  smallSource: 100,
});

/**
 * Whether a sync removing `removed` of a source's `previous` entries needs
 * `--allow-mass-removal`: more than 10% of them, or all of a source with fewer than 100.
 */
export function exceedsMassRemoval(previous: number, removed: number): boolean {
  if (previous < MASS_REMOVAL_GUARD.smallSource) {
    return previous > 0 && removed >= previous;
  }
  return removed > previous * MASS_REMOVAL_GUARD.maxShare;
}
