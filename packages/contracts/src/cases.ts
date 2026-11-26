/**
 * Cases (plan C129, C131, C134, C136, C137): a case on a pinned template version, with a status in the
 * public categories, a resolution, fields from the Phase 7 union, tags, the objects it holds and its
 * timeline. Actors are OpenVerify ids (`usr_`, `key_`, `wfr_`, `cap_`), never email addresses
 * (decision 64). The attachment, queue, SLA and assignment contracts are the (F) and (Q) families'.
 *
 * `fields` is PII, masked member-wise without `pii:view`, as a transaction's is; it reads `null` once
 * redacted and in every event's payload, so a webhook carries no field's value (C136.4). A status, a
 * resolution, a tag and a name are an operator's words, not PII, and the docs say to keep them so. The
 * history is PII-free by rule (C131.4). **Holding grants nothing:** a held object's content is read
 * through its own route and scope (C136.3), and this resource names ids alone.
 *
 * Routes (frozen by `foundation-8b`, built by `api-cases`): C129.5. `POST /cases/search` is the
 * public body (C137.2), read after write (decision 74); `POST /cases/bulk` is ours and asynchronous.
 */
import {
  CASE_SEARCH_ATTRIBUTES,
  FIELD_KEY_PATTERN,
  caseAssignerTypeSchema,
  caseBulkActionSchema,
  caseBulkOutcomeSchema,
  caseBulkStatusSchema,
  caseCreatorTypeSchema,
  caseHeldObjectTypeSchema,
  CASE_CHECKLIST_HISTORY_KINDS,
  CASE_HISTORY_KINDS,
  caseResolverTypeSchema,
  caseSearchOperatorSchema,
  caseSlaStateSchema,
  caseStatusCategorySchema,
  caseUpdaterTypeSchema,
  type CaseAssignerType,
  type CaseBulkAction,
  type CaseBulkOutcome,
  type CaseBulkStatus,
  type CaseCreatorType,
  type CaseResolverType,
  type CaseSlaState,
  type CaseStatusCategory,
  type CaseUpdaterType,
} from '@openverify/core';
import { z } from 'zod';
import { accountResourceSchema } from './accounts.js';
import { actionBodySchema, emptyActionBodySchema, optionalActionBodySchema } from './actions.js';
import {
  buildCaseAttachment,
  caseAttachmentUploadsSchema,
  caseAttachmentsSchema,
  type CaseAttachmentRecord,
} from './case-attachments.js';
import { caseCommentMessageSchema, caseCommentResourceSchema } from './case-comments.js';
import { caseQueueResourceSchema } from './case-queues.js';
import {
  caseLimit,
  caseResolutionSchema,
  caseStatusKeySchema,
  caseTemplateIdentifierSchema,
  caseTemplateResourceSchema,
  caseTemplateVersionIdentifierSchema,
} from './case-templates.js';
import { graphQueryResourceSchema } from './graph-queries.js';
import {
  accountIdentifierSchema,
  caseQueueIdentifierSchema,
  inquiryIdentifierSchema,
  referenceIdSchema,
  reportIdentifierSchema,
  transactionIdentifierSchema,
  verificationIdentifierSchema,
} from './identifiers.js';
import { anyIdSchema, idSchema } from './ids.js';
import { inquiryResourceSchema } from './inquiries.js';
import {
  hasDistinctValues,
  listDocumentSchema,
  pageSizeSchema,
  resourceIdentifierSchema,
  resourceSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';
import { REPORT_RESOURCE_SCHEMAS, reportRunResourceSchema } from './reports.js';
import { tagInputSchema, tagListInputSchema, tagsSchema } from './tags.js';
import {
  transactionFieldKeySchema,
  transactionFieldValueSchema,
  transactionResourceSchema,
  type TransactionFieldValue,
} from './transactions.js';
import { VERIFICATION_RESOURCE_SCHEMAS } from './verifications.js';

/** Marks a member PII (C143.5): nullable, so a masked or redacted copy still parses. */
function pii<Schema extends z.ZodType>(schema: Schema) {
  return schema.nullable().meta({ pii: true });
}

/** C129.2: the template's key and a per-template counter, `KYC-6`. */
export const caseNameSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,11}$/, 'must be a template key and a counter');

// ---------------------------------------------------------------------------------------------
// The case (C129.2)

/** Each actor kind's id prefix (decision 64): an id, never an email address. */
const ACTOR_PREFIX: Readonly<Record<string, string>> = {
  user: 'usr',
  'api-key': 'key',
  'workflow-run': 'wfr',
  'case-assignment-policy': 'cap',
};

function actorFits(type: string | null, id: string | null): boolean {
  if (type === null || id === null) {
    return type === id;
  }
  return id.startsWith(`${ACTOR_PREFIX[type] ?? ''}_`);
}

const actorId = z.string().min(1).max(64);

/** C133.4: the SLA states with no deadline to serve. */
const SLA_WITHOUT_DEADLINE: ReadonlySet<CaseSlaState> = new Set(['none', 'paused']);

/** How many objects a case holds of each kind (ours); a resource names the newest of each. */
export const caseHeldObjectCountsSchema = z.strictObject({
  accounts: z.int().min(0),
  inquiries: z.int().min(0),
  reports: z.int().min(0),
  'report-runs': z.int().min(0),
  transactions: z.int().min(0),
  verifications: z.int().min(0),
  'graph-queries': z.int().min(0),
});
export type CaseHeldObjectCounts = z.infer<typeof caseHeldObjectCountsSchema>;

/** C129.2: public attributes, then ours. */
export const caseAttributesSchema = z
  .strictObject({
    status: caseStatusKeySchema,
    name: caseNameSchema,
    resolution: caseResolutionSchema.nullable(),
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
    'assigned-at': timestampSchema.nullable(),
    'resolved-at': timestampSchema.nullable(),
    'redacted-at': timestampSchema.nullable(),
    'sla-expires-at': timestampSchema.nullable(),
    'creator-id': actorId,
    'creator-type': caseCreatorTypeSchema,
    'assignee-id': idSchema('usr').nullable(),
    'assigner-id': actorId.nullable(),
    'assigner-type': caseAssignerTypeSchema.nullable(),
    'resolver-id': actorId.nullable(),
    'resolver-type': caseResolverTypeSchema.nullable(),
    'updater-id': actorId.nullable(),
    'updater-type': caseUpdaterTypeSchema.nullable(),
    tags: tagsSchema,
    /** Member-wise masked; `null` once redacted, and in every event's payload (C136.4). */
    fields: pii(z.record(transactionFieldKeySchema, transactionFieldValueSchema)),
    'status-category': caseStatusCategorySchema,
    /** C131.2: `meta.lock-version` is compared with this, and a stale one answers 409. */
    'lock-version': z.int().min(0),
    'held-object-counts': caseHeldObjectCountsSchema,
    /**
     * C133.4: `sla-expires-at` is `null` while no SLA is set or it is paused, and the deadline
     * otherwise: running, met before it, or expired at it.
     */
    'sla-state': caseSlaStateSchema,
    /** C135: what a reader is served is a rendition; the bytes are never in a resource. */
    attachments: caseAttachmentsSchema,
  })
  .refine((a) => SLA_WITHOUT_DEADLINE.has(a['sla-state']) === (a['sla-expires-at'] === null), {
    message: 'sla-expires-at is null exactly when no SLA is set or it is paused',
    path: ['sla-expires-at'],
  })
  .refine((a) => actorFits(a['creator-type'], a['creator-id']), {
    message: 'the id does not belong to the creator type',
    path: ['creator-id'],
  })
  .refine((a) => actorFits(a['assigner-type'], a['assigner-id']), {
    message: 'the id does not belong to the assigner type',
    path: ['assigner-id'],
  })
  .refine((a) => actorFits(a['resolver-type'], a['resolver-id']), {
    message: 'the id does not belong to the resolver type',
    path: ['resolver-id'],
  })
  .refine((a) => actorFits(a['updater-type'], a['updater-id']), {
    message: 'the id does not belong to the updater type',
    path: ['updater-id'],
  });

const SERVED = caseLimit('held-objects-served');

const held = <Identifier extends z.ZodType>(identifier: Identifier) =>
  z.strictObject({ data: z.array(identifier).max(SERVED) });

const reportRunIdentifierSchema = resourceIdentifierSchema('report-run', 'rpr');
const graphQueryIdentifierSchema = resourceIdentifierSchema('graph-query', 'grphq');
const caseCommentIdentifierSchema = resourceIdentifierSchema('case-comment', 'cscm');

/**
 * C129.2. Each held kind names its newest {@link SERVED}: `held-object-counts` gives the totals and
 * `GET /cases/:id/objects` every row (Stage 1a amendment 19).
 */
export const caseRelationshipsSchema = z.strictObject({
  'case-template': z.strictObject({ data: caseTemplateIdentifierSchema }),
  'case-template-version': z.strictObject({ data: caseTemplateVersionIdentifierSchema }),
  'case-queue': z.strictObject({ data: caseQueueIdentifierSchema.nullable() }),
  'case-comments': held(caseCommentIdentifierSchema),
  accounts: held(accountIdentifierSchema),
  inquiries: held(inquiryIdentifierSchema),
  reports: held(reportIdentifierSchema),
  verifications: held(verificationIdentifierSchema),
  txns: held(transactionIdentifierSchema),
  'report-runs': held(reportRunIdentifierSchema),
  'graph-queries': held(graphQueryIdentifierSchema),
});
export type CaseRelationships = z.infer<typeof caseRelationshipsSchema>;

export const caseResourceSchema = resourceWithRelationshipsSchema(
  'case',
  'case',
  caseAttributesSchema,
  caseRelationshipsSchema,
);
export type CaseResource = z.infer<typeof caseResourceSchema>;
export const caseDocumentSchema = singleDocumentSchema(caseResourceSchema);
export type CaseDocument = z.infer<typeof caseDocumentSchema>;
export const caseListDocumentSchema = listDocumentSchema(caseResourceSchema);
export type CaseListDocument = z.infer<typeof caseListDocumentSchema>;

/** C143.6: what `GET /api/v1/cases/:id` can include; each reads under its own scope. */
export const CASE_INCLUDES = [
  'case-template',
  'case-queue',
  'case-comments',
  'accounts',
  'inquiries',
  'reports',
  'verifications',
  'txns',
  'report-runs',
  'graph-queries',
] as const;

export const caseIncludeSchema = z.enum(CASE_INCLUDES);

/** `GET /api/v1/cases/:id`: `included` is there when `include` asked for it. */
export const caseIncludeDocumentSchema = z.strictObject({
  data: caseResourceSchema,
  included: z
    .array(
      z.discriminatedUnion('type', [
        caseTemplateResourceSchema,
        caseQueueResourceSchema,
        caseCommentResourceSchema,
        accountResourceSchema,
        inquiryResourceSchema,
        ...REPORT_RESOURCE_SCHEMAS,
        ...VERIFICATION_RESOURCE_SCHEMAS,
        transactionResourceSchema,
        reportRunResourceSchema,
        graphQueryResourceSchema,
      ]),
    )
    .optional(),
});
export type CaseIncludeDocument = z.infer<typeof caseIncludeDocumentSchema>;

export const getCaseQuerySchema = z.strictObject({
  include: filterListSchema(caseIncludeSchema, CASE_INCLUDES.length).optional(),
});
export type GetCaseQuery = z.infer<typeof getCaseQuerySchema>;

/** C129.5: `GET /api/v1/cases`, newest first; the public filters, then ours. */
export const listCasesQuerySchema = listQuerySchema('case', {
  'filter[status]': filterListSchema(caseStatusKeySchema).optional(),
  'filter[case-template-id]': filterListSchema(idSchema('ctmpl')).optional(),
  'filter[account-id]': filterListSchema(idSchema('acc')).optional(),
  'filter[reference-id]': referenceIdSchema.optional(),
  'filter[inquiry-id]': filterListSchema(idSchema('inq')).optional(),
  'filter[report-id]': filterListSchema(idSchema('rep')).optional(),
  'filter[case-queue-id]': filterListSchema(idSchema('cqueue')).optional(),
  'filter[assignee-id]': filterListSchema(idSchema('usr')).optional(),
  'filter[status-category]': filterListSchema(caseStatusCategorySchema).optional(),
  'filter[sla-state]': filterListSchema(caseSlaStateSchema).optional(),
});
export type ListCasesQuery = z.infer<typeof listCasesQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Writing a case (C129.5, C131, C136)

const fieldsBody = z.record(transactionFieldKeySchema, z.unknown()).optional().meta({ pii: true });

/** C136.1: any id here; the service refuses what a case cannot hold (`object_type_unsupported`). */
export const caseObjectIdsSchema = z
  .array(anyIdSchema)
  .min(1)
  .max(caseLimit('object-ids'))
  .refine(hasDistinctValues, 'must not contain duplicates');

/**
 * C133.1: the seconds are a plain integer here, so the service answers the named `sla_out_of_range`
 * rather than a validation error.
 */
const slaSeconds = z.int();

const lockVersion = { 'lock-version': z.int().min(0).optional() };

/** `POST /api/v1/cases` (`cases:write`): the public body. */
export const createCaseBodySchema = z.strictObject({
  data: z.strictObject({
    type: z.literal('case').optional(),
    attributes: z.strictObject({
      'case-template-id': idSchema('ctmpl'),
      /** Accepted for parity, and resolved to a user id within the organisation (C129.5). */
      'creator-email-address': z.email().max(254).optional().meta({ pii: true }),
      'case-queue-id': idSchema('cqueue').optional(),
      fields: fieldsBody,
      tags: tagListInputSchema.optional(),
    }),
  }),
  meta: z
    .strictObject({
      'object-ids': caseObjectIdsSchema.optional(),
      'sla-expires-in-seconds': slaSeconds.optional(),
    })
    .optional(),
});
export type CreateCaseBody = z.infer<typeof createCaseBodySchema>;

/**
 * `PATCH /api/v1/cases/:id`: the public body, `attachments` within one request's 10 MiB decoded total
 * (C135.1, H31). An attribute list that is empty needs a `meta` to change something.
 */
export const updateCaseBodySchema = z
  .strictObject({
    data: z
      .strictObject({
        type: z.literal('case').optional(),
        attributes: z.strictObject({
          'case-queue-id': idSchema('cqueue').nullable().optional(),
          fields: fieldsBody,
          attachments: caseAttachmentUploadsSchema.optional(),
        }),
      })
      .optional(),
    meta: z
      .strictObject({ 'sla-expires-in-seconds': slaSeconds.nullable().optional(), ...lockVersion })
      .optional(),
  })
  .refine(
    ({ data, meta }) =>
      Object.keys(data?.attributes ?? {}).length > 0 ||
      meta?.['sla-expires-in-seconds'] !== undefined,
    'nothing to update',
  );
export type UpdateCaseBody = z.infer<typeof updateCaseBodySchema>;

/** `POST /cases/:id/set-status` (C131.1): `meta.status` is required, as the public body says. */
export const setCaseStatusBodySchema = actionBodySchema(
  z.strictObject({
    status: caseStatusKeySchema,
    resolution: caseResolutionSchema.optional(),
    /** Becomes a comment; a status with `required-comment` needs it. */
    comment: caseCommentMessageSchema.optional().meta({ pii: true }),
    'status-tag': caseStatusKeySchema.optional(),
    ...lockVersion,
  }),
);
export type SetCaseStatusBody = z.infer<typeof setCaseStatusBodySchema>;

/** `POST /cases/:id/add-comment`: public; it answers the case. */
export const addCaseCommentBodySchema = actionBodySchema(
  z.strictObject({ message: caseCommentMessageSchema.meta({ pii: true }) }),
);
export type AddCaseCommentBody = z.infer<typeof addCaseCommentBodySchema>;

/** `POST /cases/:id/add-objects`: a repeat is `no_change`, and a case holds at most 1,000. */
export const addCaseObjectsBodySchema = actionBodySchema(
  z.strictObject({ 'object-ids': caseObjectIdsSchema }),
);
/** `POST /cases/:id/remove-objects`: an absent object is a no-op. */
export const removeCaseObjectsBodySchema = addCaseObjectsBodySchema;
export type CaseObjectsBody = z.infer<typeof addCaseObjectsBodySchema>;

/**
 * C136.5 (public): `tag-name` or `tag-id`. OpenVerify's tags are names, with no id of their own, so
 * `tag-id` reads as the name (Stage 1a amendment 16).
 */
const oneTag = z
  .strictObject({ 'tag-name': tagInputSchema.optional(), 'tag-id': tagInputSchema.optional() })
  .refine(
    (meta) => (meta['tag-name'] === undefined) !== (meta['tag-id'] === undefined),
    'takes tag-name or tag-id',
  );

export const addCaseTagBodySchema = actionBodySchema(oneTag);
export const removeCaseTagBodySchema = actionBodySchema(oneTag);

/** C136.5: `set-tags` replaces all, by the public arrays or OpenVerify's `tag-names`. */
export const setCaseTagsBodySchema = actionBodySchema(
  z
    .strictObject({
      'tag-name': tagListInputSchema.optional(),
      'tag-id': tagListInputSchema.optional(),
      'tag-names': tagListInputSchema.optional(),
    })
    .refine((meta) => Object.keys(meta).length > 0, 'names the tags to set'),
);
export type SetCaseTagsBody = z.infer<typeof setCaseTagsBodySchema>;

// ---------------------------------------------------------------------------------------------
// Assignment (C132.3): the (Q) family's routes, which answer the case

/**
 * `POST /cases/:id/assign` (`cases:assign`, or `cases:write` to assign oneself): `user-id` (ours) or
 * the public `user-email-address`, resolved within the organisation; `user-id: null` unassigns. A
 * refusal is `case_assignee_ineligible` and never says whether an address exists elsewhere.
 */
export const assignCaseBodySchema = actionBodySchema(
  z
    .strictObject({
      'user-id': idSchema('usr').nullable().optional(),
      'user-email-address': z.email().max(254).optional().meta({ pii: true }),
      ...lockVersion,
    })
    .refine(
      (meta) => (meta['user-id'] === undefined) !== (meta['user-email-address'] === undefined),
      'takes user-id or user-email-address',
    ),
);
export type AssignCaseBody = z.infer<typeof assignCaseBodySchema>;

/**
 * `POST /cases/next` (`cases:write`, ours): the most urgent unassigned case of the caller's queues,
 * assigned to the caller (C132.3), or of the queues named, each of which the caller is a member of.
 */
export const nextCaseBodySchema = optionalActionBodySchema(
  z.strictObject({
    'case-queue-ids': z
      .array(idSchema('cqueue'))
      .min(1)
      .max(caseLimit('policy-sources'))
      .refine(hasDistinctValues, 'must not contain duplicates')
      .optional(),
  }),
);
export type NextCaseBody = z.infer<typeof nextCaseBodySchema>;

/** `data` is `null` when no case is waiting: an empty queue is no error. */
export const nextCaseDocumentSchema = z.strictObject({ data: caseResourceSchema.nullable() });
export type NextCaseDocument = z.infer<typeof nextCaseDocumentSchema>;

/** `POST /cases/:id/print` (C138.3): audits and fires `case.print-initiated`. */
export const printCaseBodySchema = emptyActionBodySchema;

/**
 * `POST /inquiries/:id/review-requests` (C128.7): opens a review case on the contest route's template
 * holding the inquiry, and records the person's statement as a sealed comment.
 */
export const createInquiryReviewRequestBodySchema = actionBodySchema(
  z.strictObject({
    statement: z.string().min(1).max(caseLimit('statement-characters')).meta({ pii: true }),
  }),
);
export type CreateInquiryReviewRequestBody = z.infer<typeof createInquiryReviewRequestBodySchema>;

// ---------------------------------------------------------------------------------------------
// Search (C137.2): the public body

const SEARCH_ATTRIBUTES: ReadonlySet<string> = new Set(CASE_SEARCH_ATTRIBUTES);

const searchAttributeFits = (attribute: string): boolean =>
  SEARCH_ATTRIBUTES.has(attribute) ||
  (attribute.startsWith('fields.') && FIELD_KEY_PATTERN.test(attribute.slice('fields.'.length)));

export const caseSearchLeafSchema = z.strictObject({
  attribute: z.string().min(1).max(80).refine(searchAttributeFits, 'is not a search attribute'),
  operator: caseSearchOperatorSchema,
  value: z.union([z.string().max(1024), z.number(), z.boolean(), z.null()]),
});
export type CaseSearchLeaf = z.infer<typeof caseSearchLeafSchema>;

const CLAUSES = caseLimit('search-clauses');

const clauses = <Item extends z.ZodType>(item: Item) => z.array(item).min(1).max(CLAUSES);

const group = <Item extends z.ZodType>(item: Item) =>
  z.union([
    z.strictObject({ and: clauses(item) }),
    z.strictObject({ or: clauses(item) }),
    z.strictObject({ not: item }),
  ]);

/** Two levels and no more, written out, so a request cannot nest past the stack (C137.2). */
const innerQuery = z.union([caseSearchLeafSchema, group(caseSearchLeafSchema)]);

/** C137.2: an `and`, `or` and `not` tree of depth at most 2, 20 clauses per `and` or `or`. */
export const caseSearchQuerySchema = z.union([caseSearchLeafSchema, group(innerQuery)]);
export type CaseSearchQuery = z.infer<typeof caseSearchQuerySchema>;

export const CASE_SEARCH_SORT_ATTRIBUTES = [
  'created_at',
  'updated_at',
  'resolved_at',
  'sla_expires_at',
] as const;

export const caseSearchBodySchema = z.strictObject({
  /** Leaves can hold a field's value, so a stored log masks it whole (C143.5, P25). */
  query: caseSearchQuerySchema.optional().meta({ pii: true }),
  sort: z
    .strictObject({
      attribute: z.enum(CASE_SEARCH_SORT_ATTRIBUTES),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
  page: z
    .strictObject({
      after: idSchema('case').optional(),
      before: idSchema('case').optional(),
      size: pageSizeSchema.optional(),
    })
    .refine(({ after, before }) => after === undefined || before === undefined, {
      message: 'takes after or before',
      path: ['before'],
    })
    .optional(),
});
export type CaseSearchBody = z.infer<typeof caseSearchBodySchema>;

/** The public page has both directions; `links.prev` is `null` on the first page. */
export const caseSearchDocumentSchema = z.strictObject({
  data: z.array(caseResourceSchema),
  links: z.strictObject({ next: z.string().nullable(), prev: z.string().nullable() }),
});
export type CaseSearchDocument = z.infer<typeof caseSearchDocumentSchema>;

// ---------------------------------------------------------------------------------------------
// The timeline and held objects (C131.4, C136.3; Stage 1a amendments 6 and 19)

/** The number of a row of the append-only history: `id` of an entry, and its cursor. */
export const caseHistorySequenceSchema = z.string().regex(/^[1-9][0-9]{0,18}$/);

/**
 * C131.4: one entry of a case's timeline, PII-free by rule. `from` and `to` hold status keys, field
 * keys, ids and an assignment's inputs, never a value. A resource of its own rather than a member,
 * because the history is unbounded (owner decision 8 after 7B).
 */
/** C172.2 (Workflow 9B): Phase 8's history kinds and the checklist's. */
export const caseHistoryEntryKindSchema = z.enum([
  ...CASE_HISTORY_KINDS,
  ...CASE_CHECKLIST_HISTORY_KINDS,
]);
export type CaseHistoryEntryKind = z.infer<typeof caseHistoryEntryKindSchema>;

export const caseHistoryEntryResourceSchema = z.strictObject({
  type: z.literal('case-history-entry'),
  id: caseHistorySequenceSchema,
  attributes: z.strictObject({
    kind: caseHistoryEntryKindSchema,
    'actor-type': z.string().regex(/^[a-z][a-z-]{0,31}$/),
    'actor-id': actorId.nullable(),
    from: z.record(z.string(), z.unknown()).nullable(),
    to: z.record(z.string(), z.unknown()).nullable(),
    'request-id': z.string().min(1).max(128).nullable(),
    'created-at': timestampSchema,
  }),
});
export type CaseHistoryEntryResource = z.infer<typeof caseHistoryEntryResourceSchema>;
export const caseHistoryListDocumentSchema = listDocumentSchema(caseHistoryEntryResourceSchema);
export type CaseHistoryListDocument = z.infer<typeof caseHistoryListDocumentSchema>;

/** `GET /api/v1/cases/:id/history` (`cases:read`): newest first. */
export const listCaseHistoryQuerySchema = z.strictObject({
  'page[after]': caseHistorySequenceSchema.optional(),
  'page[size]': pageSizeSchema.optional(),
});
export type ListCaseHistoryQuery = z.infer<typeof listCaseHistoryQuerySchema>;

const ULID = '[0-7][0-9A-HJKMNP-TV-Z]{25}';

/** `<case>:<object>`, the row's own key: the join tables have no public id. */
export const caseHeldObjectIdSchema = z
  .string()
  .regex(new RegExp(`^case_${ULID}:(?:acc|inq|rep|rpr|txn|ver|grphq)_${ULID}$`));

/** C136.3: the object as attached: plaintext, PII-free attributes, each a scalar or a list of ids. */
export const caseAttachedStateSchema = z.record(
  z.string().min(1).max(64),
  z.union([z.string().max(255), z.number(), z.boolean(), z.null(), z.array(anyIdSchema)]),
);
export type CaseAttachedState = z.infer<typeof caseAttachedStateSchema>;

/**
 * C136.3: one held object: its id and type, when and by whom it was attached, and its state then. The
 * live object is read through its own route and scope; a reader without it sees this and "no access".
 */
export const caseHeldObjectResourceSchema = z.strictObject({
  type: z.literal('case-held-object'),
  id: caseHeldObjectIdSchema,
  attributes: z.strictObject({
    'object-type': caseHeldObjectTypeSchema,
    'object-id': anyIdSchema,
    'attached-at': timestampSchema,
    'attached-by-type': caseCreatorTypeSchema,
    'attached-by-id': actorId,
    'attached-state': caseAttachedStateSchema,
  }),
});
export type CaseHeldObjectResource = z.infer<typeof caseHeldObjectResourceSchema>;
export const caseHeldObjectListDocumentSchema = listDocumentSchema(caseHeldObjectResourceSchema);
export type CaseHeldObjectListDocument = z.infer<typeof caseHeldObjectListDocumentSchema>;

/** `GET /api/v1/cases/:id/objects` (`cases:read`): newest first, by C1's order. */
export const listCaseHeldObjectsQuerySchema = z.strictObject({
  'filter[object-type]': filterListSchema(caseHeldObjectTypeSchema).optional(),
  'page[after]': caseHeldObjectIdSchema.optional(),
  'page[size]': pageSizeSchema.optional(),
});
export type ListCaseHeldObjectsQuery = z.infer<typeof listCaseHeldObjectsQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Bulk actions (C137.4)

const BULK_SELECTION = {
  /** At most 500. */
  'case-ids': z
    .array(idSchema('case'))
    .min(1)
    .max(caseLimit('bulk-cases'))
    .refine(hasDistinctValues, 'must not contain duplicates')
    .optional(),
  /** A search body; past 500 matches it answers `case_bulk_too_large`, and C137.2's PII rule holds. */
  search: z.strictObject({ query: caseSearchQuerySchema.meta({ pii: true }) }).optional(),
};

function bulkAction<const Action extends string, Meta extends z.ZodType>(
  action: Action,
  meta: Meta,
) {
  return z
    .strictObject({
      data: z.strictObject({
        type: z.literal('case-bulk-action').optional(),
        attributes: z.strictObject({ action: z.literal(action), ...BULK_SELECTION }),
      }),
      meta,
    })
    .refine(
      ({ data: { attributes } }) =>
        (attributes['case-ids'] === undefined) !== (attributes.search === undefined),
      { message: 'takes case-ids or a search', path: ['data', 'attributes', 'case-ids'] },
    );
}

const bulkTags = z.strictObject({ 'tag-names': tagListInputSchema });

/**
 * `POST /api/v1/cases/bulk` (`cases:write`, plus `cases:assign` to assign): asynchronous, so it
 * answers 202 with the action. Each case takes the same service as a single route.
 */
export const createCaseBulkActionBodySchema = z.union([
  bulkAction('assign', z.strictObject({ 'user-id': idSchema('usr').nullable() })),
  bulkAction(
    'set-status',
    z.strictObject({
      status: caseStatusKeySchema,
      resolution: caseResolutionSchema.optional(),
      comment: caseCommentMessageSchema.optional().meta({ pii: true }),
      'status-tag': caseStatusKeySchema.optional(),
    }),
  ),
  bulkAction('set-queue', z.strictObject({ 'case-queue-id': idSchema('cqueue').nullable() })),
  bulkAction('add-tags', bulkTags),
  bulkAction('remove-tags', bulkTags),
]);
export type CreateCaseBulkActionBody = z.infer<typeof createCaseBulkActionBodySchema>;

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const problemCode = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, 'must be a code');

/** C137.4: what happened to one case; `code` is the refusal's problem code, and nothing more. */
export const caseBulkCaseOutcomeSchema = z
  .strictObject({
    'case-id': idSchema('case'),
    outcome: caseBulkOutcomeSchema,
    code: problemCode.nullable(),
  })
  .refine(({ outcome, code }) => (outcome === 'refused') === (code !== null), {
    message: 'a refusal has a code, and nothing else does',
    path: ['code'],
  });

/** `GET /api/v1/case-bulk-actions/:id`: the creating principal's own (Stage 1a amendment 22). */
export const caseBulkActionResourceSchema = resourceSchema(
  'case-bulk-action',
  'cblk',
  z.strictObject({
    action: caseBulkActionSchema,
    status: caseBulkStatusSchema,
    'requested-count': z.int().min(0),
    'applied-count': z.int().min(0),
    'no-change-count': z.int().min(0),
    'refused-count': z.int().min(0),
    /** Filled in when the job has done. */
    outcomes: z.array(caseBulkCaseOutcomeSchema).max(caseLimit('bulk-cases')),
    'created-at': timestampSchema,
    'completed-at': timestampSchema.nullable(),
  }),
);
export type CaseBulkActionResource = z.infer<typeof caseBulkActionResourceSchema>;
export const caseBulkActionDocumentSchema = singleDocumentSchema(caseBulkActionResourceSchema);
export type CaseBulkActionDocument = z.infer<typeof caseBulkActionDocumentSchema>;

// ---------------------------------------------------------------------------------------------
// Event meta (C129.6)

/** C136.5: the public `context`. */
export const caseUpdatedTagsMetaSchema = z.strictObject({
  context: z.strictObject({ 'added-tags': tagsSchema, 'removed-tags': tagsSchema }),
});

/** C136.4: the keys that changed, never a value. */
export const caseUpdatedFieldsMetaSchema = z.strictObject({
  context: z.strictObject({ 'field-keys': z.array(transactionFieldKeySchema).min(1) }),
});

/** C131.1: the status keys of the move. */
export const caseStatusUpdatedMetaSchema = z.strictObject({
  context: z.strictObject({ from: caseStatusKeySchema, to: caseStatusKeySchema }),
});

/** C138.1: which export took the case. */
export const caseExportedMetaSchema = z.strictObject({
  context: z.strictObject({ 'case-export-id': idSchema('cexp') }),
});

// ---------------------------------------------------------------------------------------------
// PII (C143.5)

/**
 * C143.5: the PII names of a case and its bodies, joined to the masking lists and the API-log set by
 * `foundation-8b`. `comment` is `PII_DECISION_ATTRIBUTES`' already, `query` `PII_REPORT_ATTRIBUTES`'.
 */
export const PII_CASE_ATTRIBUTES: readonly string[] = Object.freeze([
  'fields',
  'creator-email-address',
  'statement',
  // C132.3 (the (Q) family): `meta.user-email-address` of an assignment. It sits in `meta`, so the
  // stored API log masks it by name at any depth (C143.5).
  'user-email-address',
]);

// ---------------------------------------------------------------------------------------------
// Builders

export interface CaseRecord {
  id: string;
  name: string;
  status: string;
  statusCategory: CaseStatusCategory;
  resolution: string | null;
  caseTemplateId: string;
  caseTemplateVersionId: string;
  caseQueueId: string | null;
  creatorType: CaseCreatorType;
  creatorId: string;
  assigneeId: string | null;
  assignerType: CaseAssignerType | null;
  assignerId: string | null;
  resolverType: CaseResolverType | null;
  resolverId: string | null;
  updaterType: CaseUpdaterType | null;
  updaterId: string | null;
  tags: readonly string[];
  /** As the principal may see them; `null` when redacted, and in an event's payload. */
  fields: Readonly<Record<string, TransactionFieldValue>> | null;
  lockVersion: number;
  heldObjectCounts: CaseHeldObjectCounts;
  commentIds: readonly string[];
  accounts: CaseRelationships['accounts']['data'];
  inquiries: CaseRelationships['inquiries']['data'];
  reports: CaseRelationships['reports']['data'];
  verifications: CaseRelationships['verifications']['data'];
  transactions: CaseRelationships['txns']['data'];
  reportRunIds: readonly string[];
  graphQueryIds: readonly string[];
  /** C133.1; `null` exactly when `slaState` is `none` or `paused`. */
  slaExpiresAt?: Date | null;
  /** C133.4. Left out, `none`, until the (Q) columns land. */
  slaState?: CaseSlaState;
  /** C135. Left out, none, until the (F) table lands. */
  attachments?: readonly CaseAttachmentRecord[];
  assignedAt: Date | null;
  resolvedAt: Date | null;
  redactedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildCaseResource(record: CaseRecord): CaseResource {
  return caseResourceSchema.parse({
    type: 'case',
    id: record.id,
    attributes: {
      status: record.status,
      name: record.name,
      resolution: record.resolution,
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
      'assigned-at': toNullableTimestamp(record.assignedAt),
      'resolved-at': toNullableTimestamp(record.resolvedAt),
      'redacted-at': toNullableTimestamp(record.redactedAt),
      'sla-expires-at': toNullableTimestamp(record.slaExpiresAt ?? null),
      'creator-id': record.creatorId,
      'creator-type': record.creatorType,
      'assignee-id': record.assigneeId,
      'assigner-id': record.assignerId,
      'assigner-type': record.assignerType,
      'resolver-id': record.resolverId,
      'resolver-type': record.resolverType,
      'updater-id': record.updaterId,
      'updater-type': record.updaterType,
      tags: record.tags,
      fields: record.fields,
      'status-category': record.statusCategory,
      'lock-version': record.lockVersion,
      'held-object-counts': record.heldObjectCounts,
      'sla-state': record.slaState ?? 'none',
      attachments: (record.attachments ?? []).map(buildCaseAttachment),
    },
    relationships: {
      'case-template': { data: { type: 'case-template', id: record.caseTemplateId } },
      'case-template-version': {
        data: { type: 'case-template-version', id: record.caseTemplateVersionId },
      },
      'case-queue': {
        data: record.caseQueueId === null ? null : { type: 'case-queue', id: record.caseQueueId },
      },
      'case-comments': {
        data: record.commentIds.map((id) => ({ type: 'case-comment', id })),
      },
      accounts: { data: record.accounts },
      inquiries: { data: record.inquiries },
      reports: { data: record.reports },
      verifications: { data: record.verifications },
      txns: { data: record.transactions },
      'report-runs': { data: record.reportRunIds.map((id) => ({ type: 'report-run', id })) },
      'graph-queries': { data: record.graphQueryIds.map((id) => ({ type: 'graph-query', id })) },
    },
  });
}

export interface CaseHistoryEntryRecord {
  sequence: number;
  /** Phase 8's kinds and, from migration 0031, the checklist's (B34). */
  kind: CaseHistoryEntryKind;
  actorType: string;
  actorId: string | null;
  from: Readonly<Record<string, unknown>> | null;
  to: Readonly<Record<string, unknown>> | null;
  requestId: string | null;
  createdAt: Date;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildCaseHistoryEntryResource(
  record: CaseHistoryEntryRecord,
): CaseHistoryEntryResource {
  return caseHistoryEntryResourceSchema.parse({
    type: 'case-history-entry',
    id: String(record.sequence),
    attributes: {
      kind: record.kind,
      'actor-type': record.actorType,
      'actor-id': record.actorId,
      from: record.from,
      to: record.to,
      'request-id': record.requestId,
      'created-at': toTimestamp(record.createdAt),
    },
  });
}

export interface CaseBulkActionRecord {
  id: string;
  action: CaseBulkAction;
  status: CaseBulkStatus;
  requestedCount: number;
  outcomes: readonly { caseId: string; outcome: CaseBulkOutcome; code: string | null }[];
  createdAt: Date;
  completedAt: Date | null;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildCaseBulkActionResource(record: CaseBulkActionRecord): CaseBulkActionResource {
  const count = (outcome: CaseBulkOutcome) =>
    record.outcomes.filter((each) => each.outcome === outcome).length;
  return caseBulkActionResourceSchema.parse({
    type: 'case-bulk-action',
    id: record.id,
    attributes: {
      action: record.action,
      status: record.status,
      'requested-count': record.requestedCount,
      'applied-count': count('applied'),
      'no-change-count': count('no_change'),
      'refused-count': count('refused'),
      outcomes: record.outcomes.map(({ caseId, outcome, code }) => ({
        'case-id': caseId,
        outcome,
        code,
      })),
      'created-at': toTimestamp(record.createdAt),
      'completed-at': toNullableTimestamp(record.completedAt),
    },
  });
}

// Checklists (C172.2, Workflow 9B) ---------------------------------------------------------

/**
 * `POST /api/v1/cases/:id/checklist` (`cases:write`): check or uncheck one item of the case's
 * version; `meta.lock-version` as every case change. Answers the case's checklist state.
 */
export const setCaseChecklistItemBodySchema = z.strictObject({
  meta: z.strictObject({
    'checklist-key': z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    'item-key': z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    checked: z.boolean(),
    'lock-version': z.int().min(0).optional(),
  }),
});
export type SetCaseChecklistItemBody = z.infer<typeof setCaseChecklistItemBodySchema>;

/** One item's state: who checked it and when; nothing checks an item on a person's behalf. */
export const caseChecklistItemStateSchema = z
  .strictObject({
    'checklist-key': z.string().max(40),
    'item-key': z.string().max(40),
    checked: z.boolean(),
    'checked-by': z.union([idSchema('usr'), idSchema('wfr')]).nullable(),
    'checked-at': timestampSchema.nullable(),
  })
  .refine((item) => item.checked === (item['checked-by'] !== null && item['checked-at'] !== null), {
    message: 'a checked item names who and when, and an unchecked one neither',
    path: ['checked-by'],
  });

export const caseChecklistStateDocumentSchema = singleDocumentSchema(
  z.strictObject({
    type: z.literal('case-checklist-state'),
    id: idSchema('case'),
    attributes: z.strictObject({
      items: z.array(caseChecklistItemStateSchema).max(500),
      'lock-version': z.int().min(0),
    }),
  }),
);
export type CaseChecklistStateDocument = z.infer<typeof caseChecklistStateDocumentSchema>;

/** C172.2: the checklist's history kinds, beside Phase 8's (`caseHistoryEntryKindSchema`). */
export { CASE_CHECKLIST_HISTORY_KINDS };
