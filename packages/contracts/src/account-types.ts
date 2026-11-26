/**
 * Account types (contract C13): a name, unique per environment, and the schema of the
 * account fields. Every environment is seeded with the type `user`.
 */
import { z } from 'zod';
import { contestRouteSchema, type ContestRoute } from './decisions.js';
import { INQUIRY_FIELD_NAME_PATTERN, type InquiryFieldValue } from './inquiries.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toTimestamp,
} from './json-api.js';
import { listQuerySchema } from './list-filters.js';

export const DEFAULT_ACCOUNT_TYPE_NAME = 'user';
export const MAX_ACCOUNT_TYPE_FIELDS = 100;

export const ACCOUNT_FIELD_TYPES = ['string', 'number', 'boolean', 'date'] as const;
export const accountFieldTypeSchema = z.enum(ACCOUNT_FIELD_TYPES);
export type AccountFieldType = z.infer<typeof accountFieldTypeSchema>;

export const accountFieldDefinitionSchema = z.strictObject({
  type: accountFieldTypeSchema,
  label: z.string().min(1).max(200),
});
export type AccountFieldDefinition = z.infer<typeof accountFieldDefinitionSchema>;

/** `fields-schema`: snake_case field key to its type and label, at most 100 keys. */
export const accountTypeFieldsSchema = z
  .record(
    z.string().regex(INQUIRY_FIELD_NAME_PATTERN, 'must be a snake_case field key'),
    accountFieldDefinitionSchema,
  )
  .refine((fields) => Object.keys(fields).length <= MAX_ACCOUNT_TYPE_FIELDS, {
    message: `at most ${String(MAX_ACCOUNT_TYPE_FIELDS)} fields are allowed`,
  });
export type AccountTypeFields = z.infer<typeof accountTypeFieldsSchema>;

export const accountTypeNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^\P{Cc}+$/u, 'must not contain control characters');

export const accountTypeAttributesSchema = z.strictObject({
  name: accountTypeNameSchema,
  'fields-schema': accountTypeFieldsSchema,
  'created-at': timestampSchema,
  /** Ours (C128.3): how a person contests an adverse step on this type's accounts. */
  'contest-route': contestRouteSchema.nullable(),
});

export const accountTypeResourceSchema = resourceSchema(
  'account-type',
  'acctp',
  accountTypeAttributesSchema,
);
export type AccountTypeResource = z.infer<typeof accountTypeResourceSchema>;

export const accountTypeDocumentSchema = singleDocumentSchema(accountTypeResourceSchema);
export const accountTypeListDocumentSchema = listDocumentSchema(accountTypeResourceSchema);

/** `POST /api/v1/account-types` (scope `accounts:write`). */
export const createAccountTypeBodySchema = requestDocumentSchema(
  'account-type',
  z.strictObject({
    name: accountTypeNameSchema,
    'fields-schema': accountTypeFieldsSchema.optional(),
    'contest-route': contestRouteSchema.nullable().optional(),
  }),
);
export type CreateAccountTypeBody = z.infer<typeof createAccountTypeBodySchema>;

/**
 * `PATCH /api/v1/account-types/:id` (scope `accounts:write`, C25.3 Workflow 2E). `fields-schema`
 * is the whole new schema, and the change must be additive: keys may be added and labels
 * changed, but a key may not be removed or change its type ({@link accountTypeFieldsChangeIssues}),
 * because accounts may hold values for it.
 */
export const updateAccountTypeBodySchema = requestDocumentSchema(
  'account-type',
  z
    .strictObject({
      name: accountTypeNameSchema.optional(),
      'fields-schema': accountTypeFieldsSchema.optional(),
      'contest-route': contestRouteSchema.nullable().optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateAccountTypeBody = z.infer<typeof updateAccountTypeBodySchema>;

/** One way a fields-schema change breaks the C25.3 additive rule. */
export interface AccountTypeFieldsChangeIssue {
  /** The field key, as in the schema. */
  field: string;
  message: string;
}

/**
 * What makes `next` more than an additive change of `previous` (C25.3): every key of `previous`
 * that `next` removes or gives another type, in `previous`'s key order. Adding keys and changing
 * labels are allowed. Keys are own properties only, so `constructor` is an ordinary key.
 */
export function accountTypeFieldsChangeIssues(
  previous: Readonly<Record<string, AccountFieldDefinition>>,
  next: Readonly<Record<string, AccountFieldDefinition>>,
): AccountTypeFieldsChangeIssue[] {
  const issues: AccountTypeFieldsChangeIssue[] = [];
  for (const [field, definition] of Object.entries(previous)) {
    const changed = Object.hasOwn(next, field) ? next[field] : undefined;
    if (changed === undefined) {
      issues.push({ field, message: 'cannot be removed: accounts may hold values for it' });
    } else if (changed.type !== definition.type) {
      issues.push({
        field,
        message: `cannot change type from ${definition.type} to ${changed.type}`,
      });
    }
  }
  return issues;
}

/** `GET /api/v1/account-types` query. */
export const listAccountTypesQuerySchema = listQuerySchema('acctp', {});

export interface AccountTypeRecord {
  id: string;
  name: string;
  fieldsSchema: Readonly<Record<string, AccountFieldDefinition>>;
  /** C128.3: left out, no route. */
  contestRoute?: ContestRoute | null;
  createdAt: Date;
}

/**
 * Builds the account-type resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildAccountTypeResource(record: AccountTypeRecord): AccountTypeResource {
  return accountTypeResourceSchema.parse({
    type: 'account-type',
    id: record.id,
    attributes: {
      name: record.name,
      'fields-schema': record.fieldsSchema,
      'created-at': toTimestamp(record.createdAt),
      'contest-route': record.contestRoute ?? null,
    },
  });
}

export interface AccountFieldIssue {
  field: string;
  message: string;
}

const isoDateSchema = z.iso.date();

function fieldTypeIssue(type: AccountFieldType, value: InquiryFieldValue): string | null {
  switch (type) {
    case 'string':
      return typeof value === 'string' ? null : 'must be a string';
    case 'number':
      return typeof value === 'number' ? null : 'must be a number';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be a boolean';
    case 'date':
      return isoDateSchema.safeParse(value).success
        ? null
        : 'must be an ISO 8601 date (YYYY-MM-DD)';
  }
}

/**
 * Checks account fields against the type's `fields-schema` (C13): unknown keys and values of
 * the wrong type are issues, which the API answers with 422. `null` clears any field.
 */
export function accountFieldIssues(
  fields: Readonly<Record<string, InquiryFieldValue>>,
  fieldsSchema: Readonly<Record<string, AccountFieldDefinition>>,
): AccountFieldIssue[] {
  const issues: AccountFieldIssue[] = [];
  for (const [field, value] of Object.entries(fields)) {
    const definition = Object.hasOwn(fieldsSchema, field) ? fieldsSchema[field] : undefined;
    if (definition === undefined) {
      issues.push({ field, message: 'is not a field of this account type' });
      continue;
    }
    const message = value === null ? null : fieldTypeIssue(definition.type, value);
    if (message !== null) {
      issues.push({ field, message });
    }
  }
  return issues;
}
