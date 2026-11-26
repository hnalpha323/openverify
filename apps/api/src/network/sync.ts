/**
 * C92.2 (ADR 0006): the sync of one network source, shared by `network:sync`, the `network-refresh`
 * tick and `seed:dev`, on the sync runner (`sync/runner.ts`) the watchlist sync shares. The caller
 * reconciles the source rows first (C92.5). Then, per source:
 *
 * - a disabled source is not synced (`source_disabled`), nor any source without object storage
 *   (`storage_not_configured`): no request is made, and a sync row is written except for the tick;
 * - 1. the session-level advisory lock on the sync's own connection (`busy`);
 * - 2. (void: no change signal, owner decision 10 after Workflow 6B);
 * - 3. the download through the C85.1 stream client into a private 0700 directory, under the
 *   compressed cap and the deadline (DB-IP: this UTC month's file, then last month's), or the
 *   `--import` file (no request, `origin: import`); then gunzip under the inflated cap;
 * - 4. DB-IP's page digest, a SHA-1 of the decompressed file (`refused_digest`; downloads only);
 * - 5. the strict parse into the normalised snapshot (`normalisePublication` of
 *   `@openverify/signals/network`; any parse error is `refused_schema`), whose SHA-256 names the
 *   object and is `unchanged` when it equals the applied one;
 * - 6. apply under the transaction lock and `FOR UPDATE` of the source row, the guards re-checked
 *   there: a publication more than a day ahead (`refused_future`), older than the applied one
 *   (`refused_rollback` unless `--accept-older-publication`), a mass removal (more than the
 *   manifest's share of a range or exit set's addresses gone, or an MMDB under its share of the
 *   applied size: `refused_mass_removal` unless `--allow-mass-removal`), a mass addition (a range
 *   set's covered addresses growing past the share in a family it already covered, or any prefix
 *   shorter than the source's `min_prefix`: `refused_mass_addition` unless
 *   `--allow-mass-addition`), and an empty publication (`refused_schema` unless
 *   `--allow-mass-removal`, as the watchlist sync since Workflow 6C);
 * - 7. the snapshot object `network/<source>/<sha256>` (unenveloped, decision 44) and the
 *   `network_syncs` row, the earlier applied syncs marked superseded; after commit, the purge of
 *   snapshot objects superseded more than 7 days ago, keeping each source's current and previous
 *   one (C92.3, P27).
 *
 * A refusal or a failed download records the source's error and counts toward the refresh tick's
 * back-off (as the watchlists'). Logs carry ids, outcomes, counts and codes, never an address.
 * Owner: `api-network` (Workflow 7A Stage 3).
 */
import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import {
  getNetworkSync,
  insertNetworkSync,
  listNetworkSourceStates,
  listPurgeableNetworkSnapshots,
  lockNetworkSourceRow,
  lockNetworkSourceTransaction,
  markNetworkSnapshotsDeleted,
  recordNetworkSourceApplied,
  recordNetworkSourceCheck,
  recordNetworkSourceError,
  supersedeNetworkSyncs,
  tryLockNetworkSourceSession,
  unlockNetworkSourceSession,
  type Db,
  type NetworkSourceState,
  type NetworkSync,
  type NetworkSyncActor,
  type NetworkSyncInput,
  type NetworkSyncOutcome,
  type NetworkSyncOverride,
} from '@openverify/db';
import {
  IntervalSet,
  TorExitSet,
  compareExitSets,
  compareIntervalSets,
  loadSnapshot,
  normalisePublication,
  type NormalisedPublication,
} from '@openverify/signals/network';
import type { OutboundHttp } from '../http/index.js';
import type { WorkerLogger } from '../jobs/logger.js';
import { metrics } from '../metrics-registry.js';
import type { Clock, FileStorage } from '../ports.js';
import {
  applyUnderSourceLocks,
  checkPublicationGuards,
  inSourceTransaction,
  withPrivateFile,
  withSourceSessionLock,
  type SourceLocks,
  type SyncSession,
} from '../sync/runner.js';
import { NetworkDownloadError, downloadNetworkSource, publisherDigestMatches } from './download.js';
import {
  networkManifest,
  networkManifestSource,
  type NetworkManifest,
  type NetworkManifestGuards,
  type NetworkManifestSource,
} from './manifest.js';

/** C92.3 (P27): superseded snapshot objects are deleted this long after supersession. */
export const SNAPSHOT_PURGE_AFTER_MS = 7 * 24 * 3_600_000;
/** How many superseded snapshot objects one purge deletes at most. */
const PURGE_BATCH = 100;
const DIRECTORY_PREFIX = 'openverify-network-';
const GZIP_MAGIC = [0x1f, 0x8b];

/** The object key of a source's snapshot (C92.3). */
export function snapshotKey(sourceId: string, sha256: string): string {
  return `network/${sourceId}/${sha256}`;
}

export interface NetworkSyncDeps {
  db: Db;
  /** Opens the sync's dedicated connection (`watchlistSessionsOf(db)` gives one per sync). */
  connect(): Promise<SyncSession>;
  clock: Clock;
  logger: WorkerLogger;
  /** Where an applied snapshot is written; without it nothing is synced. */
  storage?: FileStorage | undefined;
  outboundHttp?: OutboundHttp | undefined;
  manifest?: NetworkManifest | undefined;
  /** Where the private download directories go; the system's temporary directory by default. */
  temporaryDirectory?: string | undefined;
}

export interface NetworkSyncRequest {
  sourceId: string;
  actor: NetworkSyncActor;
  /** `--import <file>`: a local file in the source's own format. */
  importPath?: string | undefined;
  /** An import's bytes, given directly (the seed's sandbox bundle). */
  importBytes?: Uint8Array | undefined;
  allowMassRemoval?: boolean | undefined;
  allowMassAddition?: boolean | undefined;
  acceptOlderPublication?: boolean | undefined;
}

/** What one sync did: ids, outcomes, counts and codes only. */
export interface NetworkSyncResult {
  sourceId: string;
  outcome: NetworkSyncOutcome;
  /** The `network_syncs` row, or `null` when none was written (a skipped refresh). */
  syncId: number | null;
  origin: 'publisher' | 'import';
  entryCount: number;
  snapshotBytes: number;
  overrides: NetworkSyncOverride[];
  /** The source's error code, for an outcome other than applied or unchanged. */
  errorCode: string | null;
  /** Superseded snapshot objects the purge deleted after this sync. */
  purged: number;
}

/** The source id is not in the manifest. */
export class UnknownNetworkSourceError extends Error {
  override name = 'UnknownNetworkSourceError';
}

/** An import-only source (Azure, the sandbox) was asked to download. */
export class ImportOnlyNetworkSourceError extends Error {
  override name = 'ImportOnlyNetworkSourceError';
}

/** A refusal: the outcome and the rule it names, never a value. */
class NetworkRefusal extends Error {
  constructor(
    readonly outcome: Exclude<NetworkSyncOutcome, 'applied' | 'unchanged' | 'busy' | 'error'>,
    rule: string,
    readonly publication: NormalisedPublication | null = null,
  ) {
    super(`${outcome}: ${rule}`);
  }
}

/** The applied snapshot equals the publication, found under the lock. */
class UnchangedUnderLock extends Error {}

/** C92.2: the network source locks, as the sync runner takes them. */
const NETWORK_LOCKS: SourceLocks<NetworkSourceState> = {
  trySession: tryLockNetworkSourceSession,
  unlockSession: unlockNetworkSourceSession,
  transaction: lockNetworkSourceTransaction,
  row: lockNetworkSourceRow,
};

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** An import file, read whole into one buffer of its size, under the compressed cap. */
async function readImport(path: string, cap: number): Promise<Buffer> {
  const { size } = await stat(path);
  if (size > cap) {
    throw new NetworkRefusal('refused_size', 'the file is over the source’s byte cap');
  }
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(size);
    await handle.read(buffer, 0, size, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

/** C92.2 step 3: gunzip under the inflated cap (a gzip import of a gzip source, or any download). */
function inflate(raw: Buffer, source: NetworkManifestSource, downloaded: boolean): Buffer {
  const gzipped = GZIP_MAGIC.every((byte, index) => raw[index] === byte);
  if (source.decompress !== 'gzip' || (!gzipped && !downloaded)) {
    if (raw.byteLength > source.max_bytes.inflated) {
      throw new NetworkRefusal('refused_size', 'the file is over the source’s inflated cap');
    }
    return raw;
  }
  try {
    return gunzipSync(raw, { maxOutputLength: source.max_bytes.inflated });
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new NetworkRefusal('refused_size', 'the file inflates past the source’s cap');
    }
    throw new NetworkRefusal('refused_schema', 'the file is not the gzip the source publishes');
  }
}

/** C92.2 step 5: the strict parse. */
function normalise(source: NetworkManifestSource, bytes: Buffer): NormalisedPublication {
  try {
    return normalisePublication(
      source.parser,
      bytes,
      source.provider === null ? {} : { provider: source.provider },
    );
  } catch {
    throw new NetworkRefusal('refused_schema', 'the file does not parse as the source’s format');
  }
}

/** The applied snapshot object, loaded, or `null` when it cannot be read. */
async function previousSnapshot(
  storage: FileStorage,
  sourceId: string,
  sha256: string | null,
  publication: NormalisedPublication,
) {
  if (sha256 === null) {
    return null;
  }
  const bytes = await storage.get(snapshotKey(sourceId, sha256));
  if (bytes === null || sha256Of(bytes) !== sha256) {
    return null;
  }
  try {
    return loadSnapshot(publication.kind, bytes, publication.mmdbRole);
  } catch {
    return null;
  }
}

const share = (part: bigint | number, whole: bigint | number) =>
  Number(whole) === 0 ? 0 : Number(part) / Number(whole);

/** C92.2 step 6: whether the publication removes or adds too much against the applied one. */
async function massChange(
  source: NetworkManifestSource,
  guards: NetworkManifestGuards,
  publication: NormalisedPublication,
  previous: NetworkSync | null,
  storage: FileStorage,
): Promise<{ removal: boolean; addition: boolean }> {
  const minPrefix = source.min_prefix;
  const stats = publication.rangeStats;
  const tooWide =
    minPrefix !== null &&
    stats !== null &&
    ((stats.shortestIpv4Prefix !== null && stats.shortestIpv4Prefix < minPrefix.ipv4) ||
      (stats.shortestIpv6Prefix !== null && stats.shortestIpv6Prefix < minPrefix.ipv6));
  if (previous === null) {
    return { removal: false, addition: tooWide };
  }
  if (publication.kind === 'mmdb') {
    const applied = previous.snapshotBytes ?? 0;
    return {
      removal: publication.bytes.byteLength < guards.mmdb_min_size_share * applied,
      addition: false,
    };
  }
  if (publication.kind === 'sandbox') {
    return { removal: false, addition: false };
  }
  const before = await previousSnapshot(storage, source.id, previous.sha256, publication);
  if (publication.kind === 'tor-exits') {
    const removed =
      before instanceof TorExitSet && publication.snapshot instanceof TorExitSet
        ? share(compareExitSets(before, publication.snapshot).removed, before.size)
        : share(Math.max(0, previous.entryCount - publication.entryCount), previous.entryCount);
    return { removal: removed > guards.mass_removal_share, addition: false };
  }
  const covered = {
    ipv4: BigInt(previous.coveredIpv4 ?? 0),
    ipv6: BigInt(previous.coveredIpv6 ?? '0'),
  };
  const next = publication.coverage ?? { ipv4: 0n, ipv6: 0n };
  let removal: boolean;
  if (before instanceof IntervalSet && publication.snapshot instanceof IntervalSet) {
    const change = compareIntervalSets(before, publication.snapshot);
    removal = [change.ipv4, change.ipv6].some(
      (family) => share(family.removed, family.previous) > guards.mass_removal_share,
    );
  } else {
    removal = (['ipv4', 'ipv6'] as const).some(
      (family) =>
        share(
          covered[family] > next[family] ? covered[family] - next[family] : 0n,
          covered[family],
        ) > guards.mass_removal_share,
    );
  }
  const grew = (['ipv4', 'ipv6'] as const).some(
    (family) =>
      covered[family] > 0n &&
      next[family] > covered[family] &&
      share(next[family] - covered[family], covered[family]) > guards.mass_addition_share,
  );
  return { removal, addition: tooWide || grew };
}

/** C92.2: syncs one source; see the file header. */
export async function syncNetworkSource(
  deps: NetworkSyncDeps,
  request: NetworkSyncRequest,
): Promise<NetworkSyncResult> {
  const manifest = deps.manifest ?? networkManifest();
  const source = networkManifestSource(request.sourceId, manifest);
  if (source === undefined) {
    throw new UnknownNetworkSourceError('the manifest has no source with this id');
  }
  const sourceId = source.id;
  const importing = request.importPath !== undefined || request.importBytes !== undefined;
  const origin: NetworkSyncResult['origin'] = importing ? 'import' : 'publisher';
  if (!importing && source.urls.length === 0 && source.url_template === null) {
    throw new ImportOnlyNetworkSourceError(`${sourceId} is imported only: pass --import`);
  }
  const startedAt = deps.clock.now();
  const base: Pick<
    NetworkSyncResult,
    'sourceId' | 'origin' | 'entryCount' | 'snapshotBytes' | 'overrides' | 'purged'
  > = { sourceId, origin, entryCount: 0, snapshotBytes: 0, overrides: [], purged: 0 };
  const finish = (result: NetworkSyncResult): NetworkSyncResult => {
    deps.logger.info(
      {
        sourceId,
        outcome: result.outcome,
        syncId: result.syncId,
        origin: result.origin,
        entryCount: result.entryCount,
        snapshotBytes: result.snapshotBytes,
        overrides: result.overrides,
        errorCode: result.errorCode,
        purged: result.purged,
      },
      'network sync finished',
    );
    // C250.7: an error or a refusal is a failed sync, counted install-wide (no source label).
    if (result.outcome === 'error' || result.outcome.startsWith('refused_')) {
      metrics.emit(deps.logger, 'network_sync_failed', 1);
    }
    return result;
  };
  const audit = (db: Db, input: Partial<NetworkSyncInput> & Pick<NetworkSyncInput, 'outcome'>) =>
    insertNetworkSync(db, {
      sourceId,
      startedAt,
      finishedAt: deps.clock.now(),
      errorCode: null,
      publishedAt: null,
      sha256: null,
      snapshotBytes: null,
      entryCount: 0,
      coveredIpv4: null,
      coveredIpv6: null,
      actor: request.actor,
      origin,
      overrides: [],
      ...input,
    });

  const state = (await listNetworkSourceStates(deps.db)).find((row) => row.id === sourceId);
  if (state === undefined) {
    throw new Error(`${sourceId} has no source row: reconcile the sources first`);
  }
  const storage = deps.storage;
  if (!state.enabled || storage === undefined) {
    const skipped = state.enabled ? 'storage_not_configured' : 'source_disabled';
    await recordNetworkSourceError(deps.db, { sourceId, code: skipped });
    const syncId =
      request.actor === 'job'
        ? null
        : await audit(deps.db, { outcome: 'error', errorCode: skipped, origin: null });
    return finish({ ...base, outcome: 'error', syncId, errorCode: skipped });
  }

  const result = await withSourceSessionLock(() => deps.connect(), NETWORK_LOCKS, sourceId, {
    busy: async () => {
      const syncId = await audit(deps.db, { outcome: 'busy' });
      return finish({ ...base, outcome: 'busy', syncId, errorCode: null });
    },
    locked: (session) => syncLocked(session, source, storage),
  });
  if (result.outcome !== 'applied' && result.outcome !== 'unchanged') {
    return result;
  }
  return finish({ ...result, purged: await purgeNetworkSnapshots({ ...deps, storage }) });

  async function syncLocked(
    session: SyncSession,
    manifestSource: NetworkManifestSource,
    store: FileStorage,
  ): Promise<NetworkSyncResult> {
    const now = deps.clock.now();
    const failed = async (code: string) => {
      await recordNetworkSourceError(deps.db, { sourceId, code, failedAt: deps.clock.now() });
      const syncId = await audit(deps.db, { outcome: 'error', errorCode: code });
      return finish({ ...base, outcome: 'error', syncId, errorCode: code });
    };
    const refused = async (refusal: NetworkRefusal, extra: Partial<NetworkSyncInput> = {}) => {
      await recordNetworkSourceError(deps.db, {
        sourceId,
        code: refusal.outcome,
        failedAt: deps.clock.now(),
      });
      const publication = refusal.publication;
      const syncId = await audit(deps.db, {
        outcome: refusal.outcome,
        errorCode: null,
        entryCount: publication?.entryCount ?? 0,
        snapshotBytes: publication?.bytes.byteLength ?? null,
        publishedAt: publication?.publishedAt ?? null,
        ...extra,
      });
      return finish({
        ...base,
        outcome: refusal.outcome,
        syncId,
        entryCount: publication?.entryCount ?? 0,
        snapshotBytes: publication?.bytes.byteLength ?? 0,
        errorCode: refusal.outcome,
      });
    };

    // 3-5. The publication, decompressed, checked against the page digest, and parsed.
    let publication: NormalisedPublication;
    let lastModified: Date | null = null;
    try {
      let raw: Buffer;
      if (request.importBytes !== undefined) {
        if (request.importBytes.byteLength > manifestSource.max_bytes.compressed) {
          throw new NetworkRefusal('refused_size', 'the file is over the source’s byte cap');
        }
        raw = Buffer.from(request.importBytes);
      } else if (request.importPath !== undefined) {
        raw = await readImport(request.importPath, manifestSource.max_bytes.compressed);
      } else {
        raw = await withPrivateFile(
          {
            base: deps.temporaryDirectory ?? tmpdir(),
            now,
            prefix: DIRECTORY_PREFIX,
            name: `${sourceId}.download`,
          },
          async (handle) => {
            const download = await downloadNetworkSource(manifestSource, {
              outboundHttp: deps.outboundHttp,
              handle,
              now,
            });
            lastModified = download.lastModified;
            // One buffer of the known length (network-data: chunks joined cost far more memory).
            const buffer = Buffer.allocUnsafe(download.bytes);
            await handle.read(buffer, 0, download.bytes, 0);
            return buffer;
          },
        );
      }
      const bytes = inflate(raw, manifestSource, !importing);
      if (!importing && !(await publisherDigestMatches(manifestSource, bytes, deps.outboundHttp))) {
        throw new NetworkRefusal('refused_digest', 'the publisher’s digest does not match');
      }
      publication = normalise(manifestSource, bytes);
    } catch (error) {
      if (error instanceof NetworkDownloadError) {
        return failed(error.code);
      }
      if (error instanceof NetworkRefusal) {
        return refused(error);
      }
      throw error;
    }
    const sha256 = sha256Of(publication.bytes);
    const publishedAt =
      publication.publishedAt ?? (manifestSource.role === 'tor' ? lastModified : null);
    const unchanged = async () => {
      const syncId = await inSourceTransaction(session.db, NETWORK_LOCKS, sourceId, async (tx) => {
        await recordNetworkSourceCheck(tx, { sourceId, at: deps.clock.now() });
        return audit(tx, {
          outcome: 'unchanged',
          sha256,
          publishedAt,
          entryCount: publication.entryCount,
          snapshotBytes: publication.bytes.byteLength,
        });
      });
      return {
        ...base,
        outcome: 'unchanged' as const,
        syncId,
        entryCount: publication.entryCount,
        snapshotBytes: publication.bytes.byteLength,
        errorCode: null,
      };
    };
    const current = (await listNetworkSourceStates(session.db)).find((row) => row.id === sourceId);
    if (current?.lastSha256 === sha256) {
      return unchanged();
    }

    // 6-7. Apply under the locks, the guards re-checked against the locked row.
    try {
      const applied = await applyUnderSourceLocks(
        session.db,
        NETWORK_LOCKS,
        sourceId,
        async (tx, row) => {
          if (row?.lastSha256 === sha256) {
            throw new UnchangedUnderLock();
          }
          const previous =
            row?.lastSyncId == null ? null : await getNetworkSync(tx, row.lastSyncId);
          const change = await massChange(
            manifestSource,
            manifest.guards,
            publication,
            previous?.outcome === 'applied' ? previous : null,
            store,
          );
          const guards = checkPublicationGuards({
            publishedAt,
            lastPublishedAt: row?.lastPublishedAt ?? null,
            now: deps.clock.now(),
            acceptOlderPublication: request.acceptOlderPublication === true,
            massRemoval: { exceeded: change.removal, allowed: request.allowMassRemoval === true },
            massAddition: {
              exceeded: change.addition,
              allowed: request.allowMassAddition === true,
            },
          });
          if (guards.refusal !== null) {
            throw new NetworkRefusal(guards.refusal.outcome, guards.refusal.rule, publication);
          }
          const overrides: NetworkSyncOverride[] = [...guards.overrides];
          // As the watchlist sync since 6C: no publisher's data is empty, so an empty one is a
          // schema change or a broken answer, refused unless `--allow-mass-removal` empties it.
          if (publication.entryCount === 0 && !overrides.includes('allow-mass-removal')) {
            if (request.allowMassRemoval !== true) {
              throw new NetworkRefusal('refused_schema', 'the publication is empty', publication);
            }
            overrides.push('allow-mass-removal');
          }
          await store.put(snapshotKey(sourceId, sha256), publication.bytes);
          const at = deps.clock.now();
          const syncId = await insertNetworkSync(tx, {
            sourceId,
            startedAt,
            finishedAt: at,
            outcome: 'applied',
            errorCode: null,
            publishedAt,
            sha256,
            snapshotBytes: publication.bytes.byteLength,
            entryCount: publication.entryCount,
            coveredIpv4: publication.coverage === null ? null : Number(publication.coverage.ipv4),
            coveredIpv6: publication.coverage?.ipv6.toString() ?? null,
            actor: request.actor,
            origin,
            overrides,
          });
          await recordNetworkSourceApplied(tx, {
            sourceId,
            syncId,
            publishedAt,
            sha256,
            at,
            origin,
          });
          await supersedeNetworkSyncs(tx, { sourceId, keepSyncId: syncId, at });
          return { syncId, overrides };
        },
      );
      return {
        ...base,
        outcome: 'applied',
        syncId: applied.syncId,
        entryCount: publication.entryCount,
        snapshotBytes: publication.bytes.byteLength,
        overrides: applied.overrides,
        errorCode: null,
      };
    } catch (error) {
      if (error instanceof UnchangedUnderLock) {
        return unchanged();
      }
      if (error instanceof NetworkRefusal) {
        return refused(error, { sha256 });
      }
      throw error;
    }
  }
}

/**
 * C92.3 (P27): deletes the snapshot objects superseded more than {@link SNAPSHOT_PURGE_AFTER_MS}
 * ago, keeping each source's current and previous one, and records the deletions. Returns how
 * many it deleted. Run after every applied or unchanged sync, so old exit lists never pile up.
 */
export async function purgeNetworkSnapshots(
  deps: Pick<NetworkSyncDeps, 'db' | 'clock'> & { storage?: FileStorage | undefined },
): Promise<number> {
  const storage = deps.storage;
  if (storage === undefined) {
    return 0;
  }
  const now = deps.clock.now();
  const purgeable = await listPurgeableNetworkSnapshots(deps.db, {
    supersededBefore: new Date(now.getTime() - SNAPSHOT_PURGE_AFTER_MS),
    limit: PURGE_BATCH,
  });
  for (const snapshot of purgeable) {
    await storage.delete(snapshotKey(snapshot.sourceId, snapshot.sha256));
  }
  await markNetworkSnapshotsDeleted(deps.db, {
    syncIds: purgeable.map(({ syncId }) => syncId),
    at: now,
  });
  return purgeable.length;
}
