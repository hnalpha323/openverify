/**
 * C253 (Phase 11, Workflow 11B Stage 1b (D)): the access export of one account (`aexp_`, ours).
 *
 * - One row per export, created `pending` and unadmitted; `quotas`' admission enqueues the
 *   `account-export` job under C251's cap and stamps `admitted_at` (C251.1, Stage 1a amendment 16).
 * - The job (`dsar-export`'s) makes it `ready`, with the manifest sealed as an envelope object in
 *   storage under the export's id (`storage_key`, its wrapped data key in `wrapped_dek`, which the KEK
 *   rewrap re-wraps), its counts, `ready_at` and `expires_at` (`account-export-ttl-days`); or
 *   `failed` with its problem code (`account_export_too_large`, `account_export_unavailable`).
 * - `item_ids` lists the ids of everything the manifest lists (the account, its inquiries, sessions,
 *   verifications, files, reports, transactions, consent records, shares and the operator-review
 *   items), so that any redaction or retention deletion touching one deletes the exports listing it
 *   first (C253.4; a GIN index answers the overlap). Ids are not personal data; the manifest itself
 *   never touches the database.
 * - The C16 pass marks a `ready` export past `expires_at` `expired` and deletes its object; an
 *   expired export keeps its counts and times (C253.4).
 *
 * The row holds no personal data and no export content (rule 11).
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { idPattern } from '../ids.js';
import { createdAt, idFormat, oneOf, timestamptz, updatedAt } from './columns.js';
import { environmentId } from './environment-id.js';

/** C253.1: what an export is (`ACCOUNT_EXPORT_STATUSES` in `@openverify/contracts`). */
export const ACCOUNT_EXPORT_STATUS_VALUES = ['pending', 'ready', 'failed', 'expired'] as const;
export type AccountExportStatusValue = (typeof ACCOUNT_EXPORT_STATUS_VALUES)[number];
/** C253.5, C253.7: why an export failed, a problem code and nothing else. */
export const ACCOUNT_EXPORT_ERROR_CODE_VALUES = [
  'account_export_too_large',
  'account_export_unavailable',
] as const;
/** C253.1: who asked; a workflow run never exports. */
export const ACCOUNT_EXPORT_CREATOR_TYPES = ['user', 'api-key'] as const;

/** `encryptBytes`' wrapped data key, as `files.wrapped_dek` reads. */
const wrappedDekFormat = (name: string, column: AnyPgColumn) =>
  check(
    name,
    sql`${column} is null or ${column} ~ '^ov1\\.[A-Za-z0-9_-]{11}\\.[A-Za-z0-9_-]{80}$'`,
  );

export const accountExports = pgTable(
  'account_exports',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    accountId: text('account_id').notNull(),
    creatorType: text('creator_type')
      .$type<(typeof ACCOUNT_EXPORT_CREATOR_TYPES)[number]>()
      .notNull(),
    creatorId: text('creator_id').notNull(),
    status: text('status').$type<AccountExportStatusValue>().notNull().default('pending'),
    /** C251.1: when the cap admitted the export's job; `null` while it waits. */
    admittedAt: timestamptz('admitted_at'),
    /** C253.4: the ids of everything the manifest lists. */
    itemIds: text('item_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    itemCount: integer('item_count'),
    /** The manifest's plaintext size, while it is kept. */
    byteCount: bigint('byte_count', { mode: 'number' }),
    errorCode: text('error_code').$type<(typeof ACCOUNT_EXPORT_ERROR_CODE_VALUES)[number]>(),
    /** The manifest's ciphertext object, while it is kept. */
    storageKey: text('storage_key'),
    /** `ov1.<kid>.<wrapped DEK>` from `encryptBytes`, while the manifest is kept. */
    wrappedDek: text('wrapped_dek'),
    readyAt: timestamptz('ready_at'),
    /** `account-export-ttl-days` after `ready_at`. */
    expiresAt: timestamptz('expires_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('account_exports_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('account_exports_storage_key_key').on(table.storageKey),
    // C253.5: one pending export per account.
    uniqueIndex('account_exports_one_pending_key')
      .on(table.environmentId, table.accountId)
      .where(sql`${table.status} = 'pending'`),
    // C251.1: the held exports of an environment, oldest first, for the fair sweep.
    index('account_exports_unadmitted_idx')
      .on(table.environmentId, table.createdAt, table.id)
      .where(sql`${table.status} = 'pending' and ${table.admittedAt} is null`),
    // C253.4: the exports listing an item.
    index('account_exports_item_ids_idx').using('gin', table.itemIds),
    // C253.4: the C16 pass expires the exports past their life.
    index('account_exports_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'ready'`),
    idFormat('account_exports', table.id, 'aexp'),
    check(
      'account_exports_account_id_format',
      sql`${table.accountId} ~ ${sql.raw(`'${idPattern('acc')}'`)}`,
    ),
    check(
      'account_exports_creator_type_valid',
      oneOf(table.creatorType, ACCOUNT_EXPORT_CREATOR_TYPES),
    ),
    check(
      'account_exports_creator_id_format',
      sql`(${table.creatorType} is distinct from 'user'
          or ${table.creatorId} ~ ${sql.raw(`'${idPattern('usr')}'`)})
        and (${table.creatorType} is distinct from 'api-key'
          or ${table.creatorId} ~ ${sql.raw(`'${idPattern('key')}'`)})`,
    ),
    check('account_exports_status_valid', oneOf(table.status, ACCOUNT_EXPORT_STATUS_VALUES)),
    check('account_exports_item_ids_present', sql`array_position(${table.itemIds}, null) is null`),
    // C253.1: a ready or expired export has its time, expiry and count.
    check(
      'account_exports_ready_with_times',
      sql`(${table.status} in ('ready', 'expired')) = (${table.readyAt} is not null
        and ${table.expiresAt} is not null and ${table.itemCount} is not null)`,
    ),
    // The manifest, its key and its size exactly while it is kept.
    check(
      'account_exports_object_while_ready',
      sql`(${table.status} = 'ready') = (${table.storageKey} is not null)
        and (${table.storageKey} is null) = (${table.wrappedDek} is null)
        and (${table.status} = 'ready') = (${table.byteCount} is not null)`,
    ),
    check(
      'account_exports_error_when_failed',
      sql`(${table.status} = 'failed') = (${table.errorCode} is not null)`,
    ),
    check(
      'account_exports_error_code_valid',
      sql`${table.errorCode} is null or ${oneOf(table.errorCode, ACCOUNT_EXPORT_ERROR_CODE_VALUES)}`,
    ),
    check(
      'account_exports_counts',
      sql`(${table.itemCount} is null or ${table.itemCount} between 0 and 5000)
        and (${table.byteCount} is null or ${table.byteCount} >= 0)`,
    ),
    wrappedDekFormat('account_exports_wrapped_dek_format', table.wrappedDek),
  ],
);

export type AccountExportRecord = typeof accountExports.$inferSelect;
export type NewAccountExportRecord = typeof accountExports.$inferInsert;
