/**
 * C118.7 (Workflow 8A): `account_actions`. Owner: `api-triggers`. A prefill names a path, never a
 * value, so a row holds configuration only (Stage 1a amendment 40).
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import { accountActions, type AccountActionRow, type AccountActionRowStatus } from '../schema.js';
import { firstOrNull, inserted } from './rows.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';

export interface NewAccountAction {
  id: string;
  workflowId: string;
  accountTypeId: string;
  label: string;
  prefill: Readonly<Record<string, string>>;
}

export interface AccountActionChanges {
  label?: string | undefined;
  status?: AccountActionRowStatus | undefined;
  prefill?: Readonly<Record<string, string>> | undefined;
}

export interface AccountActionFilters {
  workflowIds?: readonly string[] | undefined;
  accountTypeIds?: readonly string[] | undefined;
  statuses?: readonly AccountActionRowStatus[] | undefined;
}

const scoped = (environmentId: string, id: string) =>
  and(eq(accountActions.environmentId, environmentId), eq(accountActions.id, id));

export async function createAccountAction(
  tx: Db,
  environmentId: string,
  input: NewAccountAction,
): Promise<AccountActionRow> {
  const rows = await tx
    .insert(accountActions)
    .values({
      id: input.id,
      environmentId,
      workflowId: input.workflowId,
      accountTypeId: input.accountTypeId,
      label: input.label,
      prefill: { ...input.prefill },
    })
    .returning();
  return inserted(rows, 'createAccountAction');
}

export async function getAccountAction(
  db: Db,
  environmentId: string,
  id: string,
): Promise<AccountActionRow | null> {
  return firstOrNull(
    await db.select().from(accountActions).where(scoped(environmentId, id)).limit(1),
  );
}

/** `created_at DESC, id DESC` (C1). */
export async function listAccountActions(
  db: Db,
  environmentId: string,
  filters: AccountActionFilters,
  page: PageRequest,
): Promise<Page<AccountActionRow>> {
  const { workflowIds, accountTypeIds, statuses } = filters;
  const where = and(
    eq(accountActions.environmentId, environmentId),
    workflowIds === undefined ? undefined : inArray(accountActions.workflowId, [...workflowIds]),
    accountTypeIds === undefined
      ? undefined
      : inArray(accountActions.accountTypeId, [...accountTypeIds]),
    statuses === undefined ? undefined : inArray(accountActions.status, [...statuses]),
  );
  const cursor = environmentCursor(accountActions);
  return paginate(db, cursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(accountActions)
      .where(and(where, after))
      .orderBy(...newestFirst(cursor))
      .limit(limit),
  );
}

/** C118.7: what `GET /accounts/:id/available-actions` starts from: the type's active actions. */
export async function listAccountActionsForType(
  db: Db,
  environmentId: string,
  accountTypeId: string,
): Promise<AccountActionRow[]> {
  return db
    .select()
    .from(accountActions)
    .where(
      and(
        eq(accountActions.environmentId, environmentId),
        eq(accountActions.accountTypeId, accountTypeId),
        eq(accountActions.status, 'active'),
      ),
    )
    .orderBy(asc(accountActions.createdAt), asc(accountActions.id));
}

export async function updateAccountAction(
  tx: Db,
  environmentId: string,
  id: string,
  changes: AccountActionChanges,
): Promise<AccountActionRow | null> {
  return firstOrNull(
    await tx
      .update(accountActions)
      .set({
        ...(changes.label === undefined ? {} : { label: changes.label }),
        ...(changes.status === undefined ? {} : { status: changes.status }),
        ...(changes.prefill === undefined ? {} : { prefill: { ...changes.prefill } }),
      })
      .where(scoped(environmentId, id))
      .returning(),
  );
}
