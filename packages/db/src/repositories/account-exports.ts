/**
 * C253 (Phase 11, Workflow 11B Stage 2, `dsar-export`): `account_exports`, the access exports of one
 * account. The rows hold ids, counts, times and the manifest's object key with its wrapped data key;
 * never the manifest itself (rule 11).
 *
 * - **Create** under the account's row lock: one `pending` export per account
 *   (`account_exports_one_pending_key` is the backstop), its creator a user or an API key.
 * - **The job** claims a `pending` export (`FOR UPDATE SKIP LOCKED`), then marks it `ready` (its
 *   counts, life, object and listed ids) or `failed` with its code; each write changes a `pending`
 *   row only, so an export deleted or finished meanwhile is left as it is.
 * - **C253.4:** a redaction or deletion of an item deletes every export of the environment that lists
 *   it (`item_ids && $ids`, the GIN index) or is of it (`account_id`, a pending export lists nothing
 *   yet), answering each deleted export's object key; the C16 pass marks `ready` exports past
 *   `expires_at` `expired` (the object key and its data key cleared, the counts and times kept),
 *   answering the keys it cleared.
 *
 * `admitted_at` is `quotas`' (`queue-slots.ts`), and no function here reads or writes it.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { accounts } from '../tables/accounts.js';
import { accountExports, type AccountExportRecord } from '../tables/account-exports.js';
import { firstOrNull, inserted } from './rows.js';

export type { AccountExportRecord } from '../tables/account-exports.js';

/** Who asked for an export (C253.1: a workflow run never exports). */
export interface AccountExportCreatorRef {
  type: 'user' | 'api-key';
  id: string;
}

/** What finishing an export writes. */
export interface AccountExportReady {
  readyAt: Date;
  expiresAt: Date;
  itemCount: number;
  byteCount: number;
  storageKey: string;
  wrappedDek: string;
  itemIds: readonly string[];
}

/** An export a deletion or the expiry removed the object of. */
export interface AccountExportObjectRef {
  id: string;
  environmentId: string;
  storageKey: string | null;
}

const exportIn = (environmentId: string, id: string) =>
  and(eq(accountExports.environmentId, environmentId), eq(accountExports.id, id));

/** Locks the account's row for the transaction; `false` when it is not in the environment. */
export async function lockAccountForExport(
  tx: Db,
  environmentId: string,
  accountId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.environmentId, environmentId), eq(accounts.id, accountId)))
    .for('update');
  return rows.length > 0;
}

/** Whether the account has a `pending` export. */
export async function hasPendingAccountExport(
  db: Db,
  environmentId: string,
  accountId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: accountExports.id })
    .from(accountExports)
    .where(
      and(
        eq(accountExports.environmentId, environmentId),
        eq(accountExports.accountId, accountId),
        eq(accountExports.status, 'pending'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** C253.1: writes a `pending`, unadmitted export. */
export async function insertPendingAccountExport(
  tx: Db,
  environmentId: string,
  input: { id: string; accountId: string; creator: AccountExportCreatorRef; at: Date },
): Promise<AccountExportRecord> {
  return inserted(
    await tx
      .insert(accountExports)
      .values({
        id: input.id,
        environmentId,
        accountId: input.accountId,
        creatorType: input.creator.type,
        creatorId: input.creator.id,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .returning(),
    'insertPendingAccountExport',
  );
}

/** One export of the environment, or `null`. */
export async function getAccountExportRecord(
  db: Db,
  environmentId: string,
  id: string,
): Promise<AccountExportRecord | null> {
  return firstOrNull(await db.select().from(accountExports).where(exportIn(environmentId, id)));
}

/** The job's claim: the `pending` export, locked `FOR UPDATE SKIP LOCKED`, or `null`. */
export async function claimPendingAccountExport(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<AccountExportRecord | null> {
  return firstOrNull(
    await tx
      .select()
      .from(accountExports)
      .where(and(exportIn(environmentId, id), eq(accountExports.status, 'pending')))
      .for('update', { skipLocked: true }),
  );
}

/** Marks a `pending` export `ready`; `null` when it is gone or no longer pending. */
export async function markAccountExportReady(
  tx: Db,
  environmentId: string,
  id: string,
  ready: AccountExportReady,
): Promise<AccountExportRecord | null> {
  return firstOrNull(
    await tx
      .update(accountExports)
      .set({
        status: 'ready',
        readyAt: ready.readyAt,
        expiresAt: ready.expiresAt,
        itemCount: ready.itemCount,
        byteCount: ready.byteCount,
        storageKey: ready.storageKey,
        wrappedDek: ready.wrappedDek,
        itemIds: [...new Set(ready.itemIds)],
        updatedAt: ready.readyAt,
      })
      .where(and(exportIn(environmentId, id), eq(accountExports.status, 'pending')))
      .returning(),
  );
}

/** Marks a `pending` export `failed` with its code. */
export async function markAccountExportFailed(
  tx: Db,
  environmentId: string,
  id: string,
  code: 'account_export_too_large' | 'account_export_unavailable',
  at: Date,
): Promise<void> {
  await tx
    .update(accountExports)
    .set({ status: 'failed', errorCode: code, updatedAt: at })
    .where(and(exportIn(environmentId, id), eq(accountExports.status, 'pending')));
}

/**
 * C253.4: deletes every export of the environment that lists one of `itemIds` or is of one of them
 * (a pending export lists nothing yet); answers each one with its object key.
 */
export async function deleteAccountExportsListing(
  tx: Db,
  environmentId: string,
  itemIds: readonly string[],
): Promise<AccountExportObjectRef[]> {
  if (itemIds.length === 0) {
    return [];
  }
  const ids = [...new Set(itemIds)];
  const listed = sql`${accountExports.itemIds} && ${sql.param(ids)}::text[]`;
  const ofItem = sql`${accountExports.accountId} = any(${sql.param(ids)}::text[])`;
  return tx
    .delete(accountExports)
    .where(and(eq(accountExports.environmentId, environmentId), sql`(${listed} or ${ofItem})`))
    .returning({
      id: accountExports.id,
      environmentId: accountExports.environmentId,
      storageKey: accountExports.storageKey,
    });
}

/**
 * C253.4: marks at most `limit` `ready` exports past `expires_at` `expired`, oldest expiry first,
 * clearing their object and data keys; answers the keys it cleared.
 */
export async function expireAccountExports(
  db: Db,
  now: Date,
  limit: number,
): Promise<AccountExportObjectRef[]> {
  const result = await db.execute(sql`
    with due as (
      select id, storage_key from account_exports
      where status = 'ready' and expires_at <= ${now}
      order by expires_at, id
      limit ${limit}
      for update skip locked
    )
    update account_exports as e
    set status = 'expired', storage_key = null, wrapped_dek = null, byte_count = null,
      updated_at = ${now}
    from due
    where e.id = due.id
    returning e.id, e.environment_id, due.storage_key
  `);
  const { rows } = result as {
    rows: { id: string; environment_id: string; storage_key: string | null }[];
  };
  return rows.map((row) => ({
    id: row.id,
    environmentId: row.environment_id,
    storageKey: row.storage_key,
  }));
}

/**
 * C251.1: stamps `admitted_at` on a pending, unadmitted export (its job is then enqueued under its
 * own id); `false` when it is not pending or was admitted already.
 */
export async function markAccountExportAdmitted(
  db: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<boolean> {
  const rows = await db
    .update(accountExports)
    .set({ admittedAt: at, updatedAt: at })
    .where(
      and(
        exportIn(environmentId, id),
        eq(accountExports.status, 'pending'),
        isNull(accountExports.admittedAt),
      ),
    )
    .returning({ id: accountExports.id });
  return rows.length > 0;
}

/** C251.1: clears the stamp of a pending export whose enqueue failed, so it is held again. */
export async function releaseAccountExportAdmission(
  db: Db,
  environmentId: string,
  id: string,
): Promise<void> {
  await db
    .update(accountExports)
    .set({ admittedAt: null })
    .where(and(exportIn(environmentId, id), eq(accountExports.status, 'pending')));
}
