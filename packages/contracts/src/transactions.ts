/**
 * Transactions (plan C104, C105): transaction types with immutable versions, transactions with
 * their fields, labels, relations and objects. The fifteen field-schema types, their caps and the
 * union live in `@openverify/core` (`packages/core/src/transactions/`), because the pure engine
 * reads them; contracts re-exports them.
 *
 * `fields` is PII, masked member-wise without `pii:view`, as an inquiry's `fields` is. A file field
 * carries its `txnf_` id, `filename` (sealed at rest), `byte-size` and `mime-type`, and never a URL:
 * content is read through the audited content route (P12). `reference-id` is not PII, as on
 * accounts. Labels and statuses are not PII, and the docs say not to put personal data in them.
 * An event of a transaction carries no field values (C107.5).
 *
 * Routes (frozen by `foundation-7b`, built by `api-transactions`): C104.1 and C105.2. Scopes
 * `transactions:read`, `transactions:write`, `transactions:redact` and `transaction-types:write`.
 */
import {
  FIELD_KEY_PATTERN,
  TRANSACTION_LIMITS,
  TRANSACTION_STATUS_PATTERN,
  fieldSchemaSchema,
  fieldSchemaTypeSchema,
  relationSchemaSchema,
  transactionTypeStatusSchema,
  transactionTypeVersionStatusSchema,
  type FieldSchema,
  DEFAULT_TRANSACTION_ADVERSE_STATUSES,
  type RelationSchema,
  type TransactionTypeStatus,
  type TransactionTypeVersionStatus,
} from '@openverify/core';
import { z } from 'zod';
import { auditActorTypeSchema } from './user-audit-logs.js';
import { emptyActionBodySchema } from './actions.js';
import { contestRouteSchema, type ContestRoute } from './decisions.js';
import { idSchema } from './ids.js';
import {
  accountIdentifierSchema,
  inquiryIdentifierSchema,
  referenceIdSchema,
  reportIdentifierSchema,
  transactionIdentifierSchema,
  verificationIdentifierSchema,
} from './identifiers.js';
import {
  hasDistinctValues,
  listDocumentSchema,
  pageSizeSchema,
  requestDocumentSchema,
  resourceIdentifierSchema,
  resourceSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import {
  filterListSchema,
  listQuerySchema,
  listQueryWithDynamicFiltersSchema,
} from './list-filters.js';
import { tagInputSchema, tagsSchema } from './tags.js';

export {
  DEFAULT_TRANSACTION_STATUSES,
  FIELD_KEY_PATTERN,
  FIELD_REDACTION_POLICIES,
  FIELD_SANITIZERS,
  FIELD_SCHEMA_TYPES,
  FIELD_TYPES_NEVER_REFUSED,
  FIELD_WRITE_POLICIES,
  JSON_SCHEMA_ALLOWED_KEYWORDS,
  RELATION_SCHEMA_CARDINALITIES,
  RELATION_SCHEMA_OBJECTS,
  RELATION_SCHEMA_TARGETS,
  RELATION_TARGETS_UNSUPPORTED,
  RELATION_TARGET_VERIFICATION_TYPES,
  TRANSACTION_LIMITS,
  TRANSACTION_RESERVED_STATUS,
  TRANSACTION_STATUS_PATTERN,
  TRANSACTION_TYPE_STATUSES,
  TRANSACTION_TYPE_VERSION_STATUSES,
  fieldSchemaSchema,
  fieldSchemaTypeSchema,
  relationSchemaSchema,
  type FieldSchema,
  type FieldSchemaType,
  type RelationSchema,
} from '@openverify/core';

/** Marks a member PII (C105.8): nullable, so a masked or redacted copy still parses. */
function pii<Schema extends z.ZodType>(schema: Schema) {
  return schema.nullable().meta({ pii: true });
}

const nameSchema = z.string().min(1).max(255);

/** C104.5: one status of a type. */
export const transactionStatusSchema = z
  .string()
  .min(1)
  .max(TRANSACTION_LIMITS.statusLength)
  .regex(TRANSACTION_STATUS_PATTERN, 'must be lower case letters, digits, spaces, _ or -');

const fieldSchemasSchema = z.array(fieldSchemaSchema).max(TRANSACTION_LIMITS.fieldsPerVersion);
const statusesSchema = z
  .array(transactionStatusSchema)
  .min(1)
  .max(TRANSACTION_LIMITS.statuses)
  .refine(hasDistinctValues, 'must not contain duplicates');
const relationSchemasSchema = z.array(relationSchemaSchema).max(TRANSACTION_LIMITS.relationSchemas);
const adverseStatusesSchema = z
  .array(transactionStatusSchema)
  .max(TRANSACTION_LIMITS.statuses)
  .refine(hasDistinctValues, 'must not contain duplicates');

// ---------------------------------------------------------------------------------------------
// Types and versions (C104.1)

/** C104.1: public attributes, then ours; the `field-schemas` are the published version's. */
export const transactionTypeAttributesSchema = z.strictObject({
  name: nameSchema,
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
  'field-schemas': fieldSchemasSchema,
  status: transactionTypeStatusSchema,
  statuses: z.array(transactionStatusSchema),
  'relation-schemas': relationSchemasSchema,
  'latest-version': z.int().min(1),
  /** `null` until a version is published. */
  'published-version': z.int().min(1).nullable(),
  /** Ours (C122.1): a run moving a transaction to one of these is an adverse step (C128). */
  'adverse-statuses': z.array(transactionStatusSchema),
  /** Ours (C128.3): how a person contests an adverse step on this type's transactions. */
  'contest-route': contestRouteSchema.nullable(),
});

const typeVersionIdentifier = z.strictObject({
  type: z.literal('transaction-type-version'),
  id: idSchema('txntpv'),
});

/**
 * Owner decision 7 after Workflow 7B: a type names its latest version and its published one, so a
 * first draft's id is readable without audit metadata. Optional so earlier answers still parse;
 * servers send both.
 */
export const transactionTypeRelationshipsSchema = z.strictObject({
  'latest-version': z.strictObject({ data: typeVersionIdentifier }),
  'published-version': z.strictObject({ data: typeVersionIdentifier.nullable() }),
});

export const transactionTypeResourceSchema = resourceWithRelationshipsSchema(
  'transaction-type',
  'txntp',
  transactionTypeAttributesSchema,
  transactionTypeRelationshipsSchema.optional(),
);
export type TransactionTypeResource = z.infer<typeof transactionTypeResourceSchema>;
export const transactionTypeDocumentSchema = singleDocumentSchema(transactionTypeResourceSchema);
export type TransactionTypeDocument = z.infer<typeof transactionTypeDocumentSchema>;
export const transactionTypeListDocumentSchema = listDocumentSchema(transactionTypeResourceSchema);

export const listTransactionTypesQuerySchema = listQuerySchema('txntp', {
  'filter[status]': filterListSchema(transactionTypeStatusSchema).optional(),
});

/** `POST /api/v1/transaction-types` (`transaction-types:write`): a draft version comes with it. */
export const createTransactionTypeBodySchema = requestDocumentSchema(
  'transaction-type',
  z.strictObject({
    name: nameSchema,
    'field-schemas': fieldSchemasSchema.optional(),
    statuses: statusesSchema.optional(),
    'relation-schemas': relationSchemasSchema.optional(),
    'allow-card-like-strings': z.boolean().optional(),
    /** C122.1: `declined` by default. The service holds each to a status of the type. */
    'adverse-statuses': adverseStatusesSchema.optional(),
    'contest-route': contestRouteSchema.nullable().optional(),
  }),
);
export type CreateTransactionTypeBody = z.infer<typeof createTransactionTypeBodySchema>;

/**
 * `PATCH /api/v1/transaction-types/:id`: the name, and the two members that are the type's rather
 * than a version's (C122.1, C128.3); everything else is a version's.
 */
export const updateTransactionTypeBodySchema = requestDocumentSchema(
  'transaction-type',
  z
    .strictObject({
      name: nameSchema.optional(),
      'adverse-statuses': adverseStatusesSchema.optional(),
      'contest-route': contestRouteSchema.nullable().optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateTransactionTypeBody = z.infer<typeof updateTransactionTypeBodySchema>;

export const transactionTypeVersionRelationshipsSchema = z.strictObject({
  'transaction-type': z.strictObject({
    data: z.strictObject({ type: z.literal('transaction-type'), id: idSchema('txntp') }),
  }),
});

/** C104.1, as C71: a draft is edited, then published; published versions never change. */
export const transactionTypeVersionAttributesSchema = z
  .strictObject({
    'version-number': z.int().min(1),
    status: transactionTypeVersionStatusSchema,
    'field-schemas': fieldSchemasSchema,
    statuses: statusesSchema,
    'relation-schemas': relationSchemasSchema,
    /** C104.4: lifts the card-number guard for this version's fields only. */
    'allow-card-like-strings': z.boolean(),
    'created-at': timestampSchema,
    'published-at': timestampSchema.nullable(),
  })
  .refine(
    (attributes) => (attributes.status === 'draft') === (attributes['published-at'] === null),
    { message: 'a version is published exactly when it is no longer a draft', path: ['status'] },
  );

export const transactionTypeVersionResourceSchema = resourceWithRelationshipsSchema(
  'transaction-type-version',
  'txntpv',
  transactionTypeVersionAttributesSchema,
  transactionTypeVersionRelationshipsSchema,
);
export type TransactionTypeVersionResource = z.infer<typeof transactionTypeVersionResourceSchema>;
export const transactionTypeVersionDocumentSchema = singleDocumentSchema(
  transactionTypeVersionResourceSchema,
);
export type TransactionTypeVersionDocument = z.infer<typeof transactionTypeVersionDocumentSchema>;
export const transactionTypeVersionListDocumentSchema = listDocumentSchema(
  transactionTypeVersionResourceSchema,
);
export type TransactionTypeVersionListDocument = z.infer<
  typeof transactionTypeVersionListDocumentSchema
>;

/** Owner decision 7 after Workflow 7B: `GET /api/v1/transaction-type-versions`, newest first. */
export const listTransactionTypeVersionsQuerySchema = listQuerySchema('txntpv', {
  'filter[transaction-type-id]': filterListSchema(idSchema('txntp')).optional(),
});
export type ListTransactionTypeVersionsQuery = z.infer<
  typeof listTransactionTypeVersionsQuerySchema
>;

const VERSION_CONTENT = {
  'field-schemas': fieldSchemasSchema.optional(),
  statuses: statusesSchema.optional(),
  'relation-schemas': relationSchemasSchema.optional(),
  'allow-card-like-strings': z.boolean().optional(),
};

/** `POST /api/v1/transaction-type-versions`: a draft from the latest version; members replace. */
export const createTransactionTypeVersionBodySchema = requestDocumentSchema(
  'transaction-type-version',
  z.strictObject({ 'transaction-type-id': idSchema('txntp'), ...VERSION_CONTENT }),
);
export type CreateTransactionTypeVersionBody = z.infer<
  typeof createTransactionTypeVersionBodySchema
>;

/** `PATCH /api/v1/transaction-type-versions/:id` (drafts only). */
export const updateTransactionTypeVersionBodySchema = requestDocumentSchema(
  'transaction-type-version',
  z
    .strictObject(VERSION_CONTENT)
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateTransactionTypeVersionBody = z.infer<
  typeof updateTransactionTypeVersionBodySchema
>;

/** `POST /api/v1/transaction-type-versions/:id/publish` takes no parameters. */
export const publishTransactionTypeVersionBodySchema = emptyActionBodySchema;

// ---------------------------------------------------------------------------------------------
// Transactions (C105.1)

/** C105.1: a file field's value: never a URL, and `filename` is PII inside the masked `fields`. */
export const transactionFileValueSchema = z.strictObject({
  'file-id': idSchema('txnf'),
  filename: z.string().min(1).max(255),
  'byte-size': z.int().min(0),
  'mime-type': z.string().min(3).max(255),
});
export type TransactionFileValue = z.infer<typeof transactionFileValueSchema>;

/** C105.1: one field as served: its type and value; `value` is `null` when masked. */
export const transactionFieldValueSchema = z.strictObject({
  type: fieldSchemaTypeSchema,
  value: z.unknown(),
});
export type TransactionFieldValue = z.infer<typeof transactionFieldValueSchema>;

export const transactionFieldKeySchema = z
  .string()
  .min(1)
  .max(TRANSACTION_LIMITS.fieldKeyLength)
  .regex(FIELD_KEY_PATTERN);

/** The `type` of a related object (C105.1, C105.2). */
export const transactionRelatedObjectSchema = z.union([
  accountIdentifierSchema,
  inquiryIdentifierSchema,
  reportIdentifierSchema,
  verificationIdentifierSchema,
]);

/** C127.7: a user, an API key or a run, never the system. */
export const transactionReviewerIdentifierSchema = z.union([
  resourceIdentifierSchema('user', 'usr'),
  resourceIdentifierSchema('api-key', 'key'),
  resourceIdentifierSchema('workflow-run', 'wfr'),
]);
export type TransactionReviewerIdentifier = z.infer<typeof transactionReviewerIdentifierSchema>;

/** The latest label of a transaction (C105.2). */
export const transactionLabelIdentifierSchema = z.strictObject({
  type: z.literal('transaction-label'),
  id: idSchema('txnl'),
});

export const transactionRelationshipsSchema = z.strictObject({
  'transaction-type': z.strictObject({
    data: z.strictObject({ type: z.literal('transaction-type'), id: idSchema('txntp') }),
  }),
  'transaction-label': z.strictObject({ data: transactionLabelIdentifierSchema.nullable() }),
  /** C127.7 (V27): who last moved the status; `null` until someone does. */
  reviewer: z.strictObject({ data: transactionReviewerIdentifierSchema.nullable() }),
  'related-objects': z.strictObject({
    data: z.array(transactionRelatedObjectSchema).max(TRANSACTION_LIMITS.relatedObjects),
  }),
  /** Always empty: passive collection is deferred (C110). */
  'sentinel-sessions': z.strictObject({ data: z.array(z.never()).max(0) }),
});

export const transactionAttributesSchema = z.strictObject({
  status: transactionStatusSchema,
  /** The customer's reference for the account: not unique, not PII. */
  'reference-id': referenceIdSchema.nullable(),
  /** Member-wise masked; `null` once redacted, and in every event's payload (C107.5). */
  fields: pii(z.record(transactionFieldKeySchema, transactionFieldValueSchema)),
  tags: tagsSchema,
  /** Always `null` in Phase 7: passive collection is deferred (C110). */
  signals: z.null(),
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
  'transaction-type-version-id': idSchema('txntpv'),
  'redacted-at': timestampSchema.nullable(),
  'biometrics-redacted-at': timestampSchema.nullable(),
});

export const transactionResourceSchema = resourceWithRelationshipsSchema(
  'transaction',
  'txn',
  transactionAttributesSchema,
  transactionRelationshipsSchema,
);
export type TransactionResource = z.infer<typeof transactionResourceSchema>;
export const transactionDocumentSchema = singleDocumentSchema(transactionResourceSchema);
export type TransactionDocument = z.infer<typeof transactionDocumentSchema>;
export const transactionListDocumentSchema = listDocumentSchema(transactionResourceSchema);

const labelInline = z.string().min(1).max(TRANSACTION_LIMITS.labelLength);

/** C105.2: `transaction-label` (`txnl_`), append-only. */
export const transactionLabelResourceSchema = resourceSchema(
  'transaction-label',
  'txnl',
  z.strictObject({
    'model-label': labelInline,
    'model-version': z.string().min(1).max(TRANSACTION_LIMITS.modelVersionLength).nullable(),
    /** Ours. */
    score: z.number().nullable(),
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
  }),
);
export type TransactionLabelResource = z.infer<typeof transactionLabelResourceSchema>;
export const transactionLabelDocumentSchema = singleDocumentSchema(transactionLabelResourceSchema);
export type TransactionLabelDocument = z.infer<typeof transactionLabelDocumentSchema>;

export const transactionLabelListDocumentSchema = listDocumentSchema(
  transactionLabelResourceSchema,
);
export type TransactionLabelListDocument = z.infer<typeof transactionLabelListDocumentSchema>;

/** Owner decision 8 after Workflow 7B: `GET /api/v1/transactions/:id/labels`, newest first. */
export const listTransactionLabelsQuerySchema = listQuerySchema('txnl', {}, { createdAt: false });

/** The number of a row of the append-only history: `id` of a status change, and its cursor. */
export const transactionStatusChangeIdSchema = z.string().regex(/^[1-9][0-9]{0,18}$/);

/**
 * Owner decision 8 after Workflow 7B: one row of a transaction's append-only status history (ours).
 * A status is free text under an operator's control, so `from-status` and `to-status` are `null`
 * once redacted; who moved it and when stay. A resource of its own rather than a member, because
 * the history is unbounded.
 */
export const transactionStatusChangeResourceSchema = z.strictObject({
  type: z.literal('transaction-status-change'),
  id: transactionStatusChangeIdSchema,
  attributes: z.strictObject({
    'from-status': transactionStatusSchema.nullable(),
    'to-status': transactionStatusSchema.nullable(),
    'actor-type': auditActorTypeSchema,
    'created-at': timestampSchema,
    'redacted-at': timestampSchema.nullable(),
  }),
});
export type TransactionStatusChangeResource = z.infer<typeof transactionStatusChangeResourceSchema>;
export const transactionStatusChangeListDocumentSchema = listDocumentSchema(
  transactionStatusChangeResourceSchema,
);
export type TransactionStatusChangeListDocument = z.infer<
  typeof transactionStatusChangeListDocumentSchema
>;

/** `GET /api/v1/transactions/:id/status-changes`: newest first. */
export const listTransactionStatusChangesQuerySchema = z.strictObject({
  'page[after]': transactionStatusChangeIdSchema.optional(),
  'page[size]': pageSizeSchema.optional(),
});
export type ListTransactionStatusChangesQuery = z.infer<
  typeof listTransactionStatusChangesQuerySchema
>;

const ULID = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
const RELATION_KEY = `[a-z0-9][a-z0-9_-]{0,${String(TRANSACTION_LIMITS.fieldKeyLength - 1)}}`;
const RELATION_TARGET = `(?:acc|txn)_${ULID}`;

/** K7C-2: `<transaction>:<key>:<target>`, the row's own key: the table has no public id. */
export const transactionRelationIdSchema = z
  .string()
  .regex(new RegExp(`^txn_${ULID}:${RELATION_KEY}:${RELATION_TARGET}$`));

const relationInstantSchema = z.iso.datetime({ precision: 6 });

/**
 * K7C-2: `page[after]` of a transaction's relations, `<created-at>~<key>~<target>`, the list's sort
 * position. Taken from `links.next`, never built. It is a position and not a row's id because a
 * relation can be removed: the row it came from may be gone by the next page.
 */
export const transactionRelationCursorSchema = z
  .string()
  .regex(new RegExp(`^[1-9][0-9]{3}-[^~]{22}~${RELATION_KEY}~${RELATION_TARGET}$`))
  .refine(
    (cursor) => relationInstantSchema.safeParse(cursor.slice(0, cursor.indexOf('~'))).success,
    'must be a position from links.next',
  );

/**
 * K7C-2 (C105.2, C108): one relation of a transaction (ours), with its target by a resource
 * identifier: ids only, never a target's attributes. A resource of its own rather than a member,
 * because a `many` relation has no cap. A redaction leaves these rows (C105.5).
 */
export const transactionRelationResourceSchema = z.strictObject({
  type: z.literal('transaction-relation'),
  id: transactionRelationIdSchema,
  attributes: z.strictObject({
    'relation-schema-key': transactionFieldKeySchema,
    target: z.union([accountIdentifierSchema, transactionIdentifierSchema]),
    'created-at': timestampSchema,
  }),
});
export type TransactionRelationResource = z.infer<typeof transactionRelationResourceSchema>;
export const transactionRelationListDocumentSchema = listDocumentSchema(
  transactionRelationResourceSchema,
);
export type TransactionRelationListDocument = z.infer<typeof transactionRelationListDocumentSchema>;

/** `GET /api/v1/transactions/:id/relations`: newest first. */
export const listTransactionRelationsQuerySchema = z.strictObject({
  'page[after]': transactionRelationCursorSchema.optional(),
  'page[size]': pageSizeSchema.optional(),
});
export type ListTransactionRelationsQuery = z.infer<typeof listTransactionRelationsQuerySchema>;

/** C105.2: what `GET /api/v1/transactions/:id` can include. */
export const TRANSACTION_INCLUDES = ['transaction-type', 'transaction-label'] as const;

/** `GET /api/v1/transactions/:id`: `included` is there when `include` asked for it. */
export const transactionIncludeDocumentSchema = z.strictObject({
  data: transactionResourceSchema,
  included: z
    .array(z.union([transactionTypeResourceSchema, transactionLabelResourceSchema]))
    .optional(),
});
export type TransactionIncludeDocument = z.infer<typeof transactionIncludeDocumentSchema>;

export const getTransactionQuerySchema = z.strictObject({
  include: filterListSchema(z.enum(TRANSACTION_INCLUDES), TRANSACTION_INCLUDES.length).optional(),
});

/**
 * `GET /api/v1/transactions`: newest first. `filter[identifier][value]` is PII: the stored API-log
 * query masks it, and the request log never carries a query (C93.7, P06).
 */
/**
 * C165.3 (Workflow 9B): `filter[fields.<key>]` on a field the transaction type version marks
 * `filterable` (equality; a choices, boolean, number or date field through a plaintext projection,
 * a searchable string through the HMAC index, which needs PII visibility), at most ten at once.
 */
export const TRANSACTION_FIELD_FILTER_PATTERN = /^filter\[fields\.([a-z0-9][a-z0-9_-]{0,63})\]$/;
export const MAX_TRANSACTION_FIELD_FILTERS = 10;

export const listTransactionsQuerySchema = listQueryWithDynamicFiltersSchema(
  'txn',
  {
    'filter[reference-id]': referenceIdSchema.optional(),
    'filter[transaction-type-id]': filterListSchema(idSchema('txntp')).optional(),
    'filter[identifier][key]': transactionFieldKeySchema.optional(),
    'filter[identifier][value]': z.string().min(1).max(1024).optional(),
    'filter[status]': filterListSchema(transactionStatusSchema).optional(),
  },
  {
    pattern: TRANSACTION_FIELD_FILTER_PATTERN,
    value: z.string().min(1).max(1024),
    max: MAX_TRANSACTION_FIELD_FILTERS,
    name: 'field',
  },
).refine(
  (query) =>
    (query['filter[identifier][key]'] === undefined) ===
    (query['filter[identifier][value]'] === undefined),
  { message: 'filter[identifier] takes a key and a value', path: ['filter[identifier][key]'] },
);

const fieldsBody = z.record(transactionFieldKeySchema, z.unknown()).optional().meta({ pii: true });

/** `POST /api/v1/transactions` (`transactions:write`). A file's content goes through its PUT. */
export const createTransactionBodySchema = requestDocumentSchema(
  'transaction',
  z.strictObject({
    'transaction-type-id': idSchema('txntp'),
    fields: fieldsBody,
    'reference-id': referenceIdSchema.optional(),
    tags: z.array(tagInputSchema).optional(),
  }),
);
export type CreateTransactionBody = z.infer<typeof createTransactionBodySchema>;

/** `PATCH /api/v1/transactions/:id`; a second write of a `write_once` field answers 409. */
export const updateTransactionBodySchema = requestDocumentSchema(
  'transaction',
  z
    .strictObject({
      fields: fieldsBody,
      status: transactionStatusSchema.optional(),
      'reference-id': referenceIdSchema.nullable().optional(),
      label: labelInline.optional(),
      tags: z.array(tagInputSchema).optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateTransactionBody = z.infer<typeof updateTransactionBodySchema>;

/** `DELETE /api/v1/transactions/:id` (`transactions:redact`): `include-never` overrides (P21). */
export const redactTransactionBodySchema = z.strictObject({
  meta: z.strictObject({ 'include-never': z.boolean().optional() }).optional(),
});
export type RedactTransactionBody = z.infer<typeof redactTransactionBodySchema>;

/** `POST /:id/redact-biometrics` (`transactions:redact` and `inquiries:redact`), `x-private`. */
export const redactTransactionBiometricsBodySchema = emptyActionBodySchema;

/** `POST /:id/add-objects` and `/remove-objects`: inquiries, reports and verifications. */
export const transactionObjectsBodySchema = z.strictObject({
  meta: z.strictObject({
    'object-ids': z
      .array(z.string().regex(/^(?:inq|rep|ver)_[0-9A-HJKMNP-TV-Z]{26}$/, 'must be an object id'))
      .min(1)
      .max(TRANSACTION_LIMITS.objectIds)
      .refine(hasDistinctValues, 'must not contain duplicates'),
  }),
});
export type TransactionObjectsBody = z.infer<typeof transactionObjectsBodySchema>;

/** `POST /:id/add-relation` and `/remove-relation`: idempotent. */
export const transactionRelationBodySchema = z.strictObject({
  meta: z.strictObject({
    'relation-schema-key': transactionFieldKeySchema,
    'target-object-id': z
      .string()
      .regex(/^(?:acc|txn)_[0-9A-HJKMNP-TV-Z]{26}$/, 'must be an account or a transaction id'),
  }),
});
export type TransactionRelationBody = z.infer<typeof transactionRelationBodySchema>;

/** `POST /:id/label`: labels are append-only history. */
export const labelTransactionBodySchema = z.strictObject({
  meta: z.strictObject({
    label: labelInline,
    score: z.number().refine(Number.isFinite, 'must be finite').optional(),
    'model-version': z.string().min(1).max(TRANSACTION_LIMITS.modelVersionLength).optional(),
  }),
});
export type LabelTransactionBody = z.infer<typeof labelTransactionBodySchema>;

/** C105.3: `payload.meta` of a relation event: the names of the newer changelog. */
export const transactionRelationMetaSchema = z.strictObject({
  context: z.union([
    z.strictObject({
      'relation-schema-key': transactionFieldKeySchema,
      'related-account-id': idSchema('acc'),
    }),
    z.strictObject({
      'relation-schema-key': transactionFieldKeySchema,
      'related-txn-id': idSchema('txn'),
    }),
  ]),
});

/**
 * C104.6 (owner decision 2 after Workflow 7B): where a field sits in a version: its key, or a dotted
 * path through `hash` members, in `source-key-path`'s form: at most the nesting levels + 1 segments.
 * An `array`'s item schema adds no segment.
 */
export const transactionFieldPathSchema = z
  .string()
  .min(1)
  .refine((path) => {
    const segments = path.split('.');
    return (
      segments.length <= TRANSACTION_LIMITS.nestingLevels + 1 &&
      segments.every((segment) => transactionFieldKeySchema.safeParse(segment).success)
    );
  }, 'must be a field key, or a dotted path of them');

/** C104.6: `payload.meta` of `transaction-type.deleted-field`. */
export const transactionTypeDeletedFieldMetaSchema = z.strictObject({
  'field-key': transactionFieldPathSchema,
  'version-number': z.int().min(1),
});

/** C104.6: `payload.meta` of `transaction-type.converted-field`. */
export const transactionTypeConvertedFieldMetaSchema = z.strictObject({
  'field-key': transactionFieldPathSchema,
  'version-number': z.int().min(1),
  from: fieldSchemaTypeSchema,
  to: fieldSchemaTypeSchema,
});

// ---------------------------------------------------------------------------------------------
// PII (C105.8, C107.5)

/**
 * C107.5: the PII names of the transaction resources, bodies and query, joined to the masking lists
 * and the API-log set by `foundation-7b`. The file part of the PUT route is never stored.
 */
export const PII_TRANSACTION_ATTRIBUTES: readonly string[] = Object.freeze([
  'fields',
  'content',
  'filter[identifier][value]',
]);

// ---------------------------------------------------------------------------------------------
// Builders

export interface TransactionTypeRecord {
  id: string;
  name: string;
  status: TransactionTypeStatus;
  fieldSchemas: readonly FieldSchema[];
  statuses: readonly string[];
  relationSchemas: readonly RelationSchema[];
  latestVersion: number;
  publishedVersion: number | null;
  /** Owner decision 7 after 7B. Left out, the relationships are not sent. */
  latestVersionId?: string;
  publishedVersionId?: string | null;
  /** C122.1, C128.3: left out, `declined` and no route. */
  adverseStatuses?: readonly string[];
  contestRoute?: ContestRoute | null;
  createdAt: Date;
  updatedAt: Date;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildTransactionTypeResource(
  record: TransactionTypeRecord,
): TransactionTypeResource {
  return transactionTypeResourceSchema.parse({
    type: 'transaction-type',
    id: record.id,
    attributes: {
      name: record.name,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
      'field-schemas': record.fieldSchemas,
      status: record.status,
      statuses: record.statuses,
      'relation-schemas': record.relationSchemas,
      'latest-version': record.latestVersion,
      'published-version': record.publishedVersion,
      'adverse-statuses': record.adverseStatuses ?? DEFAULT_TRANSACTION_ADVERSE_STATUSES,
      'contest-route': record.contestRoute ?? null,
    },
    ...(record.latestVersionId === undefined
      ? {}
      : {
          relationships: {
            'latest-version': {
              data: { type: 'transaction-type-version', id: record.latestVersionId },
            },
            'published-version': {
              data:
                (record.publishedVersionId ?? null) === null
                  ? null
                  : { type: 'transaction-type-version', id: record.publishedVersionId },
            },
          },
        }),
  });
}

export interface TransactionTypeVersionRecord {
  id: string;
  transactionTypeId: string;
  versionNumber: number;
  status: TransactionTypeVersionStatus;
  fieldSchemas: readonly FieldSchema[];
  statuses: readonly string[];
  relationSchemas: readonly RelationSchema[];
  allowCardLikeStrings: boolean;
  createdAt: Date;
  publishedAt: Date | null;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildTransactionTypeVersionResource(
  record: TransactionTypeVersionRecord,
): TransactionTypeVersionResource {
  return transactionTypeVersionResourceSchema.parse({
    type: 'transaction-type-version',
    id: record.id,
    attributes: {
      'version-number': record.versionNumber,
      status: record.status,
      'field-schemas': record.fieldSchemas,
      statuses: record.statuses,
      'relation-schemas': record.relationSchemas,
      'allow-card-like-strings': record.allowCardLikeStrings,
      'created-at': toTimestamp(record.createdAt),
      'published-at': toNullableTimestamp(record.publishedAt),
    },
    relationships: {
      'transaction-type': { data: { type: 'transaction-type', id: record.transactionTypeId } },
    },
  });
}

export interface TransactionRecord {
  id: string;
  status: string;
  referenceId: string | null;
  /** As the principal may see them; `null` when redacted, and in an event's payload. */
  fields: Readonly<Record<string, TransactionFieldValue>> | null;
  tags: readonly string[];
  transactionTypeId: string;
  transactionTypeVersionId: string;
  latestLabelId: string | null;
  relatedObjects: readonly z.infer<typeof transactionRelatedObjectSchema>[];
  /** C127.7: left out, `null`. */
  reviewer?: TransactionReviewerIdentifier | null;
  createdAt: Date;
  updatedAt: Date;
  redactedAt: Date | null;
  biometricsRedactedAt: Date | null;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildTransactionResource(record: TransactionRecord): TransactionResource {
  return transactionResourceSchema.parse({
    type: 'transaction',
    id: record.id,
    attributes: {
      status: record.status,
      'reference-id': record.referenceId,
      fields: record.fields,
      tags: record.tags,
      signals: null,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
      'transaction-type-version-id': record.transactionTypeVersionId,
      'redacted-at': toNullableTimestamp(record.redactedAt),
      'biometrics-redacted-at': toNullableTimestamp(record.biometricsRedactedAt),
    },
    relationships: {
      'transaction-type': { data: { type: 'transaction-type', id: record.transactionTypeId } },
      'transaction-label': {
        data:
          record.latestLabelId === null
            ? null
            : { type: 'transaction-label', id: record.latestLabelId },
      },
      reviewer: { data: record.reviewer ?? null },
      'related-objects': { data: record.relatedObjects },
      'sentinel-sessions': { data: [] },
    },
  });
}

export interface TransactionLabelRecord {
  id: string;
  label: string;
  modelVersion: string | null;
  score: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildTransactionLabelResource(
  record: TransactionLabelRecord,
): TransactionLabelResource {
  return transactionLabelResourceSchema.parse({
    type: 'transaction-label',
    id: record.id,
    attributes: {
      'model-label': record.label,
      'model-version': record.modelVersion,
      score: record.score,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
  });
}
