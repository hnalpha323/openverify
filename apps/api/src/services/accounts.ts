/**
 * Accounts (contract C13): they group a person's inquiries, with a type, fields, tags and
 * relations, and can be consolidated. Every function is scoped to one environment; state
 * changes stage their C17 events in the transaction that makes the change, dispatch them after
 * the commit, and record a C15 audit entry in the same transaction.
 *
 * The account type `user`: a database trigger (migration 0003) inserts it, with no fields, into
 * every environment. {@link ensureDefaultAccountType} seeds it lazily on first use: it gives the
 * type its default fields schema ({@link DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA}, which matches the
 * C20 fixture) and re-creates the type if it is missing. Account types cannot be edited through
 * the API in C13, so an empty schema on `user` is always the
 * trigger's placeholder. Since C25.3 (Workflow 2E) `PATCH /account-types/:id` changes a type, but
 * only additively, and keeps the name of `user`, so a seeded `user` never empties again.
 */
import {
  accountFieldIssues,
  accountFieldsSchema,
  accountTypeFieldsChangeIssues,
  accountStatusSchema,
  buildAccountRelation,
  buildAccountResource,
  buildAccountTypeResource,
  DEFAULT_ACCOUNT_TYPE_NAME,
  filterValues,
  idSchema,
  MAX_ACCOUNT_INQUIRY_LINKAGE,
  tagInputSchema,
  type AccountFieldDefinition,
  type AccountRelation,
  type AccountResource,
  type AccountTypeResource,
  type AuditActor,
  type CreateAccountBody,
  type CreateAccountTypeBody,
  type EventName,
  type EventPayload,
  type ListAccountsQuery,
  type UpdateAccountBody,
  type UpdateAccountTypeBody,
} from '@openverify/contracts';
import {
  addTag,
  dedupeTags,
  normalizeTag,
  normalizeTags,
  removeTag,
  tagKey,
  TooManyTagsError,
} from '@openverify/core';
import {
  AccountConsolidationError,
  accountTypes,
  accounts,
  addAccountRelation as insertAccountRelation,
  consolidateAccounts as mergeAccounts,
  createAccount as insertAccount,
  createAccountType as insertAccountType,
  findAccountByReferenceId,
  findAccountTypeByName,
  getAccount,
  getAccountType,
  getDefaultAccountType,
  inquiries,
  InvalidCursorError,
  listAccountInquiryIds,
  listAccountRelations as findAccountRelations,
  listAccounts as findAccounts,
  lockAbsorbingAccount,
  lockAccount,
  lockAccountType,
  moveInquiriesToAccount,
  pageSize,
  pgErrorCode,
  removeAccountRelation as deleteAccountRelation,
  resolveInquiryAccount,
  setAccountTags,
  TagLimitError,
  toAccount,
  updateAccount as writeAccountChanges,
  updateAccountType as writeAccountTypeChanges,
  type Account,
  type AccountChanges,
  type AccountType,
  type Db,
  type Page,
} from '@openverify/db';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import { UNMASKED, type PiiMask } from '../auth/pii.js';
import {
  AppError,
  ConflictError,
  InvalidTransitionError,
  NotFoundError,
  RedactedError,
  UnprocessableContentError,
  type ProblemFieldError,
} from '../errors.js';
import type { StagedEvent, TransactionalEventPublisher } from '../events/index.js';
import {
  ulidIdGenerator,
  type AccountsService,
  type IdGenerator,
  type ServiceContext,
} from '../ports.js';
import { auditEntryOf, type ApiDependencies, type AuditedAction } from './context.js';
import { nextLink, pageRequest, withCursor } from './pagination.js';
import { moveGraphOnConsolidationInTx } from './graph/consolidation.js';
import { indexAccountAttributesInTx } from './graph/indexing.js';
import { moveReportLinksInTx } from './reports/accounts.js';

export const ACCOUNTS_PATH = '/api/v1/accounts';
export const ACCOUNT_TYPES_PATH = '/api/v1/account-types';

/**
 * The fields of the type `user`, seeded on first use. A superset of the C20 fixture
 * (`name_first`, `name_last`, `birthdate`); every key is snake_case (C13).
 */
export const DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA: Readonly<Record<string, AccountFieldDefinition>> =
  Object.freeze({
    name_first: { type: 'string', label: 'First name' },
    name_middle: { type: 'string', label: 'Middle name' },
    name_last: { type: 'string', label: 'Last name' },
    birthdate: { type: 'date', label: 'Date of birth' },
    email_address: { type: 'string', label: 'Email address' },
    phone_number: { type: 'string', label: 'Phone number' },
    address_street_1: { type: 'string', label: 'Street address' },
    address_street_2: { type: 'string', label: 'Street address, line 2' },
    address_city: { type: 'string', label: 'City' },
    address_subdivision: { type: 'string', label: 'State or province' },
    address_postal_code: { type: 'string', label: 'Postal code' },
    address_country_code: { type: 'string', label: 'Country (ISO 3166-1 alpha-2)' },
    identification_number: { type: 'string', label: 'Identification number' },
  });

const UNIQUE_VIOLATION = '23505';

const isEmptySchema = (type: AccountType): boolean => Object.keys(type.fieldsSchema).length === 0;

/**
 * The environment's account type `user`, seeded on first use: created when missing, and given
 * {@link DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA} while its schema is still the trigger's empty one.
 * Safe to run concurrently: the insert and the update are conditional.
 */
export async function ensureDefaultAccountType(
  db: Db,
  environmentId: string,
  ids: IdGenerator = ulidIdGenerator,
): Promise<AccountType> {
  let type = await getDefaultAccountType(db, environmentId);
  if (type === null) {
    await db
      .insert(accountTypes)
      .values({
        id: ids.newId('acctp'),
        environmentId,
        name: DEFAULT_ACCOUNT_TYPE_NAME,
        fieldsSchema: { ...DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA },
      })
      .onConflictDoNothing({ target: [accountTypes.environmentId, accountTypes.name] });
    type = await getDefaultAccountType(db, environmentId);
  } else if (isEmptySchema(type)) {
    const [seeded] = await db
      .update(accountTypes)
      .set({ fieldsSchema: { ...DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA } })
      .where(
        and(
          eq(accountTypes.environmentId, environmentId),
          eq(accountTypes.id, type.id),
          sql`${accountTypes.fieldsSchema} = '{}'::jsonb`,
        ),
      )
      .returning();
    type = seeded ?? (await getDefaultAccountType(db, environmentId));
  }
  if (type === null) {
    throw new Error('ensureDefaultAccountType: the account type user could not be seeded');
  }
  return type;
}

/** The type with the lazily seeded `user` schema applied (see the module comment). */
async function seeded(db: Db, environmentId: string, type: AccountType): Promise<AccountType> {
  return type.name === DEFAULT_ACCOUNT_TYPE_NAME && isEmptySchema(type)
    ? ensureDefaultAccountType(db, environmentId)
    : type;
}

/** @throws {NotFoundError} when the type is not in this environment. */
async function findAccountType(db: Db, environmentId: string, id: string): Promise<AccountType> {
  const type = await getAccountType(db, environmentId, id);
  if (type === null) {
    throw new NotFoundError(`Account type ${id} was not found.`);
  }
  return seeded(db, environmentId, type);
}

/** @throws {NotFoundError} when the account is not in this environment. */
async function findAccount(db: Db, environmentId: string, id: string): Promise<Account> {
  const account = await getAccount(db, environmentId, id);
  if (account === null) {
    throw new NotFoundError(`Account ${id} was not found.`);
  }
  return account;
}

/** Locks the account's row for the caller's transaction. */
async function lockExisting(tx: Db, environmentId: string, id: string): Promise<Account> {
  const account = await lockAccount(tx, environmentId, id);
  if (account === null) {
    throw new NotFoundError(`Account ${id} was not found.`);
  }
  return account;
}

// Resources ------------------------------------------------------------------------------

/** An account with the ids of its latest inquiries (newest first), as the resource shows it. */
export interface AccountView {
  account: Account;
  inquiryIds: readonly string[];
}

/**
 * The C13 account resource. `mask` hides field values from a user without `pii:view` (C15);
 * event payloads use the default, {@link UNMASKED}.
 */
export function accountResource(view: AccountView, mask: PiiMask = UNMASKED): AccountResource {
  const { account } = view;
  return buildAccountResource({
    id: account.id,
    referenceId: account.referenceId,
    status: account.status,
    fields: mask.fields(accountFieldsSchema.parse(account.fields)),
    tags: account.tags,
    consolidatedInto: account.consolidatedInto,
    accountTypeId: account.accountTypeId,
    inquiryIds: view.inquiryIds,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    redactedAt: account.redactedAt,
  });
}

export function accountTypeResource(type: AccountType): AccountTypeResource {
  return buildAccountTypeResource({
    id: type.id,
    name: type.name,
    fieldsSchema: type.fieldsSchema,
    contestRoute: type.contestRoute,
    createdAt: type.createdAt,
  });
}

async function viewOf(db: Db, environmentId: string, account: Account): Promise<AccountView> {
  return { account, inquiryIds: await listAccountInquiryIds(db, environmentId, account.id) };
}

/** The latest inquiry ids of several accounts in one query, newest first per account. */
async function inquiryIdsOf(
  db: Db,
  environmentId: string,
  accountIds: readonly string[],
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>(accountIds.map((id) => [id, []]));
  if (accountIds.length === 0) {
    return grouped;
  }
  const rank = sql<number>`row_number() over (
    partition by ${inquiries.accountId}
    order by ${inquiries.createdAt} desc, ${inquiries.id} desc)`.as('rank');
  const ranked = db
    .select({ id: inquiries.id, accountId: inquiries.accountId, rank })
    .from(inquiries)
    .where(
      and(
        eq(inquiries.environmentId, environmentId),
        inArray(inquiries.accountId, [...accountIds]),
      ),
    )
    .as('ranked');
  const rows = await db
    .select({ id: ranked.id, accountId: ranked.accountId })
    .from(ranked)
    .where(lte(ranked.rank, MAX_ACCOUNT_INQUIRY_LINKAGE))
    .orderBy(asc(ranked.rank));
  for (const row of rows) {
    grouped.get(row.accountId)?.push(row.id);
  }
  return grouped;
}

// Transactions, events and audit entries -------------------------------------------------

/** What a state change runs with: its transaction, and the events it staged. */
export interface Change {
  tx: Db;
  ctx: ServiceContext;
  actor: AuditActor;
  emit: (name: EventName, payload: EventPayload) => Promise<void>;
  audit: (action: AuditedAction) => Promise<void>;
}

/**
 * Runs `work` in one transaction and dispatches its staged events after the commit, so a
 * change is never committed without its events and audit entries (C5, C15).
 */
async function change<T>(
  deps: ApiDependencies,
  ctx: ServiceContext,
  actor: AuditActor,
  work: (change: Change) => Promise<T>,
): Promise<T> {
  const staged: StagedEvent[] = [];
  const result = await deps.db.transaction((tx) =>
    work(accountChangeIn(tx, deps, ctx, actor, staged)),
  );
  await deps.events.dispatch(staged);
  return result;
}

/**
 * C117.5: a change in the caller's transaction, for an action that writes its effect row beside it.
 * Its events land in `staged`, for the caller to dispatch after the commit.
 */
export function accountChangeIn(
  tx: Db,
  deps: Pick<ApiDependencies, 'events' | 'audit'>,
  ctx: ServiceContext,
  actor: AuditActor,
  staged: StagedEvent[],
): Change {
  return {
    tx,
    ctx,
    actor,
    emit: async (name, payload) => {
      staged.push(await deps.events.stage(tx, { environmentId: ctx.environmentId, name, payload }));
    },
    audit: (action) => deps.audit.record(tx, auditEntryOf(ctx, actor, action)),
  };
}

/** Turns a unique-index violation into a 409 with `detail`; rethrows anything else. */
async function conflictOnDuplicate<T>(work: () => Promise<T>, detail: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      throw new ConflictError(detail);
    }
    throw error;
  }
}

const REFERENCE_TAKEN = 'Another account already has this reference-id.';

/** @throws {ConflictError} when another account of the environment has `referenceId`. */
async function assertReferenceFree(
  db: Db,
  environmentId: string,
  referenceId: string,
  accountId?: string,
): Promise<void> {
  const holder = await findAccountByReferenceId(db, environmentId, referenceId);
  if (holder !== null && holder.id !== accountId) {
    throw new ConflictError(REFERENCE_TAKEN);
  }
}

/**
 * Checks fields against the type's `fields-schema` (C13). The problem names the fields, never
 * their values, which are PII.
 * @throws {UnprocessableContentError} for unknown keys or values of the wrong type.
 */
function assertFieldsFit(
  fields: Readonly<Record<string, string | number | boolean | null>>,
  type: AccountType,
  problemOf: (field: string, message: string) => ProblemFieldError = (field, message) => ({
    location: 'body',
    pointer: `/data/attributes/fields/${field}`,
    detail: message,
  }),
): void {
  const issues = accountFieldIssues(fields, type.fieldsSchema);
  if (issues.length > 0) {
    throw new UnprocessableContentError(
      'The fields do not match the fields schema of the account type.',
      issues.map((issue) => problemOf(issue.field, issue.message)),
    );
  }
}

/** @throws {InvalidTransitionError} when the account was consolidated into another one. */
function assertNotConsolidated(account: Account): void {
  if (account.consolidatedInto !== null) {
    throw new InvalidTransitionError(
      `Account ${account.id} was consolidated into ${account.consolidatedInto}.`,
    );
  }
}

const sameValues = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

function sameFields(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>) {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
  );
}

/**
 * C101.3 (Workflow 7B): the graph indexer over an account's own fields and reference id, in the
 * write's transaction (`api-graph`); a failure rolls the write back.
 */
function indexAccountFieldsInTx(tx: Db, account: Account): Promise<number> {
  return indexAccountAttributesInTx(
    tx,
    account.environmentId,
    account.id,
    { type: 'account', id: account.id },
    { kind: 'account-fields', referenceId: account.referenceId, fields: account.fields },
  );
}

/** C101.3 (Workflow 7B): an inquiry now belongs to `accountId`: its graph rows move there. */
function indexLinkedInquiryInTx(
  tx: Db,
  environmentId: string,
  accountId: string,
  inquiryId: string,
): Promise<number> {
  return indexAccountAttributesInTx(
    tx,
    environmentId,
    accountId,
    { type: 'inquiry', id: inquiryId },
    { kind: 'inquiry-linked' },
  );
}

// Inquiry accounts (the locked port) -----------------------------------------------------

export interface AccountsServiceOptions {
  /** Stages `account.created` in the caller's transaction. */
  events: TransactionalEventPublisher;
  ids?: IdGenerator;
}

/**
 * The C13 `AccountsService`. `resolveForInquiry` runs in the transaction that creates the
 * inquiry and resolves its account in the locked order:
 * 1. `accountId`, which must be an account of the environment (404 otherwise); a consolidated
 *    account resolves to the account that absorbed it;
 * 2. otherwise the account with `referenceId` (likewise followed when consolidated), or a new
 *    one with that reference id; a concurrent creation is settled by the unique index;
 * 3. otherwise a new account.
 *
 * A new account is of the type `user` and gets `account.created`, staged in the caller's
 * transaction so it commits or rolls back with the inquiry. The staged event goes into the
 * caller's `staged` list, which the inquiry service dispatches after its commit with
 * `inquiry.created` (Workflow 2B K002); a caller without the list leaves its deliveries to the
 * dispatcher's sweep (the outbox, C5).
 */
export function createAccountsService(options: AccountsServiceOptions): AccountsService {
  const ids = options.ids ?? ulidIdGenerator;
  return {
    async resolveForInquiry(tx, ctx, input, staged) {
      const { environmentId } = ctx;
      // Share-locked, so a consolidation in flight is waited for (2B F012, F020).
      if (input.accountId !== undefined) {
        const account = await lockAbsorbingAccount(tx, environmentId, { id: input.accountId });
        if (account === null) {
          throw new NotFoundError(`Account ${input.accountId} was not found.`);
        }
        return account.id;
      }
      if (input.referenceId !== undefined) {
        const existing = await lockAbsorbingAccount(tx, environmentId, {
          referenceId: input.referenceId,
        });
        if (existing !== null) {
          return existing.id;
        }
      }
      await ensureDefaultAccountType(tx, environmentId);
      const newAccountId = ids.newId('acc');
      const resolved = await resolveInquiryAccount(tx, environmentId, {
        referenceId: input.referenceId ?? null,
        newAccountId,
      });
      if (resolved === null) {
        throw new Error('resolveForInquiry: the account could not be resolved');
      }
      if (resolved === newAccountId) {
        const account = await findAccount(tx, environmentId, resolved);
        if (account.referenceId !== null) {
          // C101.3 (Workflow 7B): a new account's reference id is an account field write.
          await indexAccountFieldsInTx(tx, account);
        }
        const created = await options.events.stage(tx, {
          environmentId,
          name: 'account.created',
          payload: { data: accountResource({ account, inquiryIds: [] }) },
        });
        staged?.push(created);
      }
      return resolved;
    },
  };
}

// Accounts -------------------------------------------------------------------------------

/**
 * `POST /accounts`: an account of the given type (default `user`), with fields checked
 * against the type's schema and tags normalized (C9). Emits `account.created`.
 * @throws {NotFoundError} for a type of another environment.
 * @throws {UnprocessableContentError} for fields the type does not define.
 * @throws {ConflictError} for a reference id another account has.
 */
export async function createAccount(
  deps: ApiDependencies,
  ctx: ServiceContext,
  actor: AuditActor,
  attributes: CreateAccountBody['data']['attributes'],
): Promise<AccountView> {
  return conflictOnDuplicate(
    () => change(deps, ctx, actor, (unit) => createAccountInTx(deps, unit, attributes)),
    REFERENCE_TAKEN,
  );
}

/** {@link createAccount} in the caller's transaction (C117.5). */
export async function createAccountInTx(
  deps: Pick<ApiDependencies, 'ids'>,
  { tx, ctx, emit, audit }: Change,
  attributes: CreateAccountBody['data']['attributes'],
): Promise<AccountView> {
  const { environmentId } = ctx;
        const typeId = attributes['account-type-id'];
        const type =
          typeId === undefined
            ? await ensureDefaultAccountType(tx, environmentId, deps.ids)
            : await findAccountType(tx, environmentId, typeId);
        const fields = attributes.fields ?? {};
        assertFieldsFit(fields, type);
        const referenceId = attributes['reference-id'] ?? null;
        if (referenceId !== null) {
          await assertReferenceFree(tx, environmentId, referenceId);
        }
        const account = await insertAccount(tx, environmentId, {
          id: deps.ids.newId('acc'),
          accountTypeId: type.id,
          referenceId,
          fields,
          tags: normalizeTags(attributes.tags ?? []),
        });
        // C101.3 (Workflow 7B): the graph rows of its fields and reference id.
        await indexAccountFieldsInTx(tx, account);
        const view: AccountView = { account, inquiryIds: [] };
        await emit('account.created', { data: accountResource(view) });
        await audit({ action: 'account.created', resourceType: 'account', resourceId: account.id });
        return view;
}

/** `GET /accounts/:id`. @throws {NotFoundError} when it is not in this environment. */
export async function getAccountView(
  { db }: ApiDependencies,
  environmentId: string,
  id: string,
): Promise<AccountView> {
  return viewOf(db, environmentId, await findAccount(db, environmentId, id));
}

export interface AccountViewPage {
  views: AccountView[];
  /** `links.next`. */
  next: string | null;
}

const toDate = (value: string | undefined) => (value === undefined ? undefined : new Date(value));

/**
 * The C9 `created-at` range. `listQuerySchema` validates it on every list, but the inferred
 * query types leave it out, so lists that read it add it back.
 */
export interface CreatedAtFilters {
  'filter[created-at-start]'?: string | undefined;
  'filter[created-at-end]'?: string | undefined;
}

/** `GET /accounts`: newest first, with the C9 filters. */
export async function listAccountViews(
  { db }: ApiDependencies,
  environmentId: string,
  query: ListAccountsQuery & CreatedAtFilters,
): Promise<AccountViewPage> {
  const page = await withCursor(() =>
    findAccounts(db, environmentId, {
      ...pageRequest(query),
      referenceId: query['filter[reference-id]'],
      accountTypeId: filterValues(query['filter[account-type-id]'], idSchema('acctp')),
      status: filterValues(query['filter[status]'], accountStatusSchema),
      tag: filterValues(query['filter[tag]'], tagInputSchema)?.map(normalizeTag),
      createdAtStart: toDate(query['filter[created-at-start]']),
      createdAtEnd: toDate(query['filter[created-at-end]']),
    }),
  );
  const ids = await inquiryIdsOf(
    db,
    environmentId,
    page.items.map((account) => account.id),
  );
  return {
    views: page.items.map((account) => ({ account, inquiryIds: ids.get(account.id) ?? [] })),
    next: nextLink(
      ACCOUNTS_PATH,
      {
        'filter[reference-id]': query['filter[reference-id]'],
        'filter[account-type-id]': query['filter[account-type-id]'],
        'filter[status]': query['filter[status]'],
        'filter[tag]': query['filter[tag]'],
        'filter[created-at-start]': query['filter[created-at-start]'],
        'filter[created-at-end]': query['filter[created-at-end]'],
      },
      query,
      page.next,
    ),
  };
}

/**
 * `PATCH /accounts/:id`: merges fields, sets the reference id, archives or restores. Emits
 * `account.updated-fields` when the fields changed, and `account.status-updated` (with
 * `meta: { from, to }`) plus `account.archived` or `account.restored` when the status did.
 * A request that changes nothing emits and records nothing.
 * @throws {RedactedError} 410 when setting fields of a redacted account (C16).
 * @throws {InvalidTransitionError} when restoring a consolidated account.
 */
export async function updateAccount(
  deps: ApiDependencies,
  ctx: ServiceContext,
  actor: AuditActor,
  id: string,
  attributes: UpdateAccountBody['data']['attributes'],
): Promise<AccountView> {
  return conflictOnDuplicate(
    () => change(deps, ctx, actor, (unit) => updateAccountInTx(unit, id, attributes)),
    REFERENCE_TAKEN,
  );
}

/** {@link updateAccount} in the caller's transaction (C117.5). */
export async function updateAccountInTx(
  { tx, ctx, emit, audit }: Change,
  id: string,
  attributes: UpdateAccountBody['data']['attributes'],
): Promise<AccountView> {
  const { environmentId } = ctx;
        const current = await lockExisting(tx, environmentId, id);
        const changes: AccountChanges = {};
        if (attributes.fields !== undefined) {
          if (current.redactedAt !== null) {
            throw new RedactedError(`Account ${id} was redacted; its fields cannot be set.`);
          }
          assertFieldsFit(
            attributes.fields,
            await findAccountType(tx, environmentId, current.accountTypeId),
          );
          if (!sameFields({ ...current.fields, ...attributes.fields }, current.fields)) {
            changes.fields = attributes.fields;
          }
        }
        const referenceId = attributes['reference-id'];
        if (referenceId !== undefined && referenceId !== current.referenceId) {
          if (referenceId !== null) {
            await assertReferenceFree(tx, environmentId, referenceId, id);
          }
          changes.referenceId = referenceId;
        }
        if (attributes.status !== undefined && attributes.status !== current.status) {
          if (attributes.status === 'active') {
            assertNotConsolidated(current);
          }
          changes.status = attributes.status;
        }
        if (Object.keys(changes).length === 0) {
          return viewOf(tx, environmentId, current);
        }
        const updated = await writeAccountChanges(tx, environmentId, id, changes);
        if (updated === null) {
          throw new NotFoundError(`Account ${id} was not found.`);
        }
        const { account, previous } = updated;
        if (changes.fields !== undefined || changes.referenceId !== undefined) {
          // C101.3 (Workflow 7B): the graph rows of the fields and reference id as stored now.
          await indexAccountFieldsInTx(tx, account);
        }
        const view = await viewOf(tx, environmentId, account);
        const data = accountResource(view);
        if (changes.fields !== undefined) {
          await emit('account.updated-fields', { data });
        }
        if (changes.status !== undefined) {
          await emit('account.status-updated', {
            data,
            meta: { from: previous.status, to: account.status },
          });
          await emit(account.status === 'archived' ? 'account.archived' : 'account.restored', {
            data,
          });
        }
        const changed = [
          ...(changes.fields === undefined ? [] : ['fields']),
          ...(changes.referenceId === undefined ? [] : ['reference-id']),
          ...(changes.status === undefined ? [] : ['status']),
        ];
        await audit({
          action: 'account.updated',
          resourceType: 'account',
          resourceId: id,
          metadata: { attributes: changed },
        });
        return view;
}

// Tags -----------------------------------------------------------------------------------

/** C9 tag actions: `add-tag`, `remove-tag` and `set-tags`. */
export type AccountTagChange =
  | { kind: 'add'; tag: string }
  | { kind: 'remove'; tag: string }
  | { kind: 'set'; tags: readonly string[] };

/** The tags after `request`, with the core rules (C9), or a 422 past 50 tags. */
function applyTagChange(current: readonly string[], request: AccountTagChange): string[] {
  try {
    switch (request.kind) {
      case 'add':
        return addTag(current, request.tag);
      case 'remove':
        return removeTag(current, request.tag);
      case 'set':
        return normalizeTags(request.tags);
    }
  } catch (error) {
    if (error instanceof TooManyTagsError || error instanceof TagLimitError) {
      throw new UnprocessableContentError(error.message);
    }
    throw error;
  }
}

const TAG_EVENTS: Readonly<Record<AccountTagChange['kind'], EventName>> = {
  add: 'account.tag-added',
  remove: 'account.tag-removed',
  set: 'account.updated-tags',
};

/**
 * Applies a tag action under the account's row lock (C9: unique ignoring case, at most 50).
 * Emits `account.tag-added` (meta `tag-name`), `account.tag-removed` or `account.updated-tags`
 * when the tags changed.
 * @throws {UnprocessableContentError} past 50 tags.
 */
export async function changeAccountTags(
  deps: ApiDependencies,
  ctx: ServiceContext,
  actor: AuditActor,
  id: string,
  request: AccountTagChange,
): Promise<AccountView> {
  return change(deps, ctx, actor, (unit) => changeAccountTagsInTx(unit, id, request));
}

/** {@link changeAccountTags} in the caller's transaction (C117.5). */
export async function changeAccountTagsInTx(
  { tx, ctx, emit, audit }: Change,
  id: string,
  request: AccountTagChange,
): Promise<AccountView> {
  const { environmentId } = ctx;
    const current = await lockExisting(tx, environmentId, id);
    const tags = applyTagChange(current.tags, request);
    if (sameValues(tags, current.tags)) {
      return viewOf(tx, environmentId, current);
    }
    const updated = await setAccountTags(tx, environmentId, id, tags);
    if (updated === null) {
      throw new NotFoundError(`Account ${id} was not found.`);
    }
    const view = await viewOf(tx, environmentId, updated.record);
    const name = TAG_EVENTS[request.kind];
    const tagName =
      request.kind === 'add'
        ? normalizeTag(request.tag)
        : request.kind === 'remove'
          ? current.tags.find((tag) => tagKey(tag) === tagKey(request.tag))
          : undefined;
    await emit(name, {
      data: accountResource(view),
      ...(tagName === undefined ? {} : { meta: { 'tag-name': tagName } }),
    });
    await audit({
      action: name,
      resourceType: 'account',
      resourceId: id,
      metadata: { 'tag-count': tags.length },
    });
    return view;
}

// Relations ------------------------------------------------------------------------------

export interface AccountRelationRequest {
  'related-account-id': string;
  'relation-type': string;
}

/**
 * `add-relation`: a directed relation, unique per (from, to, type). Adding it again changes
 * nothing. Emits `account.added-relation` with the relation in `meta`.
 * @throws {UnprocessableContentError} for a relation of the account to itself.
 * @throws {NotFoundError} when either account is not in this environment.
 * @throws {InvalidTransitionError} when either account was consolidated.
 */
export async function addAccountRelation(
  deps: ApiDependencies,
  ctx: ServiceContext,
  actor: AuditActor,
  id: string,
  relation: AccountRelationRequest,
): Promise<AccountView> {
  return change(deps, ctx, actor, (unit) => addAccountRelationInTx(unit, id, relation));
}

/** {@link addAccountRelation} in the caller's transaction (C117.5). */
export async function addAccountRelationInTx(
  { tx, ctx, emit, audit }: Change,
  id: string,
  relation: AccountRelationRequest,
): Promise<AccountView> {
  const { environmentId } = ctx;
  const relatedId = relation['related-account-id'];
  if (relatedId === id) {
    throw new UnprocessableContentError('An account cannot relate to itself.', [
      { location: 'body', pointer: '/meta/related-account-id', detail: 'must be another account' },
    ]);
  }
    // Both rows, in id order: a consolidation of either waits or is waited for, and two
    // requests over the same accounts cannot deadlock (2B F013).
    const locked = new Map(
      (await lockInIdOrder(tx, environmentId, [id, relatedId])).map((row) => [row.id, row]),
    );
    const account = locked.get(id);
    const related = locked.get(relatedId);
    if (account === undefined || related === undefined) {
      throw new NotFoundError(`Account ${account === undefined ? id : relatedId} was not found.`);
    }
    assertNotConsolidated(account);
    assertNotConsolidated(related);
    const added = await insertAccountRelation(tx, environmentId, {
      fromAccountId: id,
      toAccountId: relatedId,
      relationType: relation['relation-type'],
    });
    const view = await viewOf(tx, environmentId, account);
    if (added) {
      const meta = { 'related-account-id': relatedId, 'relation-type': relation['relation-type'] };
      await emit('account.added-relation', { data: accountResource(view), meta });
      await audit({
        action: 'account.added-relation',
        resourceType: 'account',
        resourceId: id,
        metadata: meta,
      });
    }
    return view;
}

/**
 * `remove-relation`. Removing a relation that does not exist changes nothing. Emits
 * `account.removed-relation`.
 * @throws {NotFoundError} when either account is not in this environment.
 */
export async function removeAccountRelation(
  deps: ApiDependencies,
  ctx: ServiceContext,
  actor: AuditActor,
  id: string,
  relation: AccountRelationRequest,
): Promise<AccountView> {
  return change(deps, ctx, actor, (unit) => removeAccountRelationInTx(unit, id, relation));
}

/** {@link removeAccountRelation} in the caller's transaction (C117.5). */
export async function removeAccountRelationInTx(
  { tx, ctx, emit, audit }: Change,
  id: string,
  relation: AccountRelationRequest,
): Promise<AccountView> {
  const { environmentId } = ctx;
  const relatedId = relation['related-account-id'];
    const account = await lockExisting(tx, environmentId, id);
    await findAccount(tx, environmentId, relatedId);
    const removed = await deleteAccountRelation(tx, environmentId, {
      fromAccountId: id,
      toAccountId: relatedId,
      relationType: relation['relation-type'],
    });
    const view = await viewOf(tx, environmentId, account);
    if (removed) {
      const meta = { 'related-account-id': relatedId, 'relation-type': relation['relation-type'] };
      await emit('account.removed-relation', { data: accountResource(view), meta });
      await audit({
        action: 'account.removed-relation',
        resourceType: 'account',
        resourceId: id,
        metadata: meta,
      });
    }
    return view;
}

/** `GET /accounts/:id/relations`: both directions, oldest first. */
export async function listAccountRelations(
  { db }: ApiDependencies,
  environmentId: string,
  id: string,
): Promise<AccountRelation[]> {
  await findAccount(db, environmentId, id);
  return (await findAccountRelations(db, environmentId, id)).map(buildAccountRelation);
}

// Consolidation --------------------------------------------------------------------------

function consolidationProblem(error: AccountConsolidationError): AppError {
  switch (error.reason) {
    case 'not_found':
      return new NotFoundError('An account to consolidate was not found.');
    case 'target_inactive':
      return new InvalidTransitionError(
        'The account is archived or consolidated and cannot absorb other accounts.',
      );
    case 'source_consolidated':
      return new InvalidTransitionError(
        'A source account was already consolidated into another account.',
      );
    case 'too_many_tags':
      return new UnprocessableContentError('The consolidated account would carry over 50 tags.');
    case 'invalid_sources':
    case 'target_in_sources':
      return new UnprocessableContentError('The source accounts cannot be consolidated.');
  }
}

/** Locks the accounts in id order (as the repository does), so consolidations never deadlock. */
async function lockInIdOrder(tx: Db, environmentId: string, ids: readonly string[]) {
  return (
    await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.environmentId, environmentId), inArray(accounts.id, [...ids])))
      .orderBy(asc(accounts.id))
      .for('update')
  ).map(toAccount);
}

/**
 * `POST /accounts/:id/consolidate` (C13), in one transaction: the sources' inquiries and
 * relations move to this account (relations deduplicated, self-relations dropped), tags are
 * the union (core rules), fields merge with this account winning, and each source is archived
 * with `consolidated-into`. Emits `account.consolidated` (this account, the sources in
 * `included`) and `account.consolidated-with` for each source.
 * @throws {UnprocessableContentError} when the account is among the sources, or the merged
 *   fields do not fit this account's type.
 * @throws {NotFoundError} when any account is not in this environment.
 * @throws {RedactedError} 410 when this account was redacted.
 * @throws {InvalidTransitionError} when this account is archived, or a source was already
 *   consolidated.
 */
export async function consolidateAccounts(
  deps: ApiDependencies,
  ctx: ServiceContext,
  actor: AuditActor,
  targetId: string,
  sourceIds: readonly string[],
): Promise<AccountView> {
  const { environmentId } = ctx;
  if (sourceIds.includes(targetId)) {
    throw new UnprocessableContentError('An account cannot be consolidated into itself.', [
      {
        location: 'body',
        pointer: '/meta/source-account-ids',
        detail: 'must not contain the target account',
      },
    ]);
  }
  return change(deps, ctx, actor, async ({ tx, emit, audit }) => {
    const locked = new Map(
      (await lockInIdOrder(tx, environmentId, [targetId, ...sourceIds])).map((account) => [
        account.id,
        account,
      ]),
    );
    const target = locked.get(targetId);
    if (target === undefined) {
      throw new NotFoundError(`Account ${targetId} was not found.`);
    }
    const sources = sourceIds.map((id) => {
      const source = locked.get(id);
      if (source === undefined) {
        throw new NotFoundError(`Account ${id} was not found.`);
      }
      return source;
    });
    if (target.redactedAt !== null) {
      throw new RedactedError(`Account ${targetId} was redacted and cannot absorb other accounts.`);
    }
    let result;
    try {
      result = await mergeAccounts(tx, environmentId, { targetId, sourceIds });
    } catch (error) {
      throw error instanceof AccountConsolidationError ? consolidationProblem(error) : error;
    }
    // C84.4: the absorbed accounts' report links move too, under the same account locks.
    await moveReportLinksInTx(tx, { environmentId, targetId, sourceIds });
    // C101.4 (Workflow 7B): and their graph rows, after their inquiries moved.
    await moveGraphOnConsolidationInTx(tx, { environmentId, targetId, sourceIds });
    const merged = accountFieldsSchema.safeParse(result.target.fields);
    if (!merged.success) {
      throw new UnprocessableContentError('The merged fields are not valid account fields.');
    }
    assertFieldsFit(
      merged.data,
      await findAccountType(tx, environmentId, result.target.accountTypeId),
      (field, message) => ({
        location: 'body',
        pointer: '/meta/source-account-ids',
        detail: `field ${field} of a source ${message} for the account type of this account`,
      }),
    );
    let consolidated = result.target;
    const tags = dedupeTags([target, ...sources].flatMap((account) => account.tags));
    if (!sameValues(tags, consolidated.tags)) {
      consolidated =
        (await setAccountTags(tx, environmentId, targetId, tags))?.record ?? consolidated;
    }
    const view = await viewOf(tx, environmentId, consolidated);
    const data = accountResource(view);
    const sourceResources = result.sources.map((source) =>
      accountResource({ account: source, inquiryIds: [] }),
    );
    await emit('account.consolidated', {
      data,
      included: sourceResources,
      meta: { 'source-account-ids': [...sourceIds] },
    });
    for (const source of sourceResources) {
      await emit('account.consolidated-with', {
        data: source,
        meta: { 'consolidated-into': targetId },
      });
    }
    await audit({
      action: 'account.consolidated',
      resourceType: 'account',
      resourceId: targetId,
      metadata: {
        'source-account-ids': [...sourceIds],
        'moved-inquiry-count': result.movedInquiryIds.length,
      },
    });
    for (const id of sourceIds) {
      await audit({
        action: 'account.consolidated-with',
        resourceType: 'account',
        resourceId: id,
        metadata: { 'consolidated-into': targetId },
      });
    }
    return view;
  });
}

// Objects (inquiries) ----------------------------------------------------------------------

/**
 * The account of each inquiry, its rows locked when `lock` says so.
 * @throws {NotFoundError} for an inquiry not in this environment.
 */
async function inquiryAccounts(
  tx: Db,
  environmentId: string,
  inquiryIds: readonly string[],
  lock: boolean,
): Promise<Map<string, string>> {
  const query = tx
    .select({ id: inquiries.id, accountId: inquiries.accountId })
    .from(inquiries)
    .where(and(eq(inquiries.environmentId, environmentId), inArray(inquiries.id, [...inquiryIds])))
    // In id order, so overlapping add-objects and remove-objects cannot deadlock (2B F013).
    .orderBy(asc(inquiries.id));
  const rows = lock ? await query.for('update') : await query;
  const found = new Map(rows.map((row) => [row.id, row.accountId]));
  const missing = inquiryIds.find((id) => !found.has(id));
  if (missing !== undefined) {
    throw new NotFoundError(`Inquiry ${missing} was not found.`);
  }
  return found;
}

/**
 * Locks what moving `inquiryIds` to or from account `id` touches, in one order (2B F025): every
 * account involved (this one and each inquiry's current one) in id order, then the inquiries in
 * id order. It is the order of inquiry creation (the account, then its inquiry) and of
 * consolidation (accounts in id order, then their inquiries), so a move waits for a
 * consolidation or redaction of the account an inquiry leaves instead of interleaving with it.
 * @returns this account and the account of each inquiry, both read under the locks.
 * @throws {NotFoundError} when the account or an inquiry is not in this environment.
 * @throws {ConflictError} when an inquiry moved to another account meanwhile (send it again).
 */
async function lockForMove(
  tx: Db,
  environmentId: string,
  id: string,
  inquiryIds: readonly string[],
): Promise<{ account: Account; current: Map<string, string> }> {
  await findAccount(tx, environmentId, id);
  const before = await inquiryAccounts(tx, environmentId, inquiryIds, false);
  const locked = await lockInIdOrder(tx, environmentId, [id, ...new Set(before.values())]);
  const account = locked.find((candidate) => candidate.id === id);
  if (account === undefined) {
    throw new NotFoundError(`Account ${id} was not found.`);
  }
  const current = await inquiryAccounts(tx, environmentId, inquiryIds, true);
  if (inquiryIds.some((inquiryId) => current.get(inquiryId) !== before.get(inquiryId))) {
    throw new ConflictError(
      'An inquiry moved to another account meanwhile; send the request again.',
    );
  }
  return { account, current };
}

/**
 * `add-objects`: links the inquiries to this account, moving them from their current account.
 * C13 emits no event; the audit entry lists the inquiries that moved.
 * @throws {NotFoundError} when the account or an inquiry is not in this environment.
 * @throws {InvalidTransitionError} when the account was consolidated.
 */
export async function addAccountObjects(
  deps: ApiDependencies,
  ctx: ServiceContext,
  actor: AuditActor,
  id: string,
  inquiryIds: readonly string[],
): Promise<AccountView> {
  const { environmentId } = ctx;
  return change(deps, ctx, actor, async ({ tx, audit }) => {
    const { account, current } = await lockForMove(tx, environmentId, id, inquiryIds);
    assertNotConsolidated(account);
    const moving = inquiryIds.filter((inquiryId) => current.get(inquiryId) !== id);
    if (moving.length > 0) {
      await moveInquiriesToAccount(tx, environmentId, id, moving);
      // C101.3 (Workflow 7B): each moved inquiry's graph rows follow it.
      for (const inquiryId of moving) {
        await indexLinkedInquiryInTx(tx, environmentId, id, inquiryId);
      }
      await audit({
        action: 'account.added-objects',
        resourceType: 'account',
        resourceId: id,
        metadata: { 'inquiry-ids': moving },
      });
    }
    return viewOf(tx, environmentId, account);
  });
}

/**
 * `remove-objects`: unlinks the inquiries from this account. Every inquiry has an account
 * (C13), so each moves to a new account of its own (type `user`, no reference id), which gets
 * `account.created`.
 * @throws {NotFoundError} when the account or an inquiry is not in this environment.
 * @throws {UnprocessableContentError} for an inquiry of another account.
 */
export async function removeAccountObjects(
  deps: ApiDependencies,
  ctx: ServiceContext,
  actor: AuditActor,
  id: string,
  inquiryIds: readonly string[],
): Promise<AccountView> {
  const { environmentId } = ctx;
  return change(deps, ctx, actor, async ({ tx, emit, audit }) => {
    const { account, current } = await lockForMove(tx, environmentId, id, inquiryIds);
    const errors = inquiryIds.flatMap((inquiryId, index): ProblemFieldError[] =>
      current.get(inquiryId) === id
        ? []
        : [
            {
              location: 'body',
              pointer: `/meta/objects/${String(index)}/id`,
              detail: 'is not linked to this account',
            },
          ],
    );
    if (errors.length > 0) {
      throw new UnprocessableContentError('Only inquiries of this account can be removed.', errors);
    }
    const type = await ensureDefaultAccountType(tx, environmentId, deps.ids);
    for (const inquiryId of inquiryIds) {
      const fresh = await insertAccount(tx, environmentId, {
        id: deps.ids.newId('acc'),
        accountTypeId: type.id,
      });
      await moveInquiriesToAccount(tx, environmentId, fresh.id, [inquiryId]);
      // C101.3 (Workflow 7B): the inquiry's graph rows follow it to its own account.
      await indexLinkedInquiryInTx(tx, environmentId, fresh.id, inquiryId);
      await emit('account.created', {
        data: accountResource({ account: fresh, inquiryIds: [inquiryId] }),
      });
    }
    await audit({
      action: 'account.removed-objects',
      resourceType: 'account',
      resourceId: id,
      metadata: { 'inquiry-ids': [...inquiryIds] },
    });
    return viewOf(tx, environmentId, account);
  });
}

// Account types ----------------------------------------------------------------------------

const TYPE_NAME_TAKEN = 'The environment already has an account type with this name.';

/**
 * `POST /account-types`. C13 emits no event; the audit entry is `account-type.created`.
 * @throws {ConflictError} for a name the environment already has.
 */
export async function createAccountType(
  deps: ApiDependencies,
  ctx: ServiceContext,
  actor: AuditActor,
  attributes: CreateAccountTypeBody['data']['attributes'],
): Promise<AccountType> {
  const { environmentId } = ctx;
  await ensureDefaultAccountType(deps.db, environmentId, deps.ids);
  return conflictOnDuplicate(
    () =>
      change(deps, ctx, actor, async ({ tx, audit }) => {
        if ((await findAccountTypeByName(tx, environmentId, attributes.name)) !== null) {
          throw new ConflictError(TYPE_NAME_TAKEN);
        }
        const type = await insertAccountType(tx, environmentId, {
          id: deps.ids.newId('acctp'),
          name: attributes.name,
          fieldsSchema: attributes['fields-schema'] ?? {},
          contestRoute: attributes['contest-route'] ?? null,
        });
        await audit({
          action: 'account-type.created',
          resourceType: 'account-type',
          resourceId: type.id,
        });
        return type;
      }),
    TYPE_NAME_TAKEN,
  );
}

/** A JSON Pointer reference token (RFC 6901): `~` and `/` escaped. */
const pointerToken = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** What makes an account-type change break C25.3, as problem `errors` (names, never values). */
function accountTypeChangeErrors(
  current: AccountType,
  attributes: UpdateAccountTypeBody['data']['attributes'],
): ProblemFieldError[] {
  const errors: ProblemFieldError[] = [];
  if (
    attributes.name !== undefined &&
    attributes.name !== current.name &&
    current.name === DEFAULT_ACCOUNT_TYPE_NAME
  ) {
    errors.push({
      location: 'body',
      pointer: '/data/attributes/name',
      detail: `the default account type ${DEFAULT_ACCOUNT_TYPE_NAME} keeps its name`,
    });
  }
  const next = attributes['fields-schema'];
  if (next !== undefined) {
    for (const issue of accountTypeFieldsChangeIssues(current.fieldsSchema, next)) {
      errors.push({
        location: 'body',
        pointer: `/data/attributes/fields-schema/${pointerToken(issue.field)}`,
        detail: issue.message,
      });
    }
  }
  return errors;
}

/**
 * `PATCH /account-types/:id` (C25.3, Workflow 2E): the name and the whole new `fields-schema`.
 * The schema may only grow: keys may be added and labels changed, but removing a key or changing
 * its type answers 422 with a JSON Pointer to the key, because accounts may hold values for it.
 * The seeded type `user` follows the same rule and keeps its name, which is how the API finds
 * it. The type is locked while the change is checked and written. C13 emits no event for account
 * types; the audit entry is `account-type.updated`.
 * @throws {NotFoundError} when the type is not in this environment.
 * @throws {UnprocessableContentError} for a change that is not additive, or renames `user`.
 * @throws {ConflictError} for a name the environment already has.
 */
export async function updateAccountType(
  deps: ApiDependencies,
  ctx: ServiceContext,
  actor: AuditActor,
  id: string,
  attributes: UpdateAccountTypeBody['data']['attributes'],
): Promise<AccountType> {
  const { environmentId } = ctx;
  await ensureDefaultAccountType(deps.db, environmentId, deps.ids);
  return conflictOnDuplicate(
    () =>
      change(deps, ctx, actor, async ({ tx, audit }) => {
        const current = await lockAccountType(tx, environmentId, id);
        if (current === null) {
          throw new NotFoundError(`Account type ${id} was not found.`);
        }
        const errors = accountTypeChangeErrors(current, attributes);
        if (errors.length > 0) {
          throw new UnprocessableContentError(
            'An account type change may add fields and change labels only.',
            errors,
          );
        }
        const { name } = attributes;
        if (
          name !== undefined &&
          name !== current.name &&
          (await findAccountTypeByName(tx, environmentId, name)) !== null
        ) {
          throw new ConflictError(TYPE_NAME_TAKEN);
        }
        const updated = await writeAccountTypeChanges(tx, environmentId, id, {
          ...(attributes.name === undefined ? {} : { name: attributes.name }),
          ...(attributes['fields-schema'] === undefined
            ? {}
            : { fieldsSchema: attributes['fields-schema'] }),
          ...(attributes['contest-route'] === undefined
            ? {}
            : { contestRoute: attributes['contest-route'] }),
        });
        if (updated === null) {
          throw new NotFoundError(`Account type ${id} was not found.`);
        }
        await audit({
          action: 'account-type.updated',
          resourceType: 'account-type',
          resourceId: id,
          metadata: { attributes: Object.keys(attributes) },
        });
        return updated;
      }),
    TYPE_NAME_TAKEN,
  );
}

/** `GET /account-types/:id`. @throws {NotFoundError} when it is not in this environment. */
export async function getAccountTypeRecord(
  { db }: ApiDependencies,
  environmentId: string,
  id: string,
): Promise<AccountType> {
  return findAccountType(db, environmentId, id);
}

export interface AccountTypeListQuery extends CreatedAtFilters {
  'page[after]'?: string | undefined;
  'page[size]'?: number | undefined;
}

export interface AccountTypePage {
  types: AccountType[];
  next: string | null;
}

/**
 * `GET /account-types`: newest first, with the C1 cursor and the C9 `created-at` range. The
 * type `user` is seeded first, so the list always shows its fields.
 */
export async function listAccountTypeRecords(
  { db }: ApiDependencies,
  environmentId: string,
  query: AccountTypeListQuery,
): Promise<AccountTypePage> {
  await ensureDefaultAccountType(db, environmentId);
  const request = pageRequest(query);
  const size = pageSize(request.size);
  const after = request.after;
  const filters: (SQL | undefined)[] = [
    eq(accountTypes.environmentId, environmentId),
    after === undefined
      ? undefined
      : sql`(${accountTypes.createdAt}, ${accountTypes.id}) < (
          select c.created_at, c.id from ${accountTypes} as c
           where c.id = ${after} and c.environment_id = ${environmentId})`,
    query['filter[created-at-start]'] === undefined
      ? undefined
      : gte(accountTypes.createdAt, new Date(query['filter[created-at-start]'])),
    query['filter[created-at-end]'] === undefined
      ? undefined
      : lt(accountTypes.createdAt, new Date(query['filter[created-at-end]'])),
  ];
  const page = await withCursor(async (): Promise<Page<AccountType>> => {
    const rows = await db
      .select()
      .from(accountTypes)
      .where(and(...filters))
      .orderBy(desc(accountTypes.createdAt), desc(accountTypes.id))
      .limit(size + 1);
    if (rows.length === 0 && after !== undefined) {
      if ((await getAccountType(db, environmentId, after)) === null) {
        throw new InvalidCursorError();
      }
    }
    const items = rows.slice(0, size);
    const last = items.at(-1);
    return { items, next: rows.length > size && last !== undefined ? last.id : null };
  });
  return {
    types: await Promise.all(page.items.map((type) => seeded(db, environmentId, type))),
    next: nextLink(
      ACCOUNT_TYPES_PATH,
      {
        'filter[created-at-start]': query['filter[created-at-start]'],
        'filter[created-at-end]': query['filter[created-at-end]'],
      },
      query,
      page.next,
    ),
  };
}
