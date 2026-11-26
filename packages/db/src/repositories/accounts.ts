import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { generateId } from '../ids.js';
import {
  accountRelations,
  accountTypes,
  accounts,
  inquiries,
  type Account,
  type AccountFields,
  type AccountFieldsSchema,
  type AccountRow,
  type AccountStatus,
  type AccountType,
} from '../schema.js';
import { openOptionalJson, sealJson } from '../sealed.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import {
  allFilters,
  createdAtRange,
  equalsAny,
  firstOrNull,
  hasAnyTag,
  inserted,
  type CreatedAtRange,
  type OneOrMany,
} from './rows.js';
import { applyTagOperation, TagLimitError, type TagOperation, type TagUpdate } from './tags.js';

/** The name of the account type every environment has (C13). */
export const DEFAULT_ACCOUNT_TYPE_NAME = 'user';

/** C13: one consolidation takes 1-10 source accounts. */
export const MAX_CONSOLIDATION_SOURCES = 10;

/** `(select id from account_types where environment = ? and name = 'user')`. */
const defaultAccountTypeId = (environmentId: string) =>
  sql<string>`(select ${accountTypes.id} from ${accountTypes}
    where ${accountTypes.environmentId} = ${environmentId}
      and ${accountTypes.name} = ${DEFAULT_ACCOUNT_TYPE_NAME})`;

const accountCursor = environmentCursor(accounts);
const accountTypeCursor = environmentCursor(accountTypes);
const inEnvironment = (environmentId: string, id: string) =>
  and(eq(accounts.id, id), eq(accounts.environmentId, environmentId));

/** Opens the row's sealed fields (`{}` when there are none) and drops the ciphertext. */
export function toAccount(row: AccountRow): Account {
  const { fieldsSealed, ...account } = row;
  const fields = openOptionalJson(
    SEALED.accountFields,
    row.id,
    fieldsSealed,
  ) as AccountFields | null;
  return { ...account, fields: fields ?? {} };
}

const accountOrNull = (rows: AccountRow[]): Account | null => {
  const row = firstOrNull(rows);
  return row === null ? null : toAccount(row);
};

// ---------------------------------------------------------------------------------------
// Account types

export interface NewAccountTypeInput {
  id: string;
  name: string;
  fieldsSchema?: AccountFieldsSchema;
  /** C128.3: `null` when left out. */
  contestRoute?: Record<string, unknown> | null;
}

export async function createAccountType(
  db: Db,
  environmentId: string,
  input: NewAccountTypeInput,
): Promise<AccountType> {
  const rows = await db
    .insert(accountTypes)
    .values({
      id: input.id,
      environmentId,
      name: input.name,
      fieldsSchema: input.fieldsSchema ?? {},
      contestRoute: input.contestRoute ?? null,
    })
    .returning();
  return inserted(rows, 'createAccountType');
}

export async function getAccountType(
  db: Db,
  environmentId: string,
  id: string,
): Promise<AccountType | null> {
  return firstOrNull(
    await db
      .select()
      .from(accountTypes)
      .where(and(eq(accountTypes.id, id), eq(accountTypes.environmentId, environmentId)))
      .limit(1),
  );
}

export async function findAccountTypeByName(
  db: Db,
  environmentId: string,
  name: string,
): Promise<AccountType | null> {
  return firstOrNull(
    await db
      .select()
      .from(accountTypes)
      .where(and(eq(accountTypes.environmentId, environmentId), eq(accountTypes.name, name)))
      .limit(1),
  );
}

/** The environment's type `user`, which the database seeds in every environment. */
export async function getDefaultAccountType(
  db: Db,
  environmentId: string,
): Promise<AccountType | null> {
  return findAccountTypeByName(db, environmentId, DEFAULT_ACCOUNT_TYPE_NAME);
}

/** C25.3 `PATCH /account-types/:id`: what changes. The caller checks the additive rule. */
export interface AccountTypeChanges {
  name?: string;
  fieldsSchema?: AccountFieldsSchema;
  contestRoute?: Record<string, unknown> | null;
}

const typeInEnvironment = (environmentId: string, id: string) =>
  and(eq(accountTypes.id, id), eq(accountTypes.environmentId, environmentId));

/**
 * The type, locked `FOR UPDATE` for the caller's transaction, so a change is checked against
 * the schema it replaces (C25.3); `null` when it is not in this environment.
 */
export async function lockAccountType(
  db: Db,
  environmentId: string,
  id: string,
): Promise<AccountType | null> {
  return firstOrNull(
    await db.select().from(accountTypes).where(typeInEnvironment(environmentId, id)).for('update'),
  );
}

/**
 * Writes a type's name or fields schema (C25.3); `null` when it is not in this environment. A
 * name the environment already has fails with the unique violation (23505).
 */
export async function updateAccountType(
  db: Db,
  environmentId: string,
  id: string,
  changes: AccountTypeChanges,
): Promise<AccountType | null> {
  const values = {
    ...(changes.name === undefined ? {} : { name: changes.name }),
    ...(changes.fieldsSchema === undefined ? {} : { fieldsSchema: changes.fieldsSchema }),
    ...(changes.contestRoute === undefined ? {} : { contestRoute: changes.contestRoute }),
  };
  if (Object.keys(values).length === 0) {
    return getAccountType(db, environmentId, id);
  }
  return firstOrNull(
    await db
      .update(accountTypes)
      .set(values)
      .where(typeInEnvironment(environmentId, id))
      .returning(),
  );
}

/** C13 `GET /account-types`: newest first. */
export async function listAccountTypes(
  db: Db,
  environmentId: string,
  page: PageRequest = {},
): Promise<Page<AccountType>> {
  return paginate(db, accountTypeCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(accountTypes)
      .where(and(eq(accountTypes.environmentId, environmentId), after))
      .orderBy(...newestFirst(accountTypeCursor))
      .limit(limit),
  );
}

// ---------------------------------------------------------------------------------------
// Accounts

export interface NewAccountInput {
  id: string;
  /** Defaults to the environment's type `user`. */
  accountTypeId?: string;
  referenceId?: string | null;
  fields?: AccountFields;
  tags?: readonly string[];
}

export interface ListAccountsOptions extends PageRequest, CreatedAtRange {
  referenceId?: OneOrMany<string> | undefined;
  accountTypeId?: OneOrMany<string> | undefined;
  status?: OneOrMany<AccountStatus> | undefined;
  /** Any of these tags, ignoring case. */
  tag?: OneOrMany<string> | undefined;
}

export interface AccountChanges {
  /** Merged into the current fields (C13 PATCH). */
  fields?: AccountFields;
  referenceId?: string | null;
  status?: AccountStatus;
}

export interface UpdatedAccount {
  account: Account;
  /** The account before the change, so callers can tell which events to emit. */
  previous: Account;
}

/**
 * C13 `POST /accounts`. Tags are deduplicated ignoring case.
 * @throws {TagLimitError} with more than 50 tags.
 */
export async function createAccount(
  db: Db,
  environmentId: string,
  input: NewAccountInput,
): Promise<Account> {
  const { tags } = applyTagOperation([], { kind: 'set', tags: input.tags ?? [] });
  const rows = await db
    .insert(accounts)
    .values({
      id: input.id,
      environmentId,
      accountTypeId: input.accountTypeId ?? defaultAccountTypeId(environmentId),
      referenceId: input.referenceId ?? null,
      fieldsSealed:
        input.fields === undefined ? null : sealJson(SEALED.accountFields, input.id, input.fields),
      tags,
    })
    .returning();
  return toAccount(inserted(rows, 'createAccount'));
}

export async function getAccount(
  db: Db,
  environmentId: string,
  id: string,
): Promise<Account | null> {
  return accountOrNull(
    await db.select().from(accounts).where(inEnvironment(environmentId, id)).limit(1),
  );
}

/**
 * Locks the account's row (`SELECT ... FOR UPDATE`) until the caller's transaction ends and
 * returns it, or `null` when it is not in this environment.
 */
export async function lockAccount(
  db: Db,
  environmentId: string,
  id: string,
): Promise<Account | null> {
  return accountOrNull(
    await db.select().from(accounts).where(inEnvironment(environmentId, id)).for('update'),
  );
}

/** Hops followed from a consolidated account to the account that absorbed it. */
const MAX_CONSOLIDATION_HOPS = 10;

/**
 * The account an inquiry of this account belongs to, read under `FOR SHARE` in the caller's
 * transaction: the account itself, or the account that absorbed it (C13). The share lock waits
 * for a consolidation in flight (it holds `FOR UPDATE`) and keeps a later one waiting until the
 * caller commits, so an inquiry is never left on an account consolidated meanwhile (Workflow
 * 2B F012, F020). `null` when no account matches in this environment.
 */
export async function lockAbsorbingAccount(
  db: Db,
  environmentId: string,
  match: { id: string } | { referenceId: string },
): Promise<Account | null> {
  let account = accountOrNull(
    await db
      .select()
      .from(accounts)
      .where(
        'id' in match
          ? inEnvironment(environmentId, match.id)
          : and(
              eq(accounts.environmentId, environmentId),
              eq(accounts.referenceId, match.referenceId),
            ),
      )
      .for('share'),
  );
  for (let hop = 0; account?.consolidatedInto != null && hop < MAX_CONSOLIDATION_HOPS; hop += 1) {
    account = accountOrNull(
      await db
        .select()
        .from(accounts)
        .where(inEnvironment(environmentId, account.consolidatedInto))
        .for('share'),
    );
  }
  return account;
}

export async function findAccountByReferenceId(
  db: Db,
  environmentId: string,
  referenceId: string,
): Promise<Account | null> {
  return accountOrNull(
    await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.environmentId, environmentId), eq(accounts.referenceId, referenceId)))
      .limit(1),
  );
}

/** C13 `GET /accounts`: newest first, with the reference, type, status, tag and date filters. */
export async function listAccounts(
  db: Db,
  environmentId: string,
  options: ListAccountsOptions = {},
): Promise<Page<Account>> {
  const filters = allFilters([
    eq(accounts.environmentId, environmentId),
    equalsAny(accounts.referenceId, options.referenceId),
    equalsAny(accounts.accountTypeId, options.accountTypeId),
    equalsAny(accounts.status, options.status),
    hasAnyTag(accounts.tags, options.tag),
    ...createdAtRange(accounts.createdAt, options),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  return paginate(db, accountCursor, environmentId, options, async (after, limit) =>
    (
      await db
        .select()
        .from(accounts)
        .where(and(...filters, after))
        .orderBy(...newestFirst(accountCursor))
        .limit(limit)
    ).map(toAccount),
  );
}

/**
 * C13 `PATCH /accounts/:id`: merges `fields`, sets the reference id and status, under a
 * row lock. Returns the account before and after, or `null` when it is not here.
 */
export async function updateAccount(
  db: Db,
  environmentId: string,
  id: string,
  changes: AccountChanges,
): Promise<UpdatedAccount | null> {
  return db.transaction(async (tx) => {
    const previous = await lockAccount(tx, environmentId, id);
    if (previous === null) {
      return null;
    }
    const set: Partial<typeof accounts.$inferInsert> = {};
    if (changes.fields !== undefined) {
      set.fieldsSealed = sealJson(SEALED.accountFields, id, {
        ...previous.fields,
        ...changes.fields,
      });
    }
    if (changes.referenceId !== undefined) set.referenceId = changes.referenceId;
    if (changes.status !== undefined) set.status = changes.status;
    if (Object.keys(set).length === 0) {
      return { account: previous, previous };
    }
    const account = accountOrNull(
      await tx.update(accounts).set(set).where(inEnvironment(environmentId, id)).returning(),
    );
    return account === null ? null : { account, previous };
  });
}

async function changeAccountTags(
  db: Db,
  environmentId: string,
  id: string,
  operation: TagOperation,
): Promise<TagUpdate<Account> | null> {
  return db.transaction(async (tx) => {
    const current = await lockAccount(tx, environmentId, id);
    if (current === null) {
      return null;
    }
    const { tags, changed } = applyTagOperation(current.tags, operation);
    if (!changed) {
      return { record: current, changed };
    }
    const record = accountOrNull(
      await tx.update(accounts).set({ tags }).where(inEnvironment(environmentId, id)).returning(),
    );
    return record === null ? null : { record, changed };
  });
}

/**
 * C13 `add-tag`; a tag already present (ignoring case) changes nothing.
 * @throws {TagLimitError} when the account already has 50 tags.
 */
export const addAccountTag = (db: Db, environmentId: string, id: string, tag: string) =>
  changeAccountTags(db, environmentId, id, { kind: 'add', tag });

/** C13 `remove-tag`, ignoring case. */
export const removeAccountTag = (db: Db, environmentId: string, id: string, tag: string) =>
  changeAccountTags(db, environmentId, id, { kind: 'remove', tag });

/**
 * C13 `set-tags`: replaces the list, deduplicated ignoring case.
 * @throws {TagLimitError} with more than 50 tags.
 */
export const setAccountTags = (
  db: Db,
  environmentId: string,
  id: string,
  tags: readonly string[],
) => changeAccountTags(db, environmentId, id, { kind: 'set', tags });

// ---------------------------------------------------------------------------------------
// Inquiries of an account

export interface ResolveInquiryAccountInput {
  /** C13 step 1: an account of this environment. */
  accountId?: string | null | undefined;
  /** C13 step 2: the account with this reference id, created when there is none. */
  referenceId?: string | null | undefined;
  /** Id for an account this call creates; generated when omitted. */
  newAccountId?: string | undefined;
}

/**
 * C13 inquiry-to-account resolution (`AccountsService.resolveForInquiry` builds on it):
 * 1. `accountId`, which must be in this environment, else `null` (404);
 * 2. otherwise the account with `referenceId`, created in the type `user` if there is
 *    none (a concurrent creation is resolved by the unique index, not duplicated); an
 *    account that was consolidated resolves to the account that absorbed it;
 * 3. otherwise a new account of the type `user`.
 */
export async function resolveInquiryAccount(
  db: Db,
  environmentId: string,
  input: ResolveInquiryAccountInput,
): Promise<string | null> {
  if (input.accountId != null) {
    return (await getAccountRef(db, environmentId, input.accountId))?.id ?? null;
  }
  const id = input.newAccountId ?? generateId('acc');
  const referenceId = input.referenceId ?? null;
  const created = firstOrNull(
    await db
      .insert(accounts)
      .values({
        id,
        environmentId,
        accountTypeId: defaultAccountTypeId(environmentId),
        referenceId,
      })
      .onConflictDoNothing({ target: [accounts.environmentId, accounts.referenceId] })
      .returning({ id: accounts.id }),
  );
  if (created !== null || referenceId === null) {
    return created?.id ?? null;
  }
  return (await lockAbsorbingAccount(db, environmentId, { referenceId }))?.id ?? null;
}

async function getAccountRef(db: Db, environmentId: string, id: string) {
  return firstOrNull(
    await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(inEnvironment(environmentId, id))
      .limit(1),
  );
}

/**
 * C13 `add-objects` (and `remove-objects`, which moves inquiries to a fresh account): moves
 * the given inquiries of this environment to the account. Returns the ids moved; none when
 * the account is not in this environment.
 */
export async function moveInquiriesToAccount(
  db: Db,
  environmentId: string,
  accountId: string,
  inquiryIds: readonly string[],
): Promise<string[]> {
  if (inquiryIds.length === 0 || (await getAccountRef(db, environmentId, accountId)) === null) {
    return [];
  }
  const rows = await db
    .update(inquiries)
    .set({ accountId })
    .where(and(eq(inquiries.environmentId, environmentId), inArray(inquiries.id, [...inquiryIds])))
    .returning({ id: inquiries.id });
  return rows.map((row) => row.id);
}

/** C13 relationship `inquiries`: the ids of the account's latest inquiries, newest first. */
export async function listAccountInquiryIds(
  db: Db,
  environmentId: string,
  accountId: string,
  limit = 100,
): Promise<string[]> {
  const rows = await db
    .select({ id: inquiries.id })
    .from(inquiries)
    .where(and(eq(inquiries.environmentId, environmentId), eq(inquiries.accountId, accountId)))
    .orderBy(desc(inquiries.createdAt), desc(inquiries.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------------------
// Relations

export interface AccountRelationInput {
  fromAccountId: string;
  toAccountId: string;
  /** `^[a-z][a-z0-9_]{0,63}$`, e.g. `spouse`. */
  relationType: string;
}

/** One relation as seen from an account (C13 `GET /accounts/:id/relations`). */
export interface AccountRelationView {
  relatedAccountId: string;
  relationType: string;
  direction: 'outgoing' | 'incoming';
  createdAt: Date;
}

/**
 * C13 `add-relation`. Returns `false` when the relation already exists. The database
 * refuses a self-relation, a bad type or an account of another environment.
 */
export async function addAccountRelation(
  db: Db,
  environmentId: string,
  input: AccountRelationInput,
): Promise<boolean> {
  const rows = await db
    .insert(accountRelations)
    .values({ environmentId, ...input })
    .onConflictDoNothing({
      target: [
        accountRelations.fromAccountId,
        accountRelations.toAccountId,
        accountRelations.relationType,
      ],
    })
    .returning({ id: accountRelations.id });
  return rows.length > 0;
}

/** C13 `remove-relation`. Returns `false` when there was no such relation here. */
export async function removeAccountRelation(
  db: Db,
  environmentId: string,
  input: AccountRelationInput,
): Promise<boolean> {
  const rows = await db
    .delete(accountRelations)
    .where(
      and(
        eq(accountRelations.environmentId, environmentId),
        eq(accountRelations.fromAccountId, input.fromAccountId),
        eq(accountRelations.toAccountId, input.toAccountId),
        eq(accountRelations.relationType, input.relationType),
      ),
    )
    .returning({ id: accountRelations.id });
  return rows.length > 0;
}

/** Both directions of an account's relations, oldest first. */
export async function listAccountRelations(
  db: Db,
  environmentId: string,
  accountId: string,
): Promise<AccountRelationView[]> {
  const rows = await db
    .select()
    .from(accountRelations)
    .where(
      and(
        eq(accountRelations.environmentId, environmentId),
        or(
          eq(accountRelations.fromAccountId, accountId),
          eq(accountRelations.toAccountId, accountId),
        ),
      ),
    )
    .orderBy(asc(accountRelations.createdAt), asc(accountRelations.id));
  return rows.map((row) =>
    row.fromAccountId === accountId
      ? {
          relatedAccountId: row.toAccountId,
          relationType: row.relationType,
          direction: 'outgoing' as const,
          createdAt: row.createdAt,
        }
      : {
          relatedAccountId: row.fromAccountId,
          relationType: row.relationType,
          direction: 'incoming' as const,
          createdAt: row.createdAt,
        },
  );
}

// ---------------------------------------------------------------------------------------
// Consolidation

export type AccountConsolidationFailure =
  | 'invalid_sources'
  | 'target_in_sources'
  | 'not_found'
  | 'target_inactive'
  | 'source_consolidated'
  | 'too_many_tags';

/** A C13 consolidation request the data does not allow; nothing was changed. */
export class AccountConsolidationError extends Error {
  override name = 'AccountConsolidationError';
  readonly code = 'account_consolidation';
  readonly reason: AccountConsolidationFailure;

  constructor(reason: AccountConsolidationFailure) {
    super(`accounts cannot be consolidated: ${reason}`);
    this.reason = reason;
  }
}

export interface ConsolidateAccountsInput {
  targetId: string;
  /** 1-10 accounts to absorb, in priority order for conflicting fields. */
  sourceIds: readonly string[];
}

export interface ConsolidationResult {
  target: Account;
  sources: Account[];
  movedInquiryIds: string[];
}

/**
 * C13 `POST /accounts/:id/consolidate`, in one transaction:
 * - the sources' inquiries move to the target;
 * - tags are the union, ignoring case (target first);
 * - fields merge with the target winning, then the earlier source over the later;
 * - relations move to the target, deduplicated, and self-relations are dropped;
 * - each source becomes `archived` with `consolidated_into`, and accounts that had been
 *   consolidated into a source now point at the target.
 * All rows are locked in id order, so concurrent consolidations cannot deadlock.
 *
 * @throws {AccountConsolidationError} when the request is not allowed; nothing changes.
 */
export async function consolidateAccounts(
  db: Db,
  environmentId: string,
  input: ConsolidateAccountsInput,
): Promise<ConsolidationResult> {
  const { targetId } = input;
  const sourceIds = [...new Set(input.sourceIds)];
  if (sourceIds.length === 0 || sourceIds.length > MAX_CONSOLIDATION_SOURCES) {
    throw new AccountConsolidationError('invalid_sources');
  }
  if (sourceIds.includes(targetId)) {
    throw new AccountConsolidationError('target_in_sources');
  }
  return db.transaction(async (tx) => {
    const locked = (
      await tx
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.environmentId, environmentId),
            inArray(accounts.id, [targetId, ...sourceIds]),
          ),
        )
        .orderBy(asc(accounts.id))
        .for('update')
    ).map(toAccount);
    const byId = new Map(locked.map((account) => [account.id, account]));
    const target = byId.get(targetId);
    const sources = sourceIds.map((id) => byId.get(id));
    if (target === undefined || sources.some((source) => source === undefined)) {
      throw new AccountConsolidationError('not_found');
    }
    const sourceAccounts = sources as Account[];
    if (target.status !== 'active' || target.consolidatedInto !== null) {
      throw new AccountConsolidationError('target_inactive');
    }
    if (sourceAccounts.some((source) => source.consolidatedInto !== null)) {
      throw new AccountConsolidationError('source_consolidated');
    }
    let tags: string[];
    try {
      tags = applyTagOperation([], {
        kind: 'set',
        tags: [...target.tags, ...sourceAccounts.flatMap((source) => source.tags)],
      }).tags;
    } catch (error) {
      if (error instanceof TagLimitError) {
        throw new AccountConsolidationError('too_many_tags');
      }
      throw error;
    }
    const fields: AccountFields = {};
    for (const source of [...sourceAccounts].reverse()) {
      Object.assign(fields, source.fields);
    }
    Object.assign(fields, target.fields);

    const moved = await tx
      .update(inquiries)
      .set({ accountId: targetId })
      .where(
        and(eq(inquiries.environmentId, environmentId), inArray(inquiries.accountId, sourceIds)),
      )
      .returning({ id: inquiries.id });
    await moveRelations(tx, environmentId, targetId, sourceIds);
    await tx
      .update(accounts)
      .set({ consolidatedInto: targetId })
      .where(
        and(
          eq(accounts.environmentId, environmentId),
          inArray(accounts.consolidatedInto, sourceIds),
        ),
      );
    const archived = (
      await tx
        .update(accounts)
        .set({ status: 'archived', consolidatedInto: targetId })
        .where(and(eq(accounts.environmentId, environmentId), inArray(accounts.id, sourceIds)))
        .returning()
    ).map(toAccount);
    const updated = accountOrNull(
      await tx
        .update(accounts)
        .set({ tags, fieldsSealed: sealJson(SEALED.accountFields, targetId, fields) })
        .where(inEnvironment(environmentId, targetId))
        .returning(),
    );
    const order = new Map(sourceIds.map((id, index) => [id, index]));
    return {
      target: updated ?? target,
      sources: archived.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
      movedInquiryIds: moved.map((row) => row.id),
    };
  });
}

/** Re-points the sources' relations at the target, deduplicated, without self-relations. */
async function moveRelations(
  tx: Db,
  environmentId: string,
  targetId: string,
  sourceIds: readonly string[],
): Promise<void> {
  const sources = sql.join(
    sourceIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const remap = (column: SQL) =>
    sql`case when ${column} in (${sources}) then ${targetId} else ${column} end`;
  const from = sql`r.from_account_id`;
  const to = sql`r.to_account_id`;
  await tx.execute(sql`
    insert into ${accountRelations} (environment_id, from_account_id, to_account_id, relation_type)
    select distinct r.environment_id, ${remap(from)}, ${remap(to)}, r.relation_type
      from ${accountRelations} as r
     where r.environment_id = ${environmentId}
       and (r.from_account_id in (${sources}) or r.to_account_id in (${sources}))
       and ${remap(from)} <> ${remap(to)}
    on conflict (from_account_id, to_account_id, relation_type) do nothing`);
  await tx
    .delete(accountRelations)
    .where(
      and(
        eq(accountRelations.environmentId, environmentId),
        or(
          inArray(accountRelations.fromAccountId, [...sourceIds]),
          inArray(accountRelations.toAccountId, [...sourceIds]),
        ),
      ),
    );
}
