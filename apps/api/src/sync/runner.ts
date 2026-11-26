/**
 * C92.2 (F35, decision 48): the sync runner, one implementation of the security-relevant steps
 * that the watchlist sync (C76.2, `watchlists/sync.ts`) and the network sync (`network/sync.ts`)
 * both run. Extracted from the watchlist sync as Workflows 6A to 6D left it; each sync keeps its
 * own parse, diff and apply, and calls these:
 *
 * 1. the session advisory lock of the source, on the sync's dedicated connection, which every later
 *    transaction runs on (`busy` when another sync holds it); unlocked and released at the end,
 *    whatever happened ({@link withSourceSessionLock});
 * 2. (void: no change signal, owner decision 10 after Workflow 6B: every check downloads);
 * 3. the download into a new private directory (mode 0700, the file 0600; stale directories of
 *    crashed runs removed; the directory removed afterwards) through the C85.1 stream client, the
 *    body hashed as it arrives ({@link withPrivateFile}, {@link streamToFile});
 * 4. the SHA-256 of the same open file ({@link hashFile});
 * 5. (each sync's strict parse);
 * 6. the apply transaction under the per-source transaction lock and `FOR UPDATE` of the source
 *    row ({@link applyUnderSourceLocks}), the guards re-checked there against the locked row:
 *    a publication more than {@link FUTURE_PUBLICATION_MS} ahead (`refused_future`), older than the
 *    applied one (`refused_rollback`, unless `--accept-older-publication`), a mass removal
 *    (`refused_mass_removal`, unless `--allow-mass-removal`) and a mass addition
 *    (`refused_mass_addition`, unless `--allow-mass-addition`), each override recorded
 *    ({@link checkPublicationGuards}).
 *
 * Each sync decides what "mass" means for its data (the watchlists' 10% of entries; the network
 * sources' share of addresses or an MMDB's size) and passes the verdict in. Nothing here logs.
 * Owner: `api-network` (Workflow 7A Stage 3).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, open, readdir, rm, stat, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '@openverify/db';
import type { OutboundHttpRequest, OutboundStreamClient } from '../http/index.js';

/** C76.2 (P08), C92.2: a publication may be dated at most this far ahead. */
export const FUTURE_PUBLICATION_MS = 24 * 3_600_000;
/** A private directory older than this, left by a crashed run, is removed at start. */
export const STALE_DIRECTORY_MS = 3_600_000;

/** A dedicated database connection, held for the whole sync (the session-level lock's). */
export interface SyncSession {
  db: Db;
  release(): Promise<void>;
}

/** The three advisory locks of one kind of source, and its row under `FOR UPDATE`. */
export interface SourceLocks<Row> {
  trySession(db: Db, sourceId: string): Promise<boolean>;
  unlockSession(db: Db, sourceId: string): Promise<void>;
  transaction(db: Db, sourceId: string): Promise<void>;
  row(db: Db, sourceId: string): Promise<Row | null>;
}

/** The guards' override names, as both sync tables record them. */
export type GuardOverride =
  'accept-older-publication' | 'allow-mass-removal' | 'allow-mass-addition';
export type GuardRefusalOutcome =
  'refused_future' | 'refused_rollback' | 'refused_mass_removal' | 'refused_mass_addition';

/** What the guards compare, re-checked against the locked row. */
export interface PublicationGuardInput {
  /** The publication's own time, or `null` when it states none (the rollback guard then passes). */
  publishedAt: Date | null;
  lastPublishedAt: Date | null;
  now: Date;
  acceptOlderPublication: boolean;
  massRemoval?: { exceeded: boolean; allowed: boolean } | undefined;
  massAddition?: { exceeded: boolean; allowed: boolean } | undefined;
}

export interface PublicationGuardResult {
  /** The first guard refused, with its rule (never a value); `null` when every guard passed. */
  refusal: { outcome: GuardRefusalOutcome; rule: string } | null;
  /** The overrides that let a guard pass, in guard order. */
  overrides: GuardOverride[];
}

/** What a download into the private file answered. */
export interface StreamedFile {
  status: number;
  /** The SHA-256 of the bytes written (a 2xx body), hashed as they arrived. */
  sha256: string;
  bytes: number;
  headers: Record<string, string>;
}

/** C76.2 step 3: a new private directory, after removing stale ones of crashed runs. */
export async function privateDirectory(base: string, now: Date, prefix: string): Promise<string> {
  for (const name of await readdir(base).catch(() => [] as string[])) {
    if (!name.startsWith(prefix)) {
      continue;
    }
    const path = join(base, name);
    const info = await stat(path).catch(() => null);
    if (info?.isDirectory() === true && info.mtimeMs < now.getTime() - STALE_DIRECTORY_MS) {
      await rm(path, { recursive: true, force: true });
    }
  }
  return mkdtemp(join(base, prefix));
}

/**
 * C76.2 step 3: runs `run` with a new 0600 file (opened `w+`) in a new private directory, then
 * closes it and removes the directory, also when `run` fails.
 */
export async function withPrivateFile<T>(
  options: { base: string; now: Date; prefix: string; name: string },
  run: (handle: FileHandle) => Promise<T>,
): Promise<T> {
  const directory = await privateDirectory(options.base, options.now, options.prefix);
  let handle: FileHandle | null = null;
  try {
    handle = await open(join(directory, options.name), 'w+', 0o600);
    return await run(handle);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * C76.2 step 3, C85.1: one streamed request whose 2xx body goes to `handle`, each chunk awaited,
 * and is hashed as it arrives. A non-2xx answer writes nothing; the caller judges its status.
 * @throws {OutboundHttpError} as the stream client does.
 */
export async function streamToFile(
  client: OutboundStreamClient,
  request: OutboundHttpRequest,
  handle: FileHandle,
): Promise<StreamedFile> {
  const hash = createHash('sha256');
  const response = await client.stream(request, {
    async write(chunk) {
      hash.update(chunk);
      await handle.write(chunk);
    },
  });
  return {
    status: response.status,
    sha256: hash.digest('hex'),
    bytes: response.bytes,
    headers: { ...response.headers },
  };
}

/** C76.2 step 4: the SHA-256 of the whole file, read through `handle` from its start. */
export async function hashFile(handle: FileHandle): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/**
 * C76.2 step 1 (P07): opens the sync's connection and takes the source's session-level lock on it.
 * Without the lock, `busy` runs; with it, `locked`, then the lock is given back. The connection is
 * released either way, and a failed unlock never hides the sync's own error.
 */
export async function withSourceSessionLock<T>(
  connect: () => Promise<SyncSession>,
  locks: Pick<SourceLocks<unknown>, 'trySession' | 'unlockSession'>,
  sourceId: string,
  handlers: { busy(session: SyncSession): Promise<T>; locked(session: SyncSession): Promise<T> },
): Promise<T> {
  const session = await connect();
  let locked = false;
  try {
    locked = await locks.trySession(session.db, sourceId);
    return await (locked ? handlers.locked(session) : handlers.busy(session));
  } finally {
    if (locked) {
      await locks.unlockSession(session.db, sourceId).catch(() => undefined);
    }
    await session.release();
  }
}

/** C76.2: a transaction of the sync under the source's transaction-level lock. */
export function inSourceTransaction<T>(
  db: Db,
  locks: Pick<SourceLocks<unknown>, 'transaction'>,
  sourceId: string,
  run: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await locks.transaction(tx, sourceId);
    return run(tx);
  });
}

/**
 * C76.2 step 6: the apply transaction: the transaction-level lock, then the source row under
 * `FOR UPDATE`, which the guards are re-checked against, then `apply`. A throw rolls it all back.
 */
export function applyUnderSourceLocks<Row, T>(
  db: Db,
  locks: Pick<SourceLocks<Row>, 'transaction' | 'row'>,
  sourceId: string,
  apply: (tx: Db, row: Row | null) => Promise<T>,
): Promise<T> {
  return inSourceTransaction(db, locks, sourceId, async (tx) =>
    apply(tx, await locks.row(tx, sourceId)),
  );
}

/** C76.2, C92.2 step 6: the publication guards, in order; see the file header. */
export function checkPublicationGuards(input: PublicationGuardInput): PublicationGuardResult {
  const overrides: GuardOverride[] = [];
  const refuse = (outcome: GuardRefusalOutcome, rule: string): PublicationGuardResult => ({
    refusal: { outcome, rule },
    overrides,
  });
  const published = input.publishedAt?.getTime() ?? null;
  if (published !== null && published > input.now.getTime() + FUTURE_PUBLICATION_MS) {
    return refuse('refused_future', 'the publication is dated more than a day ahead');
  }
  if (
    published !== null &&
    input.lastPublishedAt !== null &&
    published < input.lastPublishedAt.getTime()
  ) {
    if (!input.acceptOlderPublication) {
      return refuse('refused_rollback', 'the publication is older than the last applied one');
    }
    overrides.push('accept-older-publication');
  }
  if (input.massRemoval?.exceeded === true) {
    if (!input.massRemoval.allowed) {
      return refuse('refused_mass_removal', 'the publication removes too many entries');
    }
    overrides.push('allow-mass-removal');
  }
  if (input.massAddition?.exceeded === true) {
    if (!input.massAddition.allowed) {
      return refuse('refused_mass_addition', 'the publication adds too much');
    }
    overrides.push('allow-mass-addition');
  }
  return { refusal: null, overrides };
}
