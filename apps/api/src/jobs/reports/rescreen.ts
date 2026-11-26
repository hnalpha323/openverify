/**
 * C74.4 (V05; Workflow 6A Stage 3, owner `api-watchlists`; reworked by `matcher-6c`, owner decision
 * 3 after 6B, and by `rescreen-6d`, owner decision 4 after 6C): the re-screen after a list update.
 *
 * - {@link processReportRescreen} is the `report-rescreen` processor (`worker.ts`). For the sync
 *   of the job it reads the entries the sync added or changed once (their keys, trigrams and strong
 *   names prepared once, for every chunk), then takes in turn each environment holding recurring
 *   reports of a type that selects the source (`listRescreenEnvironments`), and builds the reverse
 *   index of their decrypted subjects in chunks of at most 50,000 (`listRecurringReportSubjects`,
 *   C78.6), keyed by the keys each report's own search would use: the source's key frequencies,
 *   read once per re-screen (the whole table in one statement when it fits, else each key once),
 *   within the bound of the cap. Each pinned configuration is resolved once. For each page of
 *   changed entries it collects the subjects every entry reaches, then screens each subject once
 *   over its entries as that report's own run would (its pinned configuration: the preset, the
 *   filters, the PEP classes), stopping at the preset's minimum (`keptOnly`), after a name-bound
 *   check that drops the entries no name pair can score at the display floor. It inserts a
 *   `list_update` run (`insertListUpdateRuns`, once per report and sync) only for a report whose
 *   own screening keeps a match, or whose admission it cannot decide without more than the entry (a
 *   PEP relative stored without `relative_of_class`). It also inserts a run for every re-screened
 *   report with an `open` or `delisted` match on a changed entry (`listReportsWithLiveMatches`, by
 *   the entries' `entry_index` under the blind-index key), so its next run re-scores evidence that
 *   may no longer hold (C75.8); without the key it takes every live match on the source, and says
 *   so. A `list_update` run also screens its trigger sync's changed entries beside retrieval, a page
 *   at a time (`screening.ts`), so what this screen found, the run finds. Finally it sets the sync's
 *   `rescreen_state` to `done`, and its result states the milliseconds of each part. Nothing about
 *   the subjects is persisted (decision 23).
 * - {@link recoverPendingRescreens} is step (c) of the `report-sweep` (C74.3): it enqueues
 *   `report-rescreen` again for every applied sync still `pending` whose `rescreen_enqueued_at` is
 *   null or older than 15 minutes, so a re-screen lost to a Valkey outage or a crash still runs.
 *
 * The re-screen takes no lock of the source. A sync of the same source that applies while it runs
 * rebuilds the frequencies in its own transaction: a whole table read before that commit keeps its
 * snapshot, and a key read key by key after it takes the new count; either way no key changes value
 * within one re-screen, and the later sync's own re-screen keys every subject with its frequencies.
 *
 * Without the matcher data (C78.3) the job fails and the sync stays `pending`: BullMQ retries it,
 * then the sweep enqueues it again. Logs carry ids and counts only, never a subject or a name.
 */
import {
  getWatchlistSync,
  insertListUpdateRuns,
  listChangedWatchlistEntries,
  listPendingRescreenSyncs,
  listRecurringReportSubjects,
  listReportsWithLiveMatches,
  listRescreenEnvironments,
  markRescreenDone,
  markRescreensEnqueued,
  reportMatchEntryIndex,
  RESCREEN_CHUNK_LIMIT,
  watchlistKeyFrequencies,
  watchlistKeyFrequencyTable,
  watchlistSwitchEnabled,
  type Db,
  type RecurringReportSubject,
} from '@openverify/db';
import { REPORT_QUERY_SCHEMAS, resolveReportTemplateConfig } from '@openverify/contracts';
import {
  keyFrequencyBound,
  REPORT_REGISTRY,
  REPORT_TYPES,
  SCREENING_CONSTANTS,
  type ReportType,
} from '@openverify/core';
import {
  analyseRecordName,
  canonicaliseCryptoAddress,
  createTokenPairMemo,
  nameScoreUpperBound,
  prepareReverseEntry,
  prepareReverseIndex,
  resolveNameMatching,
  screenCandidates,
  screenCryptoAddress,
  type AnalysedName,
  type NameMatchingConfig,
  type PreparedReverseEntry,
  type ResolvedNameMatching,
  type ReverseSubject,
  type ScreeningCandidate,
  type TokenPairMemo,
  type VariantGroups,
  type WatchlistRecord,
} from '@openverify/watchlist';
import type { WatchlistSettings } from '../../config.js';
import type { Clock, ReportRescreenJob, ReportRescreenQueue } from '../../ports.js';
import { loadMatcherData, type MatcherData } from '../../watchlists/matcher-data.js';
import { manifestSource } from '../../watchlists/manifest.js';
import type { WorkerLogger } from '../logger.js';
import { businessWatchlistScreening } from '../report-types/business-watchlist.js';
import { politicallyExposedPersonScreening } from '../report-types/politically-exposed-person.js';
import { watchlistScreening } from '../report-types/watchlist.js';
import type { NameScreening } from './screening.js';

export interface ReportRescreenDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  watchlists: WatchlistSettings;
  /** The filtered variant groups (C78.3); `loadMatcherData()` unless a test passes its own. */
  matcherData?: (() => MatcherData) | undefined;
  /**
   * Owner decision 3 after 6B: the blind-index key, which keys a changed entry as the matches do
   * (`entry_index`), so the reports with a live match on it get a run. Without it, every report with
   * a live match on the source gets one.
   */
  blindIndexKey?: Uint8Array | undefined;
  /**
   * The most subjects one chunk of the reverse index holds: {@link RESCREEN_CHUNK_LIMIT} unless a
   * test passes fewer, to screen several chunks of a small environment.
   */
  subjectsPerChunk?: number | undefined;
  /**
   * A source with at most this many key frequencies is read whole, once:
   * {@link RESCREEN_FREQUENCY_TABLE_ROWS} unless a test passes another bound.
   */
  frequencyTableRows?: number | undefined;
}

/** What one re-screen did; counts only. */
export interface ReportRescreenResult {
  environments: number;
  subjects: number;
  runsInserted: number;
  /** Owner decision 3 after 6B: reports whose own screening keeps a match on a changed entry. */
  matched?: number | undefined;
  /** Reports given a run for a live match on a changed entry (C75.8). */
  stale?: number | undefined;
  /** Owner decision 4 after 6C: the (changed entry, subject) pairs the reverse index found. */
  candidatePairs?: number | undefined;
  /**
   * The screenings made: at most one per candidate subject per page of changed entries, none for a
   * subject none of whose entries passes the name-bound check.
   */
  screenings?: number | undefined;
  /** Where the re-screen's time went (owner decision 4 after 6C); no subject data. */
  phases?: RescreenPhases | undefined;
}

/** The milliseconds one re-screen spent in each of its parts, summed over chunks and pages. */
export interface RescreenPhases {
  /** Reading and preparing the changed entries. */
  readonly changed: number;
  /** Reading and decrypting the subjects' queries. */
  readonly subjects: number;
  /** Building each subject's screening at its pinned configuration. */
  readonly specs: number;
  /** The subjects' keys and reach (`prepareReverseIndex`). */
  readonly prepare: number;
  /** Reading the key frequencies. */
  readonly frequencies: number;
  /** Building the reverse index of each chunk. */
  readonly build: number;
  /** Finding each changed entry's candidate subjects. */
  readonly candidates: number;
  /** Screening the candidate subjects. */
  readonly screen: number;
  /** The stale-evidence lookup and the `list_update` runs inserted. */
  readonly runs: number;
}

export type ProcessReportRescreen = (
  job: ReportRescreenJob,
  deps: ReportRescreenDeps,
) => Promise<ReportRescreenResult>;

/** The re-screen of a sync cannot run without the matcher data; BullMQ and the sweep retry it. */
export class RescreenMatcherDataError extends Error {
  override name = 'RescreenMatcherDataError';
}

/** Changed entries read per page. */
export const RESCREEN_ENTRY_PAGE = 1_000;

/**
 * Owner decision 3 after 6B: the changed entries a re-screen keeps in memory, read once for every
 * chunk of subjects (about 100 MB at most); a larger sync reads them again for each chunk.
 */
export const RESCREEN_ENTRY_MEMORY = 20_000;

const NOTHING: ReportRescreenResult = Object.freeze({
  environments: 0,
  subjects: 0,
  runsInserted: 0,
});

/**
 * Owner decision 4 after 6C: a source with at most this many key frequencies (`watchlist_key_df`
 * rows; about 100 bytes each in memory) is read whole, in one statement, once per re-screen; a
 * larger one is read key by key, each key once. The development 100,000-name table holds 83,697.
 */
export const RESCREEN_FREQUENCY_TABLE_ROWS = 500_000;

/** C78.4: below this name score nothing is returned (`display-floor`). */
const DISPLAY_FLOOR = SCREENING_CONSTANTS['display-floor'].value;

/** C78.3: the bound a key alone may be used within, as each report's own search applies it. */
const KEY_BOUND = keyFrequencyBound(SCREENING_CONSTANTS['candidate-cap'].value);

/** Each name type's screening, as its own job builds it (`jobs/report-types/*.ts`). */
const NAME_SCREENINGS: Partial<
  Record<
    ReportType,
    (
      query: Readonly<Record<string, unknown>>,
      config: Readonly<Record<string, unknown>>,
    ) => NameScreening
  >
> = {
  watchlist: watchlistScreening,
  'business-watchlist': businessWatchlistScreening,
  'politically-exposed-person': politicallyExposedPersonScreening,
};

/** A recurring report's subject, with how its own run would screen the entries that reach it. */
interface Subject {
  readonly reverse: ReverseSubject;
  /**
   * Whether its own run keeps a match on one of `candidates`, or cannot decide from an entry alone.
   * Owner decision 4 after 6C: one screening over every entry that reaches the subject, sharing its
   * pair memo; each candidate is scored on its own, so the answer is the one-by-one answer.
   */
  readonly screen: (entries: readonly ChangedEntry[]) => ScreenOutcome;
}

/** A subject's screen: a match kept, none kept, or nothing left to screen after the bound check. */
type ScreenOutcome = 'kept' | 'none' | 'unscreened';

const outcomeOf = (screened: boolean, kept: boolean): ScreenOutcome =>
  !screened ? 'unscreened' : kept ? 'kept' : 'none';

/** A pinned configuration, resolved (owner decision 4 after 6C: once per version and re-screen). */
interface PinnedConfiguration {
  readonly config: Readonly<Record<string, unknown>>;
  readonly nameMatching: ResolvedNameMatching;
}

type PinnedConfigurations = (row: RecurringReportSubject, type: ReportType) => PinnedConfiguration;

/** The configurations of one re-screen, each version's resolved at its first subject. */
function pinnedConfigurations(): PinnedConfigurations {
  const resolved = new Map<string, PinnedConfiguration>();
  return (row, type) => {
    const key = `${type}\u0000${row.templateVersionId}`;
    let pinned = resolved.get(key);
    if (pinned === undefined) {
      const config = resolveReportTemplateConfig(type, row.config);
      pinned = {
        config,
        nameMatching: resolveNameMatching(config['name-matching'] as NameMatchingConfig),
      };
      resolved.set(key, pinned);
    }
    return pinned;
  };
}

/** A recurring report's subject, or `null` when its stored query cannot be screened. */
function subjectOf(
  row: RecurringReportSubject,
  groups: VariantGroups,
  configurations: PinnedConfigurations,
  memo?: TokenPairMemo,
): Subject | null {
  if (!(REPORT_TYPES as readonly string[]).includes(row.reportType)) {
    return null;
  }
  const type = row.reportType as ReportType;
  const parsed = REPORT_QUERY_SCHEMAS[type].safeParse(row.query);
  if (!parsed.success) {
    return null;
  }
  const query = parsed.data as Record<string, unknown>;
  if (type === 'crypto-address-watchlist') {
    const crypto = query as { 'crypto-address': string; 'chain-id'?: string | null };
    const address = canonicaliseCryptoAddress(crypto['crypto-address'], {
      chainId: crypto['chain-id'] ?? null,
    });
    return address === null
      ? null
      : {
          reverse: { id: row.reportId, cryptoAddress: address.canonical },
          screen: (entries) =>
            outcomeOf(
              true,
              screenCryptoAddress(
                crypto,
                entries.map((entry) => entry.candidate),
              ).matches.length > 0,
            ),
        };
  }
  const screening = NAME_SCREENINGS[type];
  if (screening === undefined) {
    return null;
  }
  const { config, nameMatching } = configurations(row, type);
  const spec = screening(query, config);
  const subject = spec.subject();
  const options = { ...spec.options, nameMatching, groups, keptOnly: true };
  const kinds = new Set<WatchlistRecord['kind']>(options.entityKinds ?? ['entity']);
  const byName = (record: WatchlistRecord) =>
    subject.kind === 'person' ? record.kind === 'individual' : kinds.has(record.kind);
  // Owner decision 4 after 6C: an entry met by name, with no identifier of the subject's or weak
  // alias to match, gives a match only when some name pair's bound reaches the display floor
  // (`screenEntry`: a lower name score is never qualified nor returned).
  const mayMatch = (entry: ChangedEntry) =>
    subject.identifiers.length > 0 ||
    !byName(entry.candidate.record) ||
    (options.screenWeakAliases && entry.weakAliases) ||
    entry.strong.some((list) =>
      subject.names.some(
        (name) => nameScoreUpperBound(name, list, nameMatching, groups, memo) >= DISPLAY_FLOOR,
      ),
    );
  return {
    reverse: { id: row.reportId, subject },
    screen: (entries) => {
      const admit = spec.admit;
      // A PEP relative stored without its own class is admitted by its linked holder, which this
      // screen does not load: it cannot decide, so it is screened and the report's own run decides.
      const admitted = entries.filter(
        (entry) =>
          (admit === undefined ||
            (entry.candidate.record.positions.length === 0 &&
              entry.candidate.record.relative_of_class === undefined) ||
            admit(entry.candidate, () => undefined)) &&
          mayMatch(entry),
      );
      return outcomeOf(
        admitted.length > 0,
        admitted.length > 0 &&
          screenCandidates(
            subject,
            admitted.map((entry) => entry.candidate),
            options,
          ).length > 0,
      );
    },
  };
}

/**
 * Owner decision 4 after 6C: the source's key frequencies for one re-screen, read at its first need
 * and reused for every later chunk and environment. A source whose frequency table holds at most
 * `tableRows` rows is read whole, in one statement: one consistent set. A larger one is read key by
 * key, each key once (one `text[]` parameter a statement), and keeps a key no entry or one entry
 * holds as 0, which the index reads as it reads a key without a row.
 */
export function keyFrequencyReader(db: Db, sourceId: string, tableRows: number) {
  let table: ReadonlyMap<string, number> | null | undefined;
  const frequencies = new Map<string, number>();
  return async (keys: Iterable<string>): Promise<ReadonlyMap<string, number>> => {
    // `undefined` until asked; `null` is the answer "too large", which holds for this re-screen.
    if (table === undefined) {
      table = await watchlistKeyFrequencyTable(db, sourceId, tableRows);
    }
    if (table !== null) {
      return table;
    }
    const missing: string[] = [];
    for (const key of keys) {
      if (!frequencies.has(key)) {
        frequencies.set(key, 0);
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      for (const [key, count] of await watchlistKeyFrequencies(db, sourceId, missing)) {
        frequencies.set(key, count);
      }
    }
    return frequencies;
  };
}

type Phase = keyof RescreenPhases;

/** Owner decision 4 after 6C: the milliseconds each part of one re-screen takes. */
class PhaseClock {
  private readonly spent: Record<Phase, number> = {
    changed: 0,
    subjects: 0,
    specs: 0,
    prepare: 0,
    frequencies: 0,
    build: 0,
    candidates: 0,
    screen: 0,
    runs: 0,
  };

  time<T>(phase: Phase, work: () => T): T {
    const started = performance.now();
    try {
      return work();
    } finally {
      this.spent[phase] += performance.now() - started;
    }
  }

  async timeAsync<T>(phase: Phase, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await work();
    } finally {
      this.spent[phase] += performance.now() - started;
    }
  }

  phases(): RescreenPhases {
    return Object.fromEntries(
      Object.entries(this.spent).map(([phase, milliseconds]) => [phase, Math.round(milliseconds)]),
    ) as unknown as RescreenPhases;
  }
}

interface ChangedEntry {
  readonly candidate: ScreeningCandidate;
  readonly prepared: PreparedReverseEntry;
  /** Its strong names, analysed once for every subject that meets it. */
  readonly strong: readonly AnalysedName[];
  /** Whether it has a weak alias (which only `screen-weak-aliases` screens). */
  readonly weakAliases: boolean;
}

/** The entries the sync added or changed, page by page, each prepared once. */
async function* changedEntries(
  db: Db,
  sync: { id: number; sourceId: string },
  groups: VariantGroups,
  clock: PhaseClock,
): AsyncGenerator<ChangedEntry[]> {
  let afterEntryId: string | undefined;
  for (;;) {
    const page = await clock.timeAsync('changed', () =>
      listChangedWatchlistEntries(db, {
        sourceId: sync.sourceId,
        syncId: sync.id,
        afterEntryId,
        limit: RESCREEN_ENTRY_PAGE,
      }),
    );
    if (page.length === 0) {
      return;
    }
    afterEntryId = page.at(-1)?.entryId;
    yield clock.time('changed', () =>
      page.map((entry) => {
        const record = entry.data as unknown as WatchlistRecord;
        return {
          candidate: { sourceId: entry.sourceId, record },
          prepared: prepareReverseEntry(record, groups),
          strong: record.names
            .filter((name) => name.quality === 'strong')
            .map((name) => analyseRecordName(name, record.kind)),
          weakAliases: record.names.some((name) => name.quality === 'weak'),
        };
      }),
    );
    if (page.length < RESCREEN_ENTRY_PAGE) {
      return;
    }
  }
}

/** C74.4: the `report-rescreen` processor; see the file header. */
export const processReportRescreen: ProcessReportRescreen = async (job, deps) => {
  const sync = await getWatchlistSync(deps.db, job.syncId);
  if (sync?.outcome !== 'applied' || sync.rescreenState !== 'pending') {
    return NOTHING;
  }
  const source = manifestSource(sync.sourceId);
  const reportTypes =
    source === undefined
      ? []
      : REPORT_TYPES.filter((type) => REPORT_REGISTRY[type].sourceKind === source.kind);
  const matcher = (deps.matcherData ?? (() => loadMatcherData()))();
  if (matcher.status !== 'loaded') {
    throw new RescreenMatcherDataError(
      'the re-screen needs the matcher data (data/variant-groups.json, C78.3)',
    );
  }
  const groups = matcher.groups;
  const scope = { sourceId: sync.sourceId, reportTypes };
  const environments = await listRescreenEnvironments(deps.db, scope);
  const clock = new PhaseClock();
  // Owner decision 3 (a): the changed entries are read and prepared once, for every chunk.
  const kept: ChangedEntry[] = [];
  let overflow = false;
  for await (const page of changedEntries(deps.db, sync, groups, clock)) {
    kept.push(...page);
    if (kept.length > RESCREEN_ENTRY_MEMORY) {
      overflow = true;
      kept.length = 0;
      break;
    }
  }
  const pages = async function* (): AsyncGenerator<readonly ChangedEntry[]> {
    if (!overflow) {
      yield kept;
      return;
    }
    yield* changedEntries(deps.db, sync, groups, clock);
  };
  if (environments.length > 0 && deps.blindIndexKey === undefined) {
    deps.logger.warn(
      { syncId: sync.id, sourceId: sync.sourceId },
      'watchlist re-screen without the blind-index key: every report with a live match on the source gets a run',
    );
  }
  const chunkLimit = deps.subjectsPerChunk ?? RESCREEN_CHUNK_LIMIT;
  if (!Number.isInteger(chunkLimit) || chunkLimit < 1 || chunkLimit > RESCREEN_CHUNK_LIMIT) {
    throw new RangeError(`a chunk holds 1 to ${String(RESCREEN_CHUNK_LIMIT)} subjects`);
  }
  const keyFrequencies = keyFrequencyReader(
    deps.db,
    sync.sourceId,
    deps.frequencyTableRows ?? RESCREEN_FREQUENCY_TABLE_ROWS,
  );
  const configurations = pinnedConfigurations();
  // C271.2 (`rescreen-bound-memo`, off by default): the name-bound check of every subject keeps its
  // token pair scores for the whole re-screen (a pair many subjects' names meet is scored once);
  // every bound, and so every screening and run, is the one computed without it.
  const memo = watchlistSwitchEnabled('rescreen-bound-memo') ? createTokenPairMemo() : undefined;
  let subjects = 0;
  let runsInserted = 0;
  let matched = 0;
  let stale = 0;
  let candidatePairs = 0;
  let screenings = 0;
  for (const { environmentId } of environments) {
    // C75.8: the reports with a live match on a changed entry re-score it in their next run.
    const key = deps.blindIndexKey;
    const entryIndexes: string[] | undefined = key === undefined ? undefined : [];
    if (key !== undefined && entryIndexes !== undefined) {
      for await (const page of pages()) {
        clock.time('runs', () => {
          for (const { candidate } of page) {
            entryIndexes.push(
              reportMatchEntryIndex(key, {
                environmentId,
                entryKey: `${candidate.sourceId}:${candidate.record.entry_id}`,
              }),
            );
          }
        });
      }
    }
    const holders = await clock.timeAsync('runs', () =>
      listReportsWithLiveMatches(deps.db, environmentId, { ...scope, entryIndexes }),
    );
    const hits = new Set<string>();
    let afterId: string | undefined;
    for (;;) {
      const chunk = await clock.timeAsync('subjects', () =>
        listRecurringReportSubjects(deps.db, environmentId, {
          ...scope,
          afterId,
          limit: chunkLimit,
        }),
      );
      if (chunk.length === 0) {
        break;
      }
      afterId = chunk.at(-1)?.reportId;
      subjects += chunk.length;
      const byId = clock.time('specs', () => {
        const built = new Map<string, Subject>();
        for (const row of chunk) {
          const subject = subjectOf(row, groups, configurations, memo);
          if (subject !== null) {
            built.set(row.reportId, subject);
          }
        }
        return built;
      });
      const prepared = clock.time('prepare', () =>
        prepareReverseIndex(
          [...byId.values()].map((subject) => subject.reverse),
          groups,
        ),
      );
      const frequencies = await clock.timeAsync('frequencies', () => keyFrequencies(prepared.keys));
      const index = clock.time('build', () => prepared.build({ frequencies, bound: KEY_BOUND }));
      for await (const page of pages()) {
        // Owner decision 4 after 6C: the subjects the entries of a page reach, then one screening
        // of each over every entry that reaches it.
        for (let start = 0; start < page.length; start += RESCREEN_ENTRY_PAGE) {
          const reached = clock.time('candidates', () => {
            const found = new Map<string, ChangedEntry[]>();
            for (const entry of page.slice(start, start + RESCREEN_ENTRY_PAGE)) {
              const ids = index.candidatesFor(entry.prepared);
              candidatePairs += ids.length;
              for (const reportId of ids) {
                if (!hits.has(reportId)) {
                  const entries = found.get(reportId);
                  if (entries === undefined) {
                    found.set(reportId, [entry]);
                  } else {
                    entries.push(entry);
                  }
                }
              }
            }
            return found;
          });
          clock.time('screen', () => {
            for (const [reportId, entries] of reached) {
              const outcome = byId.get(reportId)?.screen(entries);
              if (outcome === 'kept') {
                hits.add(reportId);
              }
              if (outcome === 'kept' || outcome === 'none') {
                screenings += 1;
              }
            }
          });
        }
      }
      if (chunk.length < chunkLimit) {
        break;
      }
    }
    matched += hits.size;
    const staleOnly = holders.filter((reportId) => !hits.has(reportId));
    stale += staleOnly.length;
    runsInserted += await clock.timeAsync('runs', () =>
      insertListUpdateRuns(deps.db, environmentId, {
        syncId: sync.id,
        reportIds: [...hits, ...staleOnly].sort(),
        at: deps.clock.now(),
      }),
    );
  }
  await markRescreenDone(deps.db, sync.id);
  const phases = clock.phases();
  deps.logger.info(
    {
      syncId: sync.id,
      sourceId: sync.sourceId,
      environments: environments.length,
      subjects,
      runsInserted,
      matched,
      stale,
      candidatePairs,
      screenings,
      phases,
    },
    'watchlist re-screen finished',
  );
  return {
    environments: environments.length,
    subjects,
    runsInserted,
    matched,
    stale,
    candidatePairs,
    screenings,
    phases,
  };
};

export interface RecoverPendingRescreensDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  rescreens: ReportRescreenQueue;
}

/** What the recovery did; counts only. */
export interface RecoveredRescreens {
  enqueued: number;
  /** Enqueues that failed; each is logged and tried again on the next sweep. */
  failed: number;
}

export type RecoverPendingRescreens = (
  deps: RecoverPendingRescreensDeps,
) => Promise<RecoveredRescreens>;

/** C74.3 (c): a pending re-screen is enqueued again once its last enqueue is this old. */
export const RESCREEN_REENQUEUE_AFTER_MS = 15 * 60_000;
/** Pending re-screens enqueued per sweep (syncs are rare; the next sweep takes the rest). */
export const RESCREEN_RECOVERY_BATCH = 100;

/** C74.3 (c): enqueues the pending re-screens whose enqueue was lost; see the file header. */
export const recoverPendingRescreens: RecoverPendingRescreens = async (deps) => {
  const now = deps.clock.now();
  const pending = await listPendingRescreenSyncs(deps.db, {
    enqueuedBefore: new Date(now.getTime() - RESCREEN_REENQUEUE_AFTER_MS),
    limit: RESCREEN_RECOVERY_BATCH,
  });
  let enqueued = 0;
  let failed = 0;
  for (const sync of pending) {
    try {
      await deps.rescreens.enqueueReportRescreen({ syncId: sync.id });
    } catch (error) {
      failed += 1;
      deps.logger.warn(
        { syncId: sync.id, sourceId: sync.sourceId, error: (error as Error).name },
        'watchlist re-screen not enqueued; the next sweep tries again',
      );
      continue;
    }
    await markRescreensEnqueued(deps.db, { syncIds: [sync.id], at: now });
    enqueued += 1;
  }
  return { enqueued, failed };
};
