/**
 * C78.6: the in-memory reverse index of recurring subjects for re-screens (C74.4). The decrypted
 * subjects of one environment's recurring reports, at most 50,000 a chunk (P09), are indexed so
 * that each added or changed list entry finds every subject whose own forward search could
 * retrieve it (owner decision 3 after 6B), and each one found is then scored forward:
 *
 * - **Keys.** A subject is posted under each key its searches would use: its names' query keys
 *   (`queryNameKeys`, the token-pair keys included) that the list's own frequencies keep within the
 *   bound (`frequencies`, `bound`: the `watchlist_key_df` counts after the sync and
 *   `keyFrequencyBound` of the cap). An entry meets it through its list keys. Without frequencies,
 *   every key is used, which only finds more.
 * - **Pairs out of reach.** The pair keys of a pair of tokens out of reach, which the search looks
 *   up themselves (up to its cap).
 * - **Trigrams.** A name its search would also look up by `pg_trgm` (a single word, an additional
 *   name, a name with a lone keyed token out of reach, or a name none of whose keys within the bound
 *   is held by two entries and none of whose pairs is out of reach) is indexed by its trigrams, and an entry meets it at a similarity of 0.25
 *   or more (pg_trgm's threshold is 0.3; the margin only finds more).
 * - **Exact paths.** Weak aliases by normalised equality, identifiers and canonical crypto
 *   addresses.
 *
 * Nothing is persisted (decision 23): the index lives in worker memory and is dropped after its
 * chunk. Owned by `watchlist-matcher` (Workflow 6A Stage 2), reworked by `matcher-6c`.
 */
import { recordCryptoRows } from '../crypto/index.js';
import {
  listNameKeys,
  queryNameKeys,
  queryNameReach,
  recordIdentifierRows,
  type VariantGroups,
} from '../keys/index.js';
import type { ScreeningSubject } from '../match/index.js';
import { analyseRecordName, type AnalysedName } from '../names/index.js';
import type { WatchlistRecord } from '../record/index.js';

/** The area this folder holds. */
export const WATCHLIST_REVERSE_INDEX_AREA = 'reverse-index';

/** C78.6, C74.4 (P09): the most subjects one index holds. */
export const REVERSE_INDEX_MAX_SUBJECTS = 50_000;

/** The trigram similarity from which an entry meets a subject's name (pg_trgm's 0.3, less a margin). */
export const REVERSE_TRIGRAM_THRESHOLD = 0.25;

/** One recurring report's subject: a screening subject, or a crypto address (canonical form). */
export interface ReverseSubject {
  /** The caller's id (the report id). */
  readonly id: string;
  readonly subject?: ScreeningSubject | undefined;
  readonly cryptoAddress?: string | undefined;
}

export interface ReverseIndex {
  /** How many subjects it holds. */
  readonly size: number;
  /**
   * The ids of the subjects an entry may match, sorted; each is then screened forward. A
   * {@link prepareReverseEntry} entry is prepared once for every chunk.
   */
  candidatesFor(record: WatchlistRecord | PreparedReverseEntry): string[];
}

/** An entry prepared once for every chunk: its names' list keys, normalised forms and trigrams. */
export interface PreparedReverseEntry {
  readonly prepared: true;
  readonly strong: readonly {
    readonly keys: readonly string[];
    readonly trigrams: ReadonlySet<string>;
  }[];
  readonly weak: readonly string[];
  readonly identifiers: readonly string[];
  readonly crypto: readonly string[];
}

/** Prepares an entry for {@link ReverseIndex.candidatesFor} (owner decision 3 after 6B). */
export function prepareReverseEntry(
  record: WatchlistRecord,
  groups: VariantGroups,
): PreparedReverseEntry {
  const strong: { keys: string[]; trigrams: Set<string> }[] = [];
  const weak: string[] = [];
  for (const written of record.names) {
    const analysed = analyseRecordName(written, record.kind);
    if (written.quality === 'weak') {
      weak.push(analysed.normalised);
    } else {
      strong.push({
        keys: listNameKeys(analysed, groups),
        trigrams: trigramsOf(analysed.normalised),
      });
    }
  }
  return {
    prepared: true,
    strong,
    weak,
    identifiers: recordIdentifierRows(record).map(({ kind, value }) => `${kind}:${value}`),
    crypto: recordCryptoRows(record).map(({ canonical }) => canonical),
  };
}

const isPrepared = (entry: WatchlistRecord | PreparedReverseEntry): entry is PreparedReverseEntry =>
  'prepared' in entry;

/** Owner decision 3 after 6B: how the list's own searches would key each subject. */
export interface ReverseIndexOptions {
  /** Live entries of the source holding each key (`watchlist_key_df`); a key not given holds none. */
  readonly frequencies?: ReadonlyMap<string, number> | undefined;
  /** The bound a key alone may be used within (`keyFrequencyBound` of the cap). */
  readonly bound?: number | undefined;
}

/** A chunk's subjects, analysed, with the keys their searches could use. */
export interface PreparedReverseIndex {
  /** Every key a subject's searches could use, for the frequencies of the list. */
  readonly keys: ReadonlySet<string>;
  build(options?: ReverseIndexOptions): ReverseIndex;
}

interface PreparedName {
  readonly name: AnalysedName;
  /** The name's query keys (its search's keys). */
  readonly keys: readonly string[];
  /** The key groups that reach its list names (`queryNameReach`). */
  readonly reach: readonly (readonly string[])[];
  /** Its search always looks it up by trigrams (a single word, or an additional name). */
  readonly trigramAlways: boolean;
}

interface PreparedSubject {
  readonly item: ReverseSubject;
  readonly names: readonly PreparedName[];
}

/**
 * Prepares the index of one chunk: each name's keys and reach, computed once.
 * @throws {RangeError} over {@link REVERSE_INDEX_MAX_SUBJECTS} subjects.
 */
export function prepareReverseIndex(
  subjects: readonly ReverseSubject[],
  groups: VariantGroups,
): PreparedReverseIndex {
  if (subjects.length > REVERSE_INDEX_MAX_SUBJECTS) {
    throw new RangeError(`a reverse index holds at most ${String(REVERSE_INDEX_MAX_SUBJECTS)}`);
  }
  const keys = new Set<string>();
  const prepared: PreparedSubject[] = subjects.map((item) => ({
    item,
    names: (item.subject?.names ?? []).map((name, index): PreparedName => {
      const nameKeys = queryNameKeys([name], groups);
      const reach = queryNameReach([name], groups);
      nameKeys.forEach((key) => keys.add(key));
      reach.flat().forEach((key) => keys.add(key));
      return {
        name,
        keys: nameKeys,
        reach,
        trigramAlways: index > 0 || !name.normalised.includes(' '),
      };
    }),
  }));
  return { keys, build: (options = {}) => buildIndex(prepared, groups, options) };
}

/** Builds the index of one chunk (see {@link prepareReverseIndex}). */
export function buildReverseIndex(
  subjects: readonly ReverseSubject[],
  groups: VariantGroups,
  options: ReverseIndexOptions = {},
): ReverseIndex {
  return prepareReverseIndex(subjects, groups).build(options);
}

function buildIndex(
  subjects: readonly PreparedSubject[],
  groups: VariantGroups,
  options: ReverseIndexOptions,
): ReverseIndex {
  if (options.bound !== undefined && options.bound < 1) {
    throw new RangeError('a key bound is at least one entry');
  }
  const { frequencies, bound } = options;
  const usable = (key: string) =>
    frequencies === undefined || bound === undefined || (frequencies.get(key) ?? 0) <= bound;
  const keys = new Map<string, Set<string>>();
  const normalised = new Map<string, Set<string>>();
  const identifiers = new Map<string, Set<string>>();
  const crypto = new Map<string, Set<string>>();
  const trigrams = new Map<string, Set<number>>();
  const trigramNames: { id: string; size: number }[] = [];
  for (const { item, names } of subjects) {
    for (const prepared of names) {
      const used = prepared.keys.filter(usable);
      // A pair out of reach is looked up by its own pair keys, as the search does; a group out of
      // reach without one (a lone keyed token) is searched by trigrams.
      const outOfReach = prepared.reach.filter((group) => group.every((key) => !usable(key)));
      const pairs = outOfReach.flatMap((group) => group.filter((key) => key.startsWith('p:')));
      const lone = outOfReach.some((group) => !group.some((key) => key.startsWith('p:')));
      [...used, ...pairs].forEach((key) => {
        post(keys, key, item.id);
      });
      post(normalised, prepared.name.normalised, item.id);
      // The search looks a name up by trigrams when none of its keys within the bound is held by
      // two entries (one held by fewer has no frequency) and none of its pairs is out of reach.
      const held =
        frequencies === undefined || used.some((key) => (frequencies.get(key) ?? 0) >= 2);
      if (prepared.trigramAlways || lone || (!held && pairs.length === 0)) {
        const grams = trigramsOf(prepared.name.normalised);
        const at = trigramNames.length;
        trigramNames.push({ id: item.id, size: grams.size });
        grams.forEach((gram) => {
          const holders = trigrams.get(gram);
          if (holders === undefined) {
            trigrams.set(gram, new Set([at]));
          } else {
            holders.add(at);
          }
        });
      }
    }
    for (const { kind, value } of item.subject?.identifiers ?? []) {
      post(identifiers, `${kind}:${value}`, item.id);
    }
    if (item.cryptoAddress !== undefined) {
      post(crypto, item.cryptoAddress, item.id);
    }
  }
  return {
    size: subjects.length,
    candidatesFor(record) {
      const entry = isPrepared(record) ? record : prepareReverseEntry(record, groups);
      const found = new Set<string>();
      const take = (ids: ReadonlySet<string> | undefined) => ids?.forEach((id) => found.add(id));
      entry.weak.forEach((form) => {
        take(normalised.get(form));
      });
      for (const name of entry.strong) {
        for (const key of name.keys) {
          take(keys.get(key));
        }
        if (trigramNames.length > 0) {
          const shared = new Map<number, number>();
          name.trigrams.forEach((gram) => {
            trigrams.get(gram)?.forEach((at) => shared.set(at, (shared.get(at) ?? 0) + 1));
          });
          shared.forEach((count, at) => {
            const target = trigramNames[at];
            if (
              target !== undefined &&
              count / (name.trigrams.size + target.size - count) >= REVERSE_TRIGRAM_THRESHOLD
            ) {
              found.add(target.id);
            }
          });
        }
      }
      entry.identifiers.forEach((identifier) => {
        take(identifiers.get(identifier));
      });
      entry.crypto.forEach((canonical) => {
        take(crypto.get(canonical));
      });
      return [...found].sort();
    },
  };
}

function post(postings: Map<string, Set<string>>, key: string, id: string): void {
  const ids = postings.get(key);
  if (ids === undefined) {
    postings.set(key, new Set([id]));
  } else {
    ids.add(id);
  }
}

const WORD = /[\p{L}\p{N}]+/gu;

/**
 * pg_trgm's trigrams of a text (`show_trgm`): lower-cased, each run of letters and digits padded
 * with two spaces before and one after, every three consecutive characters, as a set.
 */
export function trigramsOf(text: string): Set<string> {
  const grams = new Set<string>();
  for (const [word] of text.toLowerCase().matchAll(WORD)) {
    const padded = Array.from(`  ${word} `);
    for (let index = 0; index + 3 <= padded.length; index += 1) {
      grams.add(padded.slice(index, index + 3).join(''));
    }
  }
  return grams;
}

/** pg_trgm's `similarity`: the trigrams the two texts share over the trigrams of either. */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigramsOf(a);
  const right = trigramsOf(b);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let shared = 0;
  left.forEach((gram) => {
    if (right.has(gram)) {
      shared += 1;
    }
  });
  return shared / (left.size + right.size - shared);
}
