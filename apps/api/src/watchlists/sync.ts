/**
 * C76.2: the sync of one watchlist source, shared by `watchlists:sync`, `pep:sync`, the
 * `watchlists-refresh` tick and `seed:dev`. Owner: `api-watchlists` (Workflow 6A Stage 3).
 *
 * The caller reconciles the source rows first (C76.4). Then, per source:
 * - a source that still lacks its token or User-Agent is not synced: `source_not_configured` on
 *   the row, a sync row for the CLI and the seed, none for the refresh tick, and no request;
 * - without the filtered variant groups, or with another digest, the sync is refused before any
 *   change (`refused_matcher_data`, C78.3);
 * - 1. a session-level `pg_try_advisory_lock` on the sync's dedicated connection (`busy` when
 *   another sync holds it), which every later transaction runs on;
 * - a source keyed by another `keys_version` is re-keyed first from its stored records (V04);
 * - 3. the download, through the list client (C85.1), into a new private directory (mode 0700,
 *   the file 0600; stale ones removed), or the `--import` file, which needs no request;
 * - 4. the SHA-256 of the same open file; `unchanged` when it equals the last applied one;
 * - 5-6. parse and apply in one transaction under the per-source `pg_advisory_xact_lock` and
 *   `FOR UPDATE` of the source row, the guards re-checked there against the locked row: a
 *   publication more than 24 h ahead (`refused_future`), older than the last applied one
 *   (`refused_rollback`, unless `--accept-older-publication`), or removing more than 10% of the
 *   entries, or all of a small source (`refused_mass_removal`, unless `--allow-mass-removal`),
 *   or holding no entry at all, a first publication included (`refused_schema`, unless
 *   `--allow-mass-removal`, R009); a parse failure refuses (`refused_schema`, `refused_size`) and
 *   keeps the previous data;
 * - 7. after commit, the re-screen of a sync that added or changed entries (C74.4), which the
 *   sweep enqueues again if this enqueue is lost.
 *
 * Every `applied` or `unchanged` sync sets `last_checked_at`, which freshness counts from
 * (C76.3); then removed entries older than `OPENVERIFY_WATCHLIST_REMOVED_RETENTION_DAYS` are
 * purged (C76.8). No publisher change signal is asked before the download (owner decision 10
 * after Workflow 6B, which drops C76.2 step 2): every check downloads and compares the SHA-256,
 * which is always correct, where a signal that failed to move would mark a changed list fresh.
 * Logs carry ids, outcomes and counts, never a list value or the EU token.
 *
 * C92.2 (F35, Workflow 7A): the session lock, the private directory, the SHA-256, the apply
 * transaction under the locks and the future, rollback and mass-removal guards are the sync
 * runner's (`sync/runner.ts`), which the network sync shares; this file keeps the watchlist steps.
 */
import { createHash } from 'node:crypto';
import { open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyzeWatchlistTables,
  cleanWatchlistGinPendingLists,
  finishWatchlistSync,
  getWatchlistSourceStates,
  insertWatchlistSync,
  loadLiveEntryHashes,
  lockWatchlistSourceRow,
  lockWatchlistSourceTransaction,
  markEntriesRemoved,
  markRescreensEnqueued,
  purgeRemovedWatchlistEntries,
  rebuildWatchlistKeyDf,
  recordWatchlistSourceApplied,
  recordWatchlistSourceCheck,
  recordWatchlistSourceError,
  rewrittenWatchlistEntryIds,
  setWatchlistGinPendingListLimit,
  trackWatchlistKeyDf,
  tryLockWatchlistSourceSession,
  unlockWatchlistSourceSession,
  watchlistSwitchEnabled,
  watchlistWriteTuning,
  writeWatchlistEntries,
  type Db,
  type WatchlistEntryWrite,
  type WatchlistSyncInput,
} from '@openverify/db';
import {
  PublicationDiff,
  buildPepRecords,
  canonicalJson,
  exceedsMassRemoval,
  readPublication,
  type PepBuildOptions,
  type WatchlistParse,
} from '@openverify/watchlist';
import type { WatchlistSettings } from '../config.js';
import type { OutboundHttp } from '../http/index.js';
import type { WorkerLogger } from '../jobs/logger.js';
import type { Clock, ReportRescreenQueue } from '../ports.js';
import {
  applyUnderSourceLocks,
  checkPublicationGuards,
  inSourceTransaction,
  privateDirectory,
  withSourceSessionLock,
  type SourceLocks,
} from '../sync/runner.js';
import { checkSourceConditionally } from './conditional.js';
import { WatchlistDownloadError, createSparqlRunner, downloadSourceFile } from './download.js';
import { WatchlistRefusal, hashFile, openPublication, refusalOf } from './formats.js';
import type { MatcherData } from './matcher-data.js';
import {
  manifestSource,
  watchlistManifest,
  type WatchlistManifest,
  type WatchlistManifestSource,
} from './manifest.js';
import { entryWriteOf } from './records.js';
import { rekeyLockedSource } from './rekey.js';
import type { WatchlistSession } from './sync-session.js';

export {
  poolWatchlistSessions,
  sharedWatchlistSession,
  type WatchlistSession,
} from './sync-session.js';
export { FUTURE_PUBLICATION_MS, STALE_DIRECTORY_MS } from '../sync/runner.js';

export interface WatchlistSyncDeps {
  /** Short statements outside the sync's session (audit rows of refusals, the purge). */
  db: Db;
  /** Opens the sync's dedicated connection. */
  connect(): Promise<WatchlistSession>;
  clock: Clock;
  logger: WorkerLogger;
  settings: WatchlistSettings;
  /** The list clients' factory; absent, a download fails `download_failed`. */
  outboundHttp?: OutboundHttp | undefined;
  /** Enqueues the re-screen of a sync left `pending`, after its commit (C74.4). */
  rescreens?: ReportRescreenQueue | undefined;
  /** The filtered variant groups and the keys version they give (C78.3). */
  matcherData(): MatcherData;
  manifest?: WatchlistManifest | undefined;
  /** Where the private download directories go; the system's temporary directory by default. */
  temporaryDirectory?: string | undefined;
  /** Waits between Wikidata retries (tests pass an instant one). */
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
}

export interface WatchlistSyncRequest {
  sourceId: string;
  actor: 'cli' | 'job' | 'seed';
  /** `--import <file>`: a local file in the source's own format, or the normalised JSON. */
  importPath?: string | undefined;
  allowMassRemoval?: boolean | undefined;
  acceptOlderPublication?: boolean | undefined;
  allowNormalised?: boolean | undefined;
}

export type WatchlistSyncOutcomeName =
  | 'applied'
  | 'unchanged'
  | 'busy'
  | 'refused_rollback'
  | 'refused_future'
  | 'refused_mass_removal'
  | 'refused_schema'
  | 'refused_size'
  | 'refused_matcher_data'
  | 'error';

/** What one sync did: counts, codes and ids only, never a list value. */
export interface WatchlistSyncResult {
  sourceId: string;
  outcome: WatchlistSyncOutcomeName;
  /** The `watchlist_syncs` row, or `null` when none was written (a skipped refresh). */
  syncId: number | null;
  /** The source was re-keyed first (C78.3), which wrote a `rekeyed` row. */
  rekeyed: boolean;
  entryCount: number;
  added: number;
  changed: number;
  removed: number;
  /** `pending` when the re-screen is left to the sweep's recovery. */
  rescreen: 'none' | 'enqueued' | 'pending';
  /** The source's last error code, for an outcome other than applied or unchanged. */
  errorCode: string | null;
}

/** The source id is not in the manifest. */
export class UnknownWatchlistSourceError extends Error {
  override name = 'UnknownWatchlistSourceError';
}

/** A source that is only ever imported (the sandbox lists) was asked to download. */
export class ImportOnlyWatchlistSourceError extends Error {
  override name = 'ImportOnlyWatchlistSourceError';
}

/** Records written per statement batch. */
export const SYNC_BATCH = 500;

/**
 * C270.3 (Workflow 11D; fix-11d): the sync cleans the names' GIN pending lists (11B's
 * `openverify_gin_clean_pending_lists`, which the runtime role may execute) every this many written
 * batches, besides the clean after its writes. Basis (docs/calibration/watchlist-phase11.md, method
 * item 9): of the status quo and the five options, each kept screening within twice its idle p95
 * during the 2,000,000-name sync, and this one at the lowest sync cost (median 500.3 s against the
 * status quo's 518.4 s; screening p95 during it 415.2 against 433.8 ms). The tuning
 * `ginCleanEveryBatches` still overrides it for a measurement.
 */
export const GIN_CLEAN_EVERY_BATCHES = 50;
const DIRECTORY_PREFIX = 'openverify-watchlist-';

/** C76.2: the watchlist source locks, as the sync runner takes them. */
const WATCHLIST_LOCKS: SourceLocks<Awaited<ReturnType<typeof lockWatchlistSourceRow>>> = {
  trySession: tryLockWatchlistSourceSession,
  unlockSession: unlockWatchlistSourceSession,
  transaction: lockWatchlistSourceTransaction,
  row: async (tx, sourceId) => lockWatchlistSourceRow(tx, sourceId),
};
const DAY_MS = 86_400_000;

/** C76.4: the source has the setting it needs (the EU token, the Wikidata contact). */
export function isWatchlistSourceConfigured(
  source: WatchlistManifestSource,
  settings: WatchlistSettings,
): boolean {
  switch (source.requires) {
    case 'eu_fsf_token':
      return settings.euFsfToken !== null && settings.euFsfToken !== '';
    case 'wikidata_user_agent':
      return settings.wikidataUserAgent !== null && settings.wikidataUserAgent !== '';
    default:
      return true;
  }
}

interface Counts {
  entryCount: number;
  added: number;
  changed: number;
  removed: number;
}

const NO_COUNTS: Counts = { entryCount: 0, added: 0, changed: 0, removed: 0 };

/** A refusal found inside the apply transaction, which rolls it back. */
class ApplyRefusal extends Error {
  constructor(
    readonly refusal: WatchlistRefusal,
    readonly counts: Counts,
    readonly publishedAt: Date | null,
  ) {
    super(refusal.message);
  }
}

/** A live Wikidata build whose records equal the last applied ones: rolled back as unchanged. */
class UnchangedBuild extends Error {}

/** The digest of a live Wikidata build: the canonical JSON of its records, in order. */
function hashingParse(parse: WatchlistParse, hash: ReturnType<typeof createHash>): WatchlistParse {
  return (async function* () {
    for (;;) {
      const step = await parse.next();
      if (step.done === true) {
        return step.value;
      }
      hash.update(`${canonicalJson(step.value)}\n`);
      yield step.value;
    }
  })();
}

/** C76.2: syncs one source; see the file header. */
export async function syncWatchlistSource(
  deps: WatchlistSyncDeps,
  request: WatchlistSyncRequest,
): Promise<WatchlistSyncResult> {
  const manifest = deps.manifest ?? watchlistManifest();
  const source = manifestSource(request.sourceId, manifest);
  if (source === undefined) {
    throw new UnknownWatchlistSourceError('the manifest has no source with this id');
  }
  const sourceId = source.id;
  const importing = request.importPath !== undefined;
  const origin = importing ? 'import' : 'publisher';
  if (!importing && source.urls.length === 0) {
    throw new ImportOnlyWatchlistSourceError(`${sourceId} is imported only: pass --import`);
  }
  const startedAt = deps.clock.now();
  const base = { sourceId, rekeyed: false, rescreen: 'none' as const };
  const finish = (result: WatchlistSyncResult): WatchlistSyncResult => {
    deps.logger.info(
      {
        sourceId,
        outcome: result.outcome,
        syncId: result.syncId,
        rekeyed: result.rekeyed,
        entryCount: result.entryCount,
        added: result.added,
        changed: result.changed,
        removed: result.removed,
        rescreen: result.rescreen,
        errorCode: result.errorCode,
      },
      'watchlist sync finished',
    );
    return result;
  };
  /** A sync row written outside the apply transaction (refusals, errors, busy). */
  const audit = (input: Partial<WatchlistSyncInput> & Pick<WatchlistSyncInput, 'outcome'>) =>
    insertWatchlistSync(deps.db, {
      sourceId,
      startedAt,
      finishedAt: deps.clock.now(),
      actor: request.actor,
      origin,
      ...input,
    });

  // Not configured: nothing is requested (C76.4).
  if (!importing && !isWatchlistSourceConfigured(source, deps.settings)) {
    await recordWatchlistSourceError(deps.db, { sourceId, code: 'source_not_configured' });
    const syncId = request.actor === 'job' ? null : await audit({ outcome: 'error', origin: null });
    return finish({
      ...base,
      ...NO_COUNTS,
      outcome: 'error',
      syncId,
      errorCode: 'source_not_configured',
    });
  }

  // C78.3 (F14): no sync without the filtered variant groups.
  const matcher = deps.matcherData();
  if (matcher.status !== 'loaded') {
    await recordWatchlistSourceError(deps.db, { sourceId, code: 'refused_matcher_data' });
    const syncId = await audit({ outcome: 'refused_matcher_data' });
    return finish({
      ...base,
      ...NO_COUNTS,
      outcome: 'refused_matcher_data',
      syncId,
      errorCode: 'refused_matcher_data',
    });
  }

  // 1. The session-level lock (P07), through the sync runner.
  return withSourceSessionLock(() => deps.connect(), WATCHLIST_LOCKS, sourceId, {
    busy: async () => {
      const syncId = await audit({ outcome: 'busy' });
      return finish({ ...base, ...NO_COUNTS, outcome: 'busy', syncId, errorCode: null });
    },
    locked: (session) => syncLocked(session, source, matcher),
  });

  async function syncLocked(
    session: WatchlistSession,
    source: WatchlistManifestSource,
    matcher: Extract<MatcherData, { status: 'loaded' }>,
  ): Promise<WatchlistSyncResult> {
    let handle: FileHandle | null = null;
    let directory: string | null = null;
    try {
      const [state] = await getWatchlistSourceStates(session.db, [sourceId]);
      if (state === undefined) {
        throw new Error(`${sourceId} has no source row: reconcile the sources first`);
      }

      // V04: a source keyed by another version is re-keyed from its stored records first.
      let rekeyed = false;
      if (state.keysVersion !== null && state.keysVersion !== matcher.keysVersion) {
        await rekeyLockedSource(session.db, {
          sourceId,
          groups: matcher.groups,
          keysVersion: matcher.keysVersion,
          actor: request.actor,
          clock: deps.clock,
        });
        rekeyed = true;
      }

      const pepOptions: PepBuildOptions = {
        now: deps.clock.now(),
        includeRelatives: deps.settings.pep.includeRelatives,
        openTenureMaxYears: deps.settings.pep.openTenureMaxYears,
        retentionMonths: deps.settings.pep.retentionMonths,
        headRetentionMonths: deps.settings.pep.headRetentionMonths,
      };
      const refused = async (
        refusal: WatchlistRefusal,
        extra: Partial<WatchlistSyncInput> = {},
      ) => {
        await recordWatchlistSourceError(deps.db, {
          sourceId,
          code: refusal.outcome,
          failedAt: deps.clock.now(),
        });
        const counts = {
          entryCount: extra.entryCount ?? 0,
          added: extra.added ?? 0,
          changed: extra.changed ?? 0,
          removed: extra.removed ?? 0,
        };
        const syncId = await audit({ outcome: refusal.outcome, ...extra });
        return finish({
          ...base,
          rekeyed,
          ...counts,
          outcome: refusal.outcome,
          syncId,
          errorCode: refusal.outcome,
        });
      };

      /** The publication is unchanged (its digest, or the publisher's 304): recorded, nothing applied. */
      const recordUnchanged = async (sha256: string | null) => {
        const syncId = await inSourceTransaction(
          session.db,
          WATCHLIST_LOCKS,
          sourceId,
          async (tx) => {
            await recordWatchlistSourceCheck(tx, { sourceId, at: deps.clock.now() });
            return insertWatchlistSync(tx, {
              sourceId,
              startedAt,
              finishedAt: deps.clock.now(),
              outcome: 'unchanged',
              sha256,
              actor: request.actor,
              origin,
              keysVersion: matcher.keysVersion,
            });
          },
        );
        await purge(deps);
        return finish({
          ...base,
          rekeyed,
          ...NO_COUNTS,
          outcome: 'unchanged',
          syncId,
          errorCode: null,
        });
      };

      // 3-4. The file, hashed from the handle it is parsed from.
      let sha256: string;
      let opened: { parse: WatchlistParse; normalisedOverride: boolean };
      const live = !importing && source.parser === 'wikidata-sparql';
      const liveHash = createHash('sha256');
      try {
        if (live) {
          sha256 = '';
          opened = {
            parse: hashingParse(
              buildPepRecords(
                createSparqlRunner({
                  outboundHttp: deps.outboundHttp,
                  source,
                  url: deps.settings.wikidataSparqlUrl,
                  userAgent: deps.settings.wikidataUserAgent ?? '',
                  sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
                }),
                pepOptions,
              ),
              liveHash,
            ),
            normalisedOverride: false,
          };
        } else {
          if (importing) {
            handle = await open(request.importPath ?? '', 'r');
          } else {
            directory = await privateDirectory(
              deps.temporaryDirectory ?? tmpdir(),
              deps.clock.now(),
              DIRECTORY_PREFIX,
            );
            // C254.2 (Workflow 11B Stage 1b (D), `foundation-11b`'s hook): the validator step
            // (`ingestion-11b`'s conditional.ts): a 304 records the check as unchanged and
            // downloads nothing; otherwise the download sends the step's headers.
            const conditional = await checkSourceConditionally({
              db: session.db,
              source,
              now: deps.clock.now(),
              settings: deps.settings,
              outboundHttp: deps.outboundHttp,
            });
            if (conditional.kind === 'not-modified') {
              return await recordUnchanged(state.lastSha256);
            }
            handle = await open(join(directory, `${sourceId}.download`), 'w+', 0o600);
            await downloadSourceFile(source, {
              outboundHttp: deps.outboundHttp,
              settings: deps.settings,
              handle,
              headers: conditional.headers,
            });
          }
          sha256 = await hashFile(handle);
          if (sha256 === state.lastSha256) {
            return await recordUnchanged(sha256);
          }
          opened = await openPublication(source, handle, (await handle.stat()).size, {
            allowNormalised: request.allowNormalised === true,
            pep: pepOptions,
          });
        }
      } catch (error) {
        if (error instanceof WatchlistDownloadError) {
          await recordWatchlistSourceError(deps.db, {
            sourceId,
            code: error.code,
            failedAt: deps.clock.now(),
          });
          const syncId = await audit({ outcome: 'error' });
          return finish({
            ...base,
            rekeyed,
            ...NO_COUNTS,
            outcome: 'error',
            syncId,
            errorCode: error.code,
          });
        }
        const refusal = refusalOf(error);
        if (refusal !== null) {
          return await refused(refusal);
        }
        throw error;
      }

      // 5-6. Parse and apply in one transaction, the guards re-checked under the locks.
      const now = deps.clock.now();
      let applied: { syncId: number; counts: Counts; rescreenState: 'none' | 'pending' };
      try {
        applied = await applyUnderSourceLocks(
          session.db,
          WATCHLIST_LOCKS,
          sourceId,
          async (tx, row) => {
            const syncId = await insertWatchlistSync(tx, {
              sourceId,
              startedAt,
              finishedAt: null,
              outcome: 'applied',
              actor: request.actor,
              origin,
              keysVersion: matcher.keysVersion,
              sha256: live ? null : sha256,
            });
            const previous = await loadLiveEntryHashes(tx, sourceId);
            const diff = new PublicationDiff(previous);
            // C270.1 (Workflow 11D): behind `incremental-key-df` (off by default), the key
            // frequencies move by the delta of the entries this sync writes and removes, in this
            // transaction, instead of being rebuilt over the whole source after the writes.
            const keyDf = watchlistSwitchEnabled('incremental-key-df')
              ? trackWatchlistKeyDf(tx, sourceId)
              : null;
            // C270.3 (Workflow 11D): the GIN options: a lower pending-list limit for this transaction
            // (off unless its tuning is set), and a clean of the names' pending lists every
            // GIN_CLEAN_EVERY_BATCHES batches that wrote a row (screening reads every pending entry).
            const { ginPendingListLimitKb, ginCleanEveryBatches: cleanTuning } =
              watchlistWriteTuning();
            const ginCleanEveryBatches = cleanTuning ?? GIN_CLEAN_EVERY_BATCHES;
            if (ginPendingListLimitKb !== null) {
              await setWatchlistGinPendingListLimit(tx, ginPendingListLimitKb);
            }
            let writtenBatches = 0;
            let batch: WatchlistEntryWrite[] = [];
            let entryCount = 0;
            let written = 0;
            let analyseAt = SYNC_BATCH;
            const flush = async () => {
              if (batch.length > 0) {
                const entries = batch;
                const write = () => writeWatchlistEntries(tx, { sourceId, syncId, entries });
                await (keyDf === null
                  ? write()
                  : keyDf.track(rewrittenWatchlistEntryIds(entries), write));
                if (entries.some((entry) => entry.change !== 'unchanged')) {
                  writtenBatches += 1;
                  if (writtenBatches % ginCleanEveryBatches === 0) {
                    await cleanWatchlistGinPendingLists(tx, sourceId);
                  }
                }
                written += batch.length;
                batch = [];
                // C78.7: statistics that still describe the tables before these writes make every
                // foreign-key check read the whole source; refresh them as the writes grow fourfold.
                if (written >= analyseAt) {
                  await analyzeWatchlistTables(tx);
                  analyseAt *= 4;
                }
              }
            };
            let publication;
            try {
              publication = await readPublication(opened.parse, async (record) => {
                entryCount += 1;
                batch.push(entryWriteOf(record, diff.add(record), matcher.groups));
                if (batch.length >= SYNC_BATCH) {
                  await flush();
                }
              });
            } catch (error) {
              const refusal = refusalOf(error);
              throw refusal === null
                ? error
                : new ApplyRefusal(refusal, { ...NO_COUNTS, entryCount }, null);
            }
            await flush();
            const summary = diff.finish();
            const counts: Counts = {
              entryCount,
              added: summary.added.length,
              changed: summary.changed.length,
              removed: summary.removed.length,
            };
            const publishedAt = new Date(publication.publishedAt);
            const digest = live ? liveHash.digest('hex') : sha256;
            if (live && digest === row?.lastSha256) {
              throw new UnchangedBuild();
            }
            const refuse = (outcome: WatchlistRefusal['outcome'], rule: string) =>
              new ApplyRefusal(new WatchlistRefusal(outcome, rule), counts, publishedAt);
            // The sync runner's guards, re-checked against the locked row (C92.2).
            const guards = checkPublicationGuards({
              publishedAt,
              lastPublishedAt: row?.lastPublishedAt ?? null,
              now,
              acceptOlderPublication: request.acceptOlderPublication === true,
              massRemoval: {
                exceeded: exceedsMassRemoval(previous.size, counts.removed),
                allowed: request.allowMassRemoval === true,
              },
            });
            if (guards.refusal !== null) {
              const outcome = guards.refusal.outcome;
              if (outcome === 'refused_mass_addition') {
                throw new Error('the watchlist sync has no mass-addition guard');
              }
              throw refuse(outcome, guards.refusal.rule);
            }
            const overrides: NonNullable<WatchlistSyncInput['override']>[] =
              guards.overrides.filter((override) => override !== 'allow-mass-addition');
            // R009: no publisher's list is empty, so a publication without entries (a schema change
            // that moved them, a broken answer) is refused even on a source with none yet, which
            // would otherwise read fresh and clear every subject; `--allow-mass-removal` empties it.
            if (counts.entryCount === 0 && !overrides.includes('allow-mass-removal')) {
              if (request.allowMassRemoval !== true) {
                throw refuse('refused_schema', 'the publication has no entries');
              }
              overrides.push('allow-mass-removal');
            }
            if (opened.normalisedOverride) {
              overrides.push('allow-normalised');
            }
            // Removals come from the diff, so an unchanged entry is never rewritten (evaluation-6).
            const remove = () =>
              markEntriesRemoved(tx, { sourceId, entryIds: summary.removed, at: now });
            if (keyDf === null) {
              await remove();
              await rebuildWatchlistKeyDf(tx, sourceId);
            } else {
              await keyDf.track(summary.removed, remove);
              await keyDf.finish();
            }
            await recordWatchlistSourceApplied(tx, {
              sourceId,
              syncId,
              publishedAt,
              sha256: digest,
              at: deps.clock.now(),
              origin,
              keysVersion: matcher.keysVersion,
            });
            const rescreenState = counts.added + counts.changed > 0 ? 'pending' : 'none';
            await finishWatchlistSync(tx, syncId, {
              finishedAt: deps.clock.now(),
              publishedAt,
              sha256: digest,
              ...counts,
              override: overrides[0] ?? null,
              rescreenState,
            });
            return { syncId, counts, rescreenState };
          },
        );
      } catch (error) {
        if (error instanceof UnchangedBuild) {
          const syncId = await inSourceTransaction(
            session.db,
            WATCHLIST_LOCKS,
            sourceId,
            async (tx) => {
              await recordWatchlistSourceCheck(tx, { sourceId, at: deps.clock.now() });
              return insertWatchlistSync(tx, {
                sourceId,
                startedAt,
                finishedAt: deps.clock.now(),
                outcome: 'unchanged',
                actor: request.actor,
                origin,
                keysVersion: matcher.keysVersion,
              });
            },
          );
          await purge(deps);
          return finish({
            ...base,
            rekeyed,
            ...NO_COUNTS,
            outcome: 'unchanged',
            syncId,
            errorCode: null,
          });
        }
        if (error instanceof ApplyRefusal) {
          return await refused(error.refusal, {
            ...error.counts,
            publishedAt: error.publishedAt,
            sha256: live ? null : sha256,
          });
        }
        if (error instanceof WatchlistDownloadError) {
          await recordWatchlistSourceError(deps.db, {
            sourceId,
            code: error.code,
            failedAt: deps.clock.now(),
          });
          const syncId = await audit({ outcome: 'error' });
          return finish({
            ...base,
            rekeyed,
            ...NO_COUNTS,
            outcome: 'error',
            syncId,
            errorCode: error.code,
          });
        }
        throw error;
      }

      // 7. After commit: the re-screen (C74.4) and the purge (C76.8).
      let rescreen: WatchlistSyncResult['rescreen'] = 'none';
      if (applied.rescreenState === 'pending') {
        rescreen = 'pending';
        if (deps.rescreens !== undefined) {
          try {
            await deps.rescreens.enqueueReportRescreen({ syncId: applied.syncId });
            await markRescreensEnqueued(deps.db, {
              syncIds: [applied.syncId],
              at: deps.clock.now(),
            });
            rescreen = 'enqueued';
          } catch (error) {
            deps.logger.warn(
              { sourceId, syncId: applied.syncId, error: (error as Error).name },
              'watchlist re-screen not enqueued; the report sweep enqueues it again',
            );
          }
        }
      }
      await purge(deps);
      return finish({
        ...base,
        rekeyed,
        ...applied.counts,
        outcome: 'applied',
        syncId: applied.syncId,
        rescreen,
        errorCode: null,
      });
    } finally {
      await handle?.close().catch(() => undefined);
      if (directory !== null) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}

/** C76.8: removed entries older than the retention go, whichever source they were in. */
async function purge(deps: WatchlistSyncDeps): Promise<void> {
  await purgeRemovedWatchlistEntries(deps.db, {
    before: new Date(deps.clock.now().getTime() - deps.settings.removedRetentionDays * DAY_MS),
  });
}
