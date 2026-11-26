/**
 * Accounts (contract C13): they group a person's inquiries. `fields` are encrypted at rest
 * and their values are null for a user without `pii:view` (C15).
 */
import { z } from 'zod';
import { actionBodySchema, emptyActionBodySchema } from './actions.js';
import { idSchema } from './ids.js';
import {
  accountIdentifierSchema,
  accountTypeIdentifierSchema,
  inquiryIdentifierSchema,
} from './identifiers.js';
import { inquiryFieldsSchema, referenceIdSchema, type InquiryFieldValue } from './inquiries.js';
import {
  hasDistinctValues,
  listDocumentSchema,
  requestDocumentSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';
import { tagInputSchema, tagListInputSchema, tagsSchema } from './tags.js';
import { listMatchResourceSchema } from './lists.js';
import { transactionResourceSchema } from './transactions.js';
import { REPORT_RESOURCE_SCHEMAS } from './reports.js';

export const ACCOUNT_STATUSES = ['active', 'archived'] as const;
export const accountStatusSchema = z.enum(ACCOUNT_STATUSES);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

/** Account fields follow the inquiry field rules: snake_case keys, scalar values, at most 100. */
export const accountFieldsSchema = inquiryFieldsSchema;

/** The account resource links its latest 100 inquiries. */
export const MAX_ACCOUNT_INQUIRY_LINKAGE = 100;

export const accountAttributesSchema = z.strictObject({
  /** Unique per environment when set. */
  'reference-id': referenceIdSchema.nullable(),
  status: accountStatusSchema,
  /** PII (C15): masked member by member; marked so masking by name stays safe (C70.3). */
  fields: accountFieldsSchema.meta({ pii: true }),
  tags: tagsSchema,
  /** The account this one was consolidated into, if any. */
  'consolidated-into': idSchema('acc').nullable(),
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
  'redacted-at': timestampSchema.nullable(),
});

export const accountRelationshipsSchema = z.strictObject({
  'account-type': toOneRelationshipSchema(accountTypeIdentifierSchema),
  /** The latest 100 inquiries, newest first. */
  inquiries: z.strictObject({
    data: z.array(inquiryIdentifierSchema).max(MAX_ACCOUNT_INQUIRY_LINKAGE),
  }),
});

export const accountResourceSchema = resourceWithRelationshipsSchema(
  'account',
  'acc',
  accountAttributesSchema,
  accountRelationshipsSchema,
);
export type AccountResource = z.infer<typeof accountResourceSchema>;

export const accountDocumentSchema = singleDocumentSchema(accountResourceSchema);
export const accountListDocumentSchema = listDocumentSchema(accountResourceSchema);

/** `POST /api/v1/accounts`. Without `account-type-id` the type `user` applies. */
export const createAccountBodySchema = requestDocumentSchema(
  'account',
  z.strictObject({
    'reference-id': referenceIdSchema.optional(),
    'account-type-id': idSchema('acctp').optional(),
    fields: accountFieldsSchema.optional().meta({ pii: true }),
    tags: tagListInputSchema.optional(),
  }),
);
export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;

/** `PATCH /api/v1/accounts/:id`: fields are merged; `status` moves between active and archived. */
export const updateAccountBodySchema = requestDocumentSchema(
  'account',
  z
    .strictObject({
      fields: accountFieldsSchema.optional().meta({ pii: true }),
      'reference-id': referenceIdSchema.nullable().optional(),
      status: accountStatusSchema.optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>;

/** `GET /api/v1/accounts` query. */
export const listAccountsQuerySchema = listQuerySchema('acc', {
  'filter[reference-id]': referenceIdSchema.optional(),
  'filter[account-type-id]': filterListSchema(idSchema('acctp')).optional(),
  'filter[status]': filterListSchema(accountStatusSchema).optional(),
  'filter[tag]': filterListSchema(tagInputSchema).optional(),
});
export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;

/** A relation type such as `spouse` or `business_owner`. */
export const RELATION_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const relationTypeSchema = z
  .string()
  .regex(RELATION_TYPE_PATTERN, 'must be a snake_case relation type');

export const accountRelationMetaSchema = z.strictObject({
  'related-account-id': idSchema('acc'),
  'relation-type': relationTypeSchema,
});

/**
 * `POST /api/v1/accounts/:id/add-relation`: a directed relation, unique per (from, to, type).
 * An account cannot relate to itself.
 */
export const addAccountRelationBodySchema = actionBodySchema(accountRelationMetaSchema);
/** `POST /api/v1/accounts/:id/remove-relation`. */
export const removeAccountRelationBodySchema = actionBodySchema(accountRelationMetaSchema);
export type AccountRelationBody = z.infer<typeof addAccountRelationBodySchema>;

export const ACCOUNT_RELATION_DIRECTIONS = ['outgoing', 'incoming'] as const;
export const accountRelationDirectionSchema = z.enum(ACCOUNT_RELATION_DIRECTIONS);
export type AccountRelationDirection = z.infer<typeof accountRelationDirectionSchema>;

/** One relation of `GET /api/v1/accounts/:id/relations`, seen from the requested account. */
export const accountRelationSchema = z.strictObject({
  direction: accountRelationDirectionSchema,
  'relation-type': relationTypeSchema,
  'related-account': accountIdentifierSchema,
  'created-at': timestampSchema,
});
export type AccountRelation = z.infer<typeof accountRelationSchema>;

/** `GET /api/v1/accounts/:id/relations`: every relation, in both directions. */
export const accountRelationListDocumentSchema = z.strictObject({
  data: z.array(accountRelationSchema),
});

export interface AccountRelationRecord {
  direction: AccountRelationDirection;
  relationType: string;
  relatedAccountId: string;
  createdAt: Date;
}

/**
 * Builds one relation of the relations listing.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildAccountRelation(record: AccountRelationRecord): AccountRelation {
  return accountRelationSchema.parse({
    direction: record.direction,
    'relation-type': record.relationType,
    'related-account': { type: 'account', id: record.relatedAccountId },
    'created-at': toTimestamp(record.createdAt),
  });
}

export const MAX_CONSOLIDATE_SOURCES = 10;

/**
 * `POST /api/v1/accounts/:id/consolidate`: in one transaction, moves the sources' inquiries
 * and relations to this account, unions the tags, merges the fields (this account wins) and
 * archives each source with `consolidated-into`.
 */
export const consolidateAccountsBodySchema = actionBodySchema(
  z.strictObject({
    'source-account-ids': z
      .array(idSchema('acc'))
      .min(1)
      .max(MAX_CONSOLIDATE_SOURCES)
      .refine(hasDistinctValues, 'must not contain duplicates'),
  }),
);
export type ConsolidateAccountsBody = z.infer<typeof consolidateAccountsBodySchema>;

export const MAX_ACCOUNT_OBJECTS = 100;

const accountObjectsMetaSchema = z.strictObject({
  objects: z
    .array(z.strictObject({ type: z.literal('inquiry'), id: idSchema('inq') }))
    .min(1)
    .max(MAX_ACCOUNT_OBJECTS)
    .refine(
      (objects) => hasDistinctValues(objects.map(({ id }) => id)),
      'must not contain duplicates',
    ),
});

/** `POST /api/v1/accounts/:id/add-objects`: links inquiries to this account. */
export const addAccountObjectsBodySchema = actionBodySchema(accountObjectsMetaSchema);
/** `POST /api/v1/accounts/:id/remove-objects`: unlinks inquiries from this account. */
export const removeAccountObjectsBodySchema = actionBodySchema(accountObjectsMetaSchema);
export type AccountObjectsBody = z.infer<typeof addAccountObjectsBodySchema>;

/** `POST /api/v1/accounts/:id/redact` (scope `accounts:redact`); also redacts its inquiries. */
export const redactAccountBodySchema = emptyActionBodySchema;

export interface AccountRecord {
  id: string;
  referenceId: string | null;
  status: AccountStatus;
  /** Values are null for a caller without `pii:view`. */
  fields: Record<string, InquiryFieldValue>;
  tags: readonly string[];
  consolidatedInto: string | null;
  accountTypeId: string;
  /** The latest 100, newest first. */
  inquiryIds: readonly string[];
  createdAt: Date;
  updatedAt: Date;
  redactedAt: Date | null;
}

/**
 * Builds the account resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildAccountResource(record: AccountRecord): AccountResource {
  return accountResourceSchema.parse({
    type: 'account',
    id: record.id,
    attributes: {
      'reference-id': record.referenceId,
      status: record.status,
      fields: record.fields,
      tags: [...record.tags],
      'consolidated-into': record.consolidatedInto,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
      'redacted-at': toNullableTimestamp(record.redactedAt),
    },
    relationships: {
      'account-type': { data: { type: 'account-type', id: record.accountTypeId } },
      inquiries: { data: record.inquiryIds.map((id) => ({ type: 'inquiry', id })) },
    },
  });
}

/**
 * C70.5 (Phase 6, F08): what `GET /api/v1/accounts/:id` can include: `reports`, the reports linked
 * to the account as home or through `report_accounts`, newest first, at most 50 (needs
 * `reports:read`), `list-matches` (C107.6), the matches of its inquiries (needs `lists:read`),
 * and `transactions` (C107.6), those related to it (needs `transactions:read`).
 * The route's `include` query is frozen in Workflow 6A Stage 1b.
 */
export const ACCOUNT_INCLUDES = ['reports', 'list-matches', 'transactions'] as const;
export const accountIncludeSchema = z.enum(ACCOUNT_INCLUDES);

/** `GET /api/v1/accounts/:id` query (C70.5). */
export const getAccountQuerySchema = z.strictObject({
  include: filterListSchema(accountIncludeSchema, ACCOUNT_INCLUDES.length).optional(),
});

/** `GET /api/v1/accounts/:id` with `?include=reports` (C70.5). */
export const accountIncludeDocumentSchema = z.strictObject({
  data: accountResourceSchema,
  included: z
    .array(
      z.discriminatedUnion('type', [
        ...REPORT_RESOURCE_SCHEMAS,
        listMatchResourceSchema,
        transactionResourceSchema,
      ]),
    )
    .optional(),
});
