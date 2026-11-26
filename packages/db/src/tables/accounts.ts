/** Accounts group a person's inquiries (C13): types, fields, tags and relations. */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import {
  createdAt,
  idFormat,
  lowerTags,
  timestamptz,
  updatedAt,
  validTags,
  workflowRunStepId,
  workflowRunStepKey,
} from './columns.js';
import { accountStatus } from './enums.js';
import { environmentId } from './environment-id.js';
import { hydratedFieldsColumn, hydratedFieldsList } from './connect-columns.js';

/** C13 `fields-schema`: field key (snake_case) to `{ type, label }`. */
export type AccountFieldsSchema = Record<
  string,
  { type: 'string' | 'number' | 'boolean' | 'date'; label: string }
>;

/**
 * C13 account types. Every environment has the type `user`: a database trigger on
 * `environments` inserts it (migration 0003), so environments created by any code path,
 * including the Phase 1 seed and test helpers, have it.
 */
export const accountTypes = pgTable(
  'account_types',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    name: text('name').notNull(),
    fieldsSchema: jsonb('fields_schema').$type<AccountFieldsSchema>().notNull().default({}),
    /** C128.3 (a C13 amendment): how a person contests a decision on an account of this type. */
    contestRoute: jsonb('contest_route').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'account_types_contest_route_object',
      sql`${table.contestRoute} is null or jsonb_typeof(${table.contestRoute}) = 'object'`,
    ),
    unique('account_types_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('account_types_environment_id_name_key').on(table.environmentId, table.name),
    index('account_types_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check('account_types_name_not_blank', sql`btrim(${table.name}) <> ''`),
    idFormat('account_types', table.id, 'acctp'),
  ],
);

/**
 * A C13 account. `fields` is end-user PII, sealed for this row (`accounts.fields#<id>`);
 * `NULL` means no fields, as after redaction. A consolidated account is `archived` and
 * points at the account that absorbed it.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    accountTypeId: text('account_type_id').notNull(),
    /** Customer-chosen reference, unique per environment when set. */
    referenceId: text('reference_id'),
    status: accountStatus('status').notNull().default('active'),
    fieldsSealed: sealedColumn('fields'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    consolidatedInto: text('consolidated_into'),
    redactedAt: timestamptz('redacted_at'),
    /** C117.5: the run's step that created it; `null` for anything else. */
    workflowRunStepId: workflowRunStepId(),
    /** C230.5, C235.1 (Workflow 11A): the keys hydrated from a share, with their token; never a value. */
    hydratedFields: hydratedFieldsColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    hydratedFieldsList('accounts_hydrated_fields_list', table.hydratedFields),
    ...workflowRunStepKey('accounts', table.environmentId, table.workflowRunStepId),
    foreignKey({
      name: 'accounts_account_type_fk',
      columns: [table.environmentId, table.accountTypeId],
      foreignColumns: [accountTypes.environmentId, accountTypes.id],
    }),
    foreignKey({
      name: 'accounts_consolidated_into_fk',
      columns: [table.environmentId, table.consolidatedInto],
      foreignColumns: [table.environmentId, table.id],
    }),
    // Consolidation re-points and redaction finds the accounts consolidated into an account,
    // and the self-referencing key is checked, without scanning the environment (2B F023).
    index('accounts_environment_id_consolidated_into_idx')
      .on(table.environmentId, table.consolidatedInto)
      .where(sql`${table.consolidatedInto} IS NOT NULL`),
    unique('accounts_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('accounts_environment_id_reference_id_key').on(
      table.environmentId,
      table.referenceId,
    ),
    index('accounts_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('accounts_environment_id_account_type_id_created_at_id_idx').on(
      table.environmentId,
      table.accountTypeId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('accounts_environment_id_status_created_at_id_idx').on(
      table.environmentId,
      table.status,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('accounts_lower_tags_idx').using('gin', lowerTags(table.tags)),
    check('accounts_not_consolidated_into_itself', sql`${table.consolidatedInto} <> ${table.id}`),
    check(
      'accounts_consolidated_is_archived',
      sql`${table.consolidatedInto} IS NULL OR ${table.status} = 'archived'`,
    ),
    validTags('accounts_tags_valid', table.tags),
    idFormat('accounts', table.id, 'acc'),
  ],
);

/**
 * Directed C13 relations such as `spouse` or `business_owner`, unique per (from, to,
 * type). An account cannot relate to itself.
 */
export const accountRelations = pgTable(
  'account_relations',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    environmentId: environmentId(),
    fromAccountId: text('from_account_id').notNull(),
    toAccountId: text('to_account_id').notNull(),
    relationType: text('relation_type').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'account_relations_from_account_fk',
      columns: [table.environmentId, table.fromAccountId],
      foreignColumns: [accounts.environmentId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'account_relations_to_account_fk',
      columns: [table.environmentId, table.toAccountId],
      foreignColumns: [accounts.environmentId, accounts.id],
    }).onDelete('cascade'),
    uniqueIndex('account_relations_from_to_type_key').on(
      table.fromAccountId,
      table.toAccountId,
      table.relationType,
    ),
    index('account_relations_environment_id_to_account_id_idx').on(
      table.environmentId,
      table.toAccountId,
    ),
    check('account_relations_not_self', sql`${table.fromAccountId} <> ${table.toAccountId}`),
    check('account_relations_type_format', sql`${table.relationType} ~ '^[a-z][a-z0-9_]{0,63}$'`),
  ],
);

export type AccountType = typeof accountTypes.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type AccountRelation = typeof accountRelations.$inferSelect;

/** C13 account `fields`: values keyed by the type's field keys. */
export type AccountFields = Record<string, unknown>;

/** An account as the repositories return it: `fields` opened (`{}` when none). */
export type Account = Omit<AccountRow, 'fieldsSealed'> & { fields: AccountFields };
