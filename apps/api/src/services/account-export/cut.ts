/**
 * C253.2, C253.4, C253.5 (Workflow 11B, `dsar-export`): the `account-export` job's work for one
 * export, once admitted under C251's cap:
 *
 * 1. claim the `pending` row (`FOR UPDATE SKIP LOCKED`, in its own transaction; one already claimed,
 *    finished or deleted is skipped);
 * 2. read everything the account links to now (`collect.ts`) and assemble the manifest
 *    (`openverify.account-export.v1`); past `ACCOUNT_EXPORT_LIMITS.items` the export fails with
 *    `account_export_too_large` and nothing is stored (never truncated);
 * 3. seal the manifest under a new data key, its context the export's id, and store it at the
 *    export's own key (`<environment>/account-exports/<id>`); only the manifest is stored, no file is
 *    copied (C253.2);
 * 4. mark the row `ready` with its time, its life (`account-export-ttl-days`, 1-30, default 7), its
 *    item count, its size (the manifest's bytes and the listed files' sizes) and every id it lists,
 *    which a redaction or retention deletion of one of them matches to delete the export first
 *    (C253.4). If the row is gone meanwhile (such a deletion won the race), the stored manifest is
 *    deleted again.
 *
 * A read that fails ends `account_export_unavailable`. The log names the export and the error's
 * class, never a value (rule 11).
 */
import { resolveHardeningSettings } from '@openverify/contracts';
import { encryptBytes, getEnvironment, type Db, type Keyring } from '@openverify/db';
import type { WorkerLogger } from '../../jobs/logger.js';
import type { Clock, FileStorage } from '../../ports.js';
import { collectAccountExport } from './collect.js';
import {
  AccountExportTooLargeError,
  buildAccountExportManifest,
  manifestItemIds,
  type CollectedAccountExport,
} from './manifest.js';
import { countAccountExportRefusal } from './refusals.js';
import { manifestStorageKey, type AccountExportRow } from './service.js';

const DAY_MS = 86_400_000;

/** What finishing an export writes on its row. */
export interface AccountExportCompletion {
  readyAt: Date;
  expiresAt: Date;
  itemCount: number;
  byteCount: number;
  storageKey: string;
  wrappedDek: string;
  /** C253.4: every id the manifest lists, so a redaction or deletion of one finds the export. */
  itemIds: readonly string[];
}

/** The job's side of the store (the repository implements it). */
export interface AccountExportJobStore {
  /** The `pending` export, locked `FOR UPDATE SKIP LOCKED`; `null` when it is not pending. */
  claimExport(tx: Db, environmentId: string, id: string): Promise<AccountExportRow | null>;
  /** Marks the pending export `ready`; `null` when it is gone or no longer pending. */
  completeExport(
    tx: Db,
    environmentId: string,
    id: string,
    completion: AccountExportCompletion,
  ): Promise<AccountExportRow | null>;
  /** Marks the pending export `failed` with its code. */
  failExport(
    tx: Db,
    environmentId: string,
    id: string,
    code: 'account_export_too_large' | 'account_export_unavailable',
    at: Date,
  ): Promise<void>;
}

/** What the job needs. */
export interface CutAccountExportDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  storage: FileStorage;
  keyring: Keyring;
  store: AccountExportJobStore;
  /** The collector (`collect.ts`); replaced only by tests. */
  collect?:
    ((environmentId: string, accountId: string) => Promise<CollectedAccountExport>) | undefined;
}

/** How a cut ended. */
export type CutOutcome =
  | { outcome: 'ready'; itemCount: number }
  | { outcome: 'failed'; code: 'account_export_too_large' | 'account_export_unavailable' }
  | { outcome: 'skipped' };

/** Cuts one export. */
export async function cutAccountExport(
  deps: CutAccountExportDeps,
  environmentId: string,
  exportId: string,
): Promise<CutOutcome> {
  const claimed = await deps.db.transaction((tx) =>
    deps.store.claimExport(tx, environmentId, exportId),
  );
  if (claimed === null) {
    return { outcome: 'skipped' };
  }
  const fail = async (
    code: 'account_export_too_large' | 'account_export_unavailable',
  ): Promise<CutOutcome> => {
    await deps.db.transaction((tx) =>
      deps.store.failExport(tx, environmentId, exportId, code, deps.clock.now()),
    );
    return { outcome: 'failed', code };
  };
  const collect =
    deps.collect ??
    ((environment: string, account: string) =>
      collectAccountExport({ db: deps.db, clock: deps.clock }, environment, account));
  let text: string;
  let itemIds: string[];
  let itemCount: number;
  let filesSize: number;
  try {
    const manifest = buildAccountExportManifest(await collect(environmentId, claimed.accountId), {
      exportId,
      environmentId,
      accountId: claimed.accountId,
      generatedAt: deps.clock.now(),
    });
    text = JSON.stringify(manifest);
    itemIds = manifestItemIds(manifest);
    itemCount = manifest['item-count'];
    filesSize = manifest.files.reduce((sum, file) => sum + file.size, 0);
  } catch (error) {
    deps.logger.warn(
      { exportId, error: error instanceof Error ? error.name : 'unknown' },
      'account export not cut',
    );
    if (error instanceof AccountExportTooLargeError) {
      countAccountExportRefusal(deps.logger, environmentId, 'too_large');
      return fail('account_export_too_large');
    }
    return fail('account_export_unavailable');
  }
  const bytes = Buffer.from(text, 'utf8');
  const sealed = encryptBytes(bytes, deps.keyring, { context: exportId });
  const storageKey = manifestStorageKey(environmentId, exportId);
  try {
    await deps.storage.put(storageKey, sealed.ciphertext);
  } catch (error) {
    deps.logger.warn(
      { exportId, error: error instanceof Error ? error.name : 'unknown' },
      'account export manifest not stored',
    );
    return fail('account_export_unavailable');
  }
  const environment = await getEnvironment(deps.db, environmentId);
  const ttlDays = resolveHardeningSettings(environment?.settings ?? {})['account-export-ttl-days'];
  const readyAt = deps.clock.now();
  let done: AccountExportRow | null;
  try {
    done = await deps.db.transaction((tx) =>
      deps.store.completeExport(tx, environmentId, exportId, {
        readyAt,
        expiresAt: new Date(readyAt.getTime() + ttlDays * DAY_MS),
        itemCount,
        byteCount: bytes.byteLength + filesSize,
        storageKey,
        wrappedDek: sealed.wrappedDek,
        itemIds,
      }),
    );
  } catch (error) {
    // KP10-54: the object is deleted rather than left for a sweep (its wrapped key was never
    // written, so it could not be read), and the export fails rather than stays pending.
    deps.logger.warn(
      { exportId, error: error instanceof Error ? error.name : 'unknown' },
      'account export not marked ready',
    );
    await deps.storage.delete(storageKey).catch(() => undefined);
    return await fail('account_export_unavailable');
  } finally {
    bytes.fill(0);
  }
  if (done === null) {
    // Deleted meanwhile (C253.4): its manifest must not outlive it.
    await deps.storage.delete(storageKey).catch(() => undefined);
    return { outcome: 'skipped' };
  }
  return { outcome: 'ready', itemCount };
}
