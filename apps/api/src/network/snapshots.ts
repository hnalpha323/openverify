/**
 * C92.3 (Workflow 7A, F41): the in-memory network snapshots of one process. The API and the worker
 * each build one at startup (`container.ts`, `worker.ts`), start it, and close it on shutdown.
 *
 * Owner: `api-network` (Stage 3). The loader reads each enabled source's applied snapshot from
 * `network/<source>/<sha256>` in object storage, re-checks its SHA-256 against
 * `network_sources.last_sha256`, re-reads the rows every {@link NETWORK_SNAPSHOT_RECHECK_MS},
 * swaps a changed source atomically (one at a time, releasing the old snapshot after the swap),
 * and never hands a production environment a `sandbox_only` source (H26).
 *
 * Each snapshot object is read into one buffer (`network-data`'s measurement: joining streamed
 * chunks costs about 70 MiB more at rest with City Lite) and loaded by `loadSnapshot` of
 * `@openverify/signals/network`. A source that cannot be loaded (a missing object, another
 * SHA-256, a corrupt file) keeps the snapshot it had, which then turns stale by its check time:
 * its facts read `list_stale`, and a source never loaded reads `list_unavailable`, whether or not
 * another source of its role answers (R002). A source the rows disable is dropped at the next
 * re-check. Logs carry source ids and error names only.
 */
import { createHash } from 'node:crypto';
import { listNetworkSourceStates, type Db, type NetworkSourceState } from '@openverify/db';
import { loadSnapshot, type NetworkSnapshotKind, type MmdbRole } from '@openverify/signals/network';
import type { WorkerLogger } from '../jobs/logger.js';
import { metrics } from '../metrics-registry.js';
import type { NetworkSourceSnapshot } from '@openverify/signals/network';
import type {
  Clock,
  EnvironmentKind,
  FileStorage,
  ManagedNetworkSnapshots,
  NetworkSnapshot,
} from '../ports.js';
import {
  networkManifest,
  networkManifestSource,
  type NetworkManifest,
  type NetworkManifestSource,
} from './manifest.js';
import { snapshotKey } from './sync.js';

/** C92.3: how often the loader re-reads the source rows for a new applied SHA-256. */
export const NETWORK_SNAPSHOT_RECHECK_MS = 60_000;

/** What the loader reads. */
export interface NetworkSnapshotsDeps {
  db: Db;
  storage: FileStorage;
  clock: Clock;
  logger: WorkerLogger;
  /** The re-check period; {@link NETWORK_SNAPSHOT_RECHECK_MS} by default (tests shorten it). */
  recheckMs?: number | undefined;
  /** The committed `network/sources.json` by default. */
  manifest?: NetworkManifest | undefined;
}

/** The loader, with the re-check a test drives itself. */
export interface NetworkSnapshotLoader extends ManagedNetworkSnapshots {
  /** Re-reads the source rows once and swaps what changed, one source at a time. */
  recheck(): Promise<void>;
  /** R002: the sources an environment of `kind` should read that hold no snapshot. */
  unloaded(kind: EnvironmentKind): readonly string[];
}

const NO_SNAPSHOTS: readonly NetworkSnapshot[] = Object.freeze([]);
const NO_SOURCES: readonly string[] = Object.freeze([]);
const HOUR_MS = 3_600_000;

const MMDB_ROLES: Readonly<Partial<Record<string, MmdbRole>>> = {
  'mmdb-country': 'country',
  'mmdb-city': 'city',
  'mmdb-asn': 'asn',
};

/** The stored snapshot's kind (C92.3), from the source's parser. */
function kindOf(source: NetworkManifestSource): {
  kind: NetworkSnapshotKind;
  role: MmdbRole | null;
} {
  const role = MMDB_ROLES[source.parser] ?? null;
  if (role !== null) {
    return { kind: 'mmdb', role };
  }
  if (source.parser === 'tordnsel-exit-addresses') {
    return { kind: 'tor-exits', role: null };
  }
  return source.parser === 'openverify-sandbox-network'
    ? { kind: 'sandbox', role: null }
    : { kind: 'ranges', role: null };
}

/**
 * C92.4: a source's freshness at `now`, counted from its last successful check. An exit list also
 * counts from its own publication time, because it alone answers `false`: a publisher that keeps
 * serving a frozen file passes every check, and the list then says nothing about the exits since
 * (R006). A sandbox-only source is never stale.
 */
function freshnessOf(
  snapshot: NetworkSnapshot,
  source: NetworkManifestSource,
  now: Date,
): NetworkSourceSnapshot['freshness'] {
  if (snapshot.sandboxOnly) {
    return 'fresh';
  }
  if (snapshot.checkedAt === null) {
    return 'unavailable';
  }
  const staleAfter = source.stale_after_hours;
  if (staleAfter === null) {
    return 'fresh';
  }
  const age = (from: Date) => now.getTime() - from.getTime();
  const frozen =
    source.role === 'tor' &&
    snapshot.publishedAt !== null &&
    age(snapshot.publishedAt) > staleAfter * HOUR_MS;
  return frozen || age(snapshot.checkedAt) > staleAfter * HOUR_MS ? 'stale' : 'fresh';
}

/**
 * The provenance a source's reads cite. A publication without a time (Cloudflare's API, Azure, a
 * geofeed with no stamp) is dated by when it was applied, so it is read at all (R004). An exit list
 * is the exception: only an empty one has no time, and it must not answer `false`.
 */
function provenanceOf(
  snapshot: NetworkSnapshot,
  source: NetworkManifestSource,
): NetworkSourceSnapshot['provenance'] {
  const undated = source.role === 'tor' ? null : (snapshot.appliedAt ?? null);
  const publishedAt = snapshot.publishedAt ?? undated;
  return publishedAt === null
    ? null
    : { syncId: String(snapshot.syncId), publishedAt, sha256: snapshot.sha256 };
}

/**
 * C92.4: the snapshots an evaluation of an environment of `kind` reads, as
 * `@openverify/signals/network` takes them: each with its manifest role and its freshness at
 * `now`; a sandbox-only source never reaches production (H26); a source the manifest no longer
 * names is left out. `unloaded` names the sources that hold no snapshot, which join as
 * `unavailable`, so the facts they feed read that gap beside a loaded sibling (R002).
 */
export function networkSourceSnapshots(
  snapshots: readonly NetworkSnapshot[],
  kind: EnvironmentKind,
  now: Date,
  manifest: NetworkManifest = networkManifest(),
  unloaded: readonly string[] = [],
): NetworkSourceSnapshot[] {
  const view: NetworkSourceSnapshot[] = [];
  for (const snapshot of snapshots) {
    const source = networkManifestSource(snapshot.sourceId, manifest);
    if (source === undefined || (kind === 'production' && snapshot.sandboxOnly)) {
      continue;
    }
    view.push({
      sourceId: snapshot.sourceId,
      role: source.role,
      sandboxOnly: snapshot.sandboxOnly,
      freshness: freshnessOf(snapshot, source, now),
      provenance: provenanceOf(snapshot, source),
      snapshot: snapshot.data as NetworkSourceSnapshot['snapshot'],
    });
  }
  for (const sourceId of unloaded) {
    const source = networkManifestSource(sourceId, manifest);
    if (source !== undefined) {
      view.push({
        sourceId,
        role: source.role,
        sandboxOnly: false,
        freshness: 'unavailable',
        provenance: null,
        snapshot: null,
      });
    }
  }
  return view;
}

/** C92.3: the process's network snapshots; see the file header. */
export function createNetworkSnapshots(deps: NetworkSnapshotsDeps): NetworkSnapshotLoader {
  const manifest = () => deps.manifest ?? networkManifest();
  let held: readonly NetworkSnapshot[] = NO_SNAPSHOTS;
  /** R002: the public sources the rows enable that hold no snapshot, read at each re-check. */
  let missing: readonly string[] = NO_SOURCES;
  let timer: ReturnType<typeof setInterval> | null = null;
  const life = { closed: false };
  /** Read through a call, so a close during an await is seen. */
  const isClosed = () => life.closed;
  let running: Promise<void> | null = null;

  const publish = (next: readonly NetworkSnapshot[]) => {
    held = Object.freeze([...next].sort((a, b) => a.sourceId.localeCompare(b.sourceId)));
  };

  /** Loads one source's applied snapshot, or `null` when it cannot be loaded. */
  async function load(
    source: NetworkManifestSource,
    state: NetworkSourceState & { lastSha256: string; lastSyncId: number },
  ): Promise<NetworkSnapshot | null> {
    try {
      const stored = await deps.storage.get(snapshotKey(source.id, state.lastSha256));
      if (stored === null) {
        throw new Error('the snapshot object is missing');
      }
      const bytes = Buffer.isBuffer(stored)
        ? stored
        : Buffer.from(stored.buffer, stored.byteOffset, stored.byteLength);
      if (createHash('sha256').update(bytes).digest('hex') !== state.lastSha256) {
        throw new Error('the snapshot object is not the applied one');
      }
      const { kind, role } = kindOf(source);
      return {
        sourceId: source.id,
        sandboxOnly: state.sandboxOnly,
        syncId: state.lastSyncId,
        publishedAt: state.lastPublishedAt,
        appliedAt: state.lastAppliedAt,
        sha256: state.lastSha256,
        checkedAt: state.lastCheckedAt,
        bytes: bytes.byteLength,
        data: loadSnapshot(kind, bytes, role),
      };
    } catch (error) {
      deps.logger.warn(
        { sourceId: source.id, error: (error as Error).name },
        'network snapshot not loaded',
      );
      return null;
    }
  }

  async function recheckOnce(): Promise<void> {
    const states = await listNetworkSourceStates(deps.db);
    let next = [...held];
    const wanted = new Set<string>();
    for (const state of states) {
      const source = networkManifestSource(state.id, manifest());
      if (
        isClosed() ||
        source === undefined ||
        !state.enabled ||
        state.lastSha256 === null ||
        state.lastSyncId === null
      ) {
        continue;
      }
      wanted.add(state.id);
      const current = next.find((snapshot) => snapshot.sourceId === state.id);
      if (current?.sha256 === state.lastSha256) {
        if (current.checkedAt?.getTime() !== state.lastCheckedAt?.getTime()) {
          next = next.map((snapshot) =>
            snapshot === current ? { ...current, checkedAt: state.lastCheckedAt } : snapshot,
          );
          publish(next);
        }
        continue;
      }
      // One source at a time: the old snapshot is released once the new one is published.
      const loaded = await load(source, {
        ...state,
        lastSha256: state.lastSha256,
        lastSyncId: state.lastSyncId,
      });
      if (loaded !== null && !isClosed()) {
        next = [...next.filter((snapshot) => snapshot.sourceId !== state.id), loaded];
        publish(next);
      }
    }
    if (!isClosed() && next.some((snapshot) => !wanted.has(snapshot.sourceId))) {
      next = next.filter((snapshot) => wanted.has(snapshot.sourceId));
      publish(next);
    }
    missing = Object.freeze(
      states
        .filter(
          (state) =>
            state.enabled &&
            !state.sandboxOnly &&
            networkManifestSource(state.id, manifest()) !== undefined &&
            !next.some((snapshot) => snapshot.sourceId === state.id),
        )
        .map((state) => state.id),
    );
    // C250.7: the public sources whose facts read list_stale or list_unavailable right now.
    const now = deps.clock.now();
    const unfresh = next.filter((snapshot) => {
      const source = networkManifestSource(snapshot.sourceId, manifest());
      return (
        !snapshot.sandboxOnly &&
        source !== undefined &&
        freshnessOf(snapshot, source, now) !== 'fresh'
      );
    }).length;
    metrics.emit(deps.logger, 'network_sources_stale', unfresh + missing.length);
  }

  /** Re-checks are serialised: a slow load never overlaps the next tick. */
  function recheck(): Promise<void> {
    running ??= recheckOnce().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    current: (kind) =>
      kind === 'production'
        ? Object.freeze(held.filter((snapshot) => !snapshot.sandboxOnly))
        : held,
    unloaded: () => missing,
    async start() {
      if (life.closed) {
        return;
      }
      await recheck();
      if (timer === null && !isClosed()) {
        timer = setInterval(() => {
          recheck().catch((error: unknown) => {
            deps.logger.error({ error: (error as Error).name }, 'network snapshots not re-checked');
          });
        }, deps.recheckMs ?? NETWORK_SNAPSHOT_RECHECK_MS);
        timer.unref();
      }
    },
    recheck,
    async close() {
      life.closed = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      await running?.catch(() => undefined);
      held = NO_SNAPSHOTS;
      missing = NO_SOURCES;
    },
  };
}
