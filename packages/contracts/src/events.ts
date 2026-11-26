/**
 * Event resource (contracts C5, C14, C16 and C17). `{ data: <event> }` is both the
 * `GET /api/v1/events/:id` response and the body of every webhook delivery.
 */
import {
  inquiryStatusSchema,
  reportReviewStatusSchema,
  reportReviewTypeSchema,
  reportRiskLevelSchema,
} from '@openverify/core';
import { z } from 'zod';
import { accountResourceSchema } from './accounts.js';
import { caseCommentResourceSchema } from './case-comments.js';
import {
  caseTemplateDeletedFieldMetaSchema,
  caseTemplateResourceSchema,
} from './case-templates.js';
import {
  caseExportedMetaSchema,
  caseResourceSchema,
  caseStatusUpdatedMetaSchema,
  caseUpdatedFieldsMetaSchema,
  caseUpdatedTagsMetaSchema,
} from './cases.js';
import { eventNameSchema, type EventName } from './event-names.js';
import { fileResourceSchema } from './files.js';
import { anyIdSchema, idSchema } from './ids.js';
import { inquiryCompletedMetaSchema, inquiryResourceSchema } from './inquiries.js';
import { connectionResourceSchema, shareTokenResourceSchema } from './connect.js';
import { consentRecordResourceSchema } from './consent-records.js';
import { deploymentResourceSchema } from './deployments.js';
import { inquiryTemplateVersionEventResourceSchema } from './template-version-events.js';
import { inquirySessionResourceSchema } from './inquiry-sessions.js';
import { selfieCaptureResourceSchema } from './selfie-captures.js';
import { REPORT_RESOURCE_TYPES } from './report-types.js';
import { REPORT_RESOURCE_SCHEMAS } from './reports.js';
import {
  listDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toTimestamp,
} from './json-api.js';
import { booleanFilterSchema, filterListSchema, listQuerySchema } from './list-filters.js';
import { inquiryDeclinedMetaSchema } from './decisions.js';
import { deviceResourceSchema } from './devices.js';
import { graphQueryResourceSchema } from './graph-queries.js';
import { LIST_RESOURCE_SCHEMAS, listMatchResourceSchema, listUpdatedMetaSchema } from './lists.js';
import {
  transactionRelationMetaSchema,
  transactionResourceSchema,
  transactionTypeConvertedFieldMetaSchema,
  transactionTypeDeletedFieldMetaSchema,
  transactionTypeResourceSchema,
} from './transactions.js';
import { networkResourceSchema } from './networks.js';
import {
  workflowRunErroredEventMetaSchema,
  workflowRunEventMetaSchema,
  workflowRunResourceSchema,
} from './workflow-runs.js';
import { workflowResourceSchema, workflowVersionResourceSchema } from './workflows.js';
import { VERIFICATION_RESOURCE_TYPES } from './verification-types.js';
import { VERIFICATION_RESOURCE_SCHEMAS } from './verifications.js';

/** The ID prefix of each resource type a stored event payload can carry. */
const PREFIX_BY_SUBJECT_TYPE: Readonly<Record<string, string>> = {
  inquiry: 'inq',
  'inquiry-session': 'iqse',
  // C50.6: every verification type.
  ...Object.fromEntries(VERIFICATION_RESOURCE_TYPES.map((type) => [type, 'ver'])),
  account: 'acc',
  selfie: 'self',
  // C70.4: every report type.
  ...Object.fromEntries(REPORT_RESOURCE_TYPES.map((type) => [type, 'rep'])),
  // C99.3 (Workflow 7B).
  'list-match': 'lmt',
  // C105.5 (Workflow 7B).
  transaction: 'txn',
  // C102.7 (Workflow 7B).
  'graph-query': 'grphq',
  // C120.9 (Workflow 8A).
  'workflow-run': 'wfr',
  // C139.1 (Workflow 8B).
  case: 'case',
  'case-comment': 'cscm',
};

/**
 * What a stored event payload becomes once its subject is redacted (C16):
 * `{ data: { type, id, attributes: { redacted-at } } }`.
 */
export const redactedResourceStubSchema = z
  .strictObject({
    type: z.enum([
      'inquiry',
      'inquiry-session',
      ...VERIFICATION_RESOURCE_TYPES,
      'account',
      'selfie',
      ...REPORT_RESOURCE_TYPES,
      'list-match',
      'transaction',
      'graph-query',
      'workflow-run',
      'case',
      'case-comment',
    ]),
    id: anyIdSchema,
    attributes: z.strictObject({ 'redacted-at': timestampSchema }),
  })
  .refine((stub) => stub.id.startsWith(`${PREFIX_BY_SUBJECT_TYPE[stub.type] ?? ''}_`), {
    message: 'the id does not belong to the resource type',
    path: ['id'],
  });
export type RedactedResourceStub = z.infer<typeof redactedResourceStubSchema>;

/** `payload.meta` of `inquiry.transitioned` (C10). */
export const inquiryTransitionMetaSchema = z.strictObject({
  from: inquiryStatusSchema,
  to: inquiryStatusSchema,
});

/**
 * C70.4: `payload.meta` of `report/<type>.dismissed`: the matches the dismissal closed (`rpm_`
 * ids, never the reason).
 */
export const reportDismissedMetaSchema = z.strictObject({
  'match-ids': z.array(idSchema('rpm')).min(1),
});

/**
 * C70.4: `payload.meta` of `report/<type>.reviewed`, the public review context without its
 * comment (PII, C70.3): the review, the match (`record-token`, null for `all_records`) and the
 * reviewer (`usr_` or `key_`).
 */
export const reportReviewedMetaSchema = z.strictObject({
  'review-type': reportReviewTypeSchema,
  'review-status': reportReviewStatusSchema,
  'risk-level': reportRiskLevelSchema.nullable(),
  'record-token': idSchema('rpm').nullable(),
  reviewer: z.union([idSchema('usr'), idSchema('key')]),
});

/** The payload an event is created with. */
export const eventPayloadSchema = z.strictObject({
  /** The resource the event is about. */
  data: z.discriminatedUnion('type', [
    inquiryResourceSchema,
    ...VERIFICATION_RESOURCE_SCHEMAS,
    inquirySessionResourceSchema,
    accountResourceSchema,
    selfieCaptureResourceSchema,
    // C70.4 (Phase 6): every report type.
    ...REPORT_RESOURCE_SCHEMAS,
    // C99.3 (Workflow 7B).
    listMatchResourceSchema,
    // C105.3, C104.6 (Workflow 7B).
    transactionResourceSchema,
    transactionTypeResourceSchema,
    // C102.5 (Workflow 7B).
    graphQueryResourceSchema,
    // C112.7, C127.12 (Workflow 8A).
    workflowResourceSchema,
    workflowVersionResourceSchema,
    workflowRunResourceSchema,
    ...LIST_RESOURCE_SCHEMAS,
    // C129.6 (Workflow 8B).
    caseResourceSchema,
    caseCommentResourceSchema,
    caseTemplateResourceSchema,
    // C154.8 (Workflow 9A): a version's summary, and a deployment.
    inquiryTemplateVersionEventResourceSchema,
    deploymentResourceSchema,
    // C239.2 (Workflow 11A): the resource as the receiving side sees it, never shared data.
    connectionResourceSchema,
    shareTokenResourceSchema,
    consentRecordResourceSchema,
  ]),
  included: z
    .array(
      z.discriminatedUnion('type', [
        inquiryResourceSchema,
        ...VERIFICATION_RESOURCE_SCHEMAS,
        fileResourceSchema,
        inquirySessionResourceSchema,
        accountResourceSchema,
        selfieCaptureResourceSchema,
        // C91.2, C91.3 (Phase 7): a session event's device and network row.
        deviceResourceSchema,
        networkResourceSchema,
      ]),
    )
    .optional(),
  /** Event-specific details, such as `{ from, to }` on `inquiry.transitioned`. */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type EventPayload = z.infer<typeof eventPayloadSchema>;

/** The payload of an event whose subject was redacted (C16). */
export const redactedEventPayloadSchema = z.strictObject({ data: redactedResourceStubSchema });
export type RedactedEventPayload = z.infer<typeof redactedEventPayloadSchema>;

/** What an event carries: its payload, or the stub that replaces it after redaction. */
export const storedEventPayloadSchema = z.union([eventPayloadSchema, redactedEventPayloadSchema]);
export type StoredEventPayload = z.infer<typeof storedEventPayloadSchema>;

/**
 * Whether a payload resource type fits an event: the event's subject (the part of its name
 * before the dot) is the resource type, `verification` covers every `verification/*` and `list`
 * every `list/*` (C127.12); a `report/<type>.<action>` name carries exactly `report/<type>` (C70.4).
 * Never throws, so it is safe inside a refinement.
 */
function payloadFitsName(name: string, type: string): boolean {
  const subject = name.slice(0, name.indexOf('.'));
  return subject === 'verification' || subject === 'list'
    ? type.startsWith(`${subject}/`)
    : type === subject;
}

/** C70.4: a report `.dismissed` or `.reviewed` event carries its meta, unless redacted. */
function reportMetaFits(name: string, payload: StoredEventPayload): boolean {
  if (!name.startsWith('report/') || redactedEventPayloadSchema.safeParse(payload).success) {
    return true;
  }
  const meta = 'meta' in payload ? payload.meta : undefined;
  if (name.endsWith('.dismissed')) {
    return reportDismissedMetaSchema.safeParse(meta).success;
  }
  if (name.endsWith('.reviewed')) {
    return reportReviewedMetaSchema.safeParse(meta).success;
  }
  return true;
}

/**
 * Rule 11 of Workflow 7B (C107.5): an event never carries a list value, a dismissal's reason, a
 * graph value or a transaction's field values, so a stored event or a webhook has none to leak. The
 * subject's own route serves them, under its scope and `pii:view`. C112.7 and C125.5 hold a run's
 * values to the same rule, and a version's definition, which only `workflows:read` reads; C136.4 and
 * C134.1 hold a case's fields and a comment's message to it, and C135 an attachment's filename.
 */
function carriesNoValue(payload: StoredEventPayload): boolean {
  const attributes = payload.data.attributes as Readonly<Record<string, unknown>>;
  switch (payload.data.type) {
    case 'list-match':
      return (attributes['matched-value'] ?? null) === null && (attributes.reason ?? null) === null;
    case 'transaction':
      return (attributes.fields ?? null) === null;
    case 'graph-query':
      return (
        (attributes.params ?? null) === null &&
        ((attributes.nodes ?? []) as readonly unknown[]).length === 0 &&
        ((attributes.links ?? []) as readonly unknown[]).length === 0
      );
    case 'workflow-run':
      return (
        (attributes.inputs ?? null) === null &&
        (attributes.variables ?? null) === null &&
        (attributes.outputs ?? null) === null &&
        (attributes['trigger-snapshot'] ?? null) === null
      );
    case 'workflow-version':
      return (attributes.definition ?? null) === null;
    case 'case':
      // C135, C143.5 (the (F) family): an attachment's filename is PII too.
      return (
        (attributes.fields ?? null) === null &&
        ((attributes.attachments ?? []) as readonly { filename?: unknown }[]).every(
          ({ filename }) => (filename ?? null) === null,
        )
      );
    case 'case-comment':
      return (attributes.message ?? null) === null;
    // C239.2, C239.5 (Workflow 11A; rule 11): a share token's event never carries a peek; a consent
    // record's never carries its evidence reference, address, user agent or text; a connection's
    // never carries the agreement reference.
    case 'connect/share-token':
      return attributes['source-data'] === undefined;
    case 'consent-record':
      return (
        (attributes['evidence-reference'] ?? null) === null &&
        (attributes['ip-address'] ?? null) === null &&
        (attributes['user-agent'] ?? null) === null &&
        (attributes['text-body'] ?? null) === null
      );
    case 'connect/connection':
      return (attributes['agreement-reference'] ?? null) === null;
    default:
      return true;
  }
}

/** C105.3, C104.6, C112.7, C127.12, C128.1: the events that carry a meta of their own, unless redacted. */
const EVENT_META: Readonly<Record<string, z.ZodType>> = {
  // Optional, because a simulated decline writes no record (decision 77).
  'inquiry.declined': inquiryDeclinedMetaSchema.optional(),
  // C151.13 (Workflow 9A; a C5 amendment): optional, so an event stored before 9A still parses.
  'inquiry.completed': inquiryCompletedMetaSchema.optional(),
  'workflow-run.created': workflowRunEventMetaSchema,
  'workflow-run.resumed': workflowRunEventMetaSchema,
  'workflow-run.errored': workflowRunErroredEventMetaSchema,
  'workflow-run.completed': workflowRunEventMetaSchema,
  'workflow-run.canceled': workflowRunEventMetaSchema,
  'list.updated': listUpdatedMetaSchema,
  'transaction.added-relation': transactionRelationMetaSchema,
  'transaction.removed-relation': transactionRelationMetaSchema,
  'transaction-type.deleted-field': transactionTypeDeletedFieldMetaSchema,
  'transaction-type.converted-field': transactionTypeConvertedFieldMetaSchema,
  'case.status-updated': caseStatusUpdatedMetaSchema,
  'case.updated-fields': caseUpdatedFieldsMetaSchema,
  'case.updated-tags': caseUpdatedTagsMetaSchema,
  'case.exported': caseExportedMetaSchema,
  'case-template.deleted-field': caseTemplateDeletedFieldMetaSchema,
};

function eventMetaFits(name: string, payload: StoredEventPayload): boolean {
  const schema = EVENT_META[name];
  if (schema === undefined || redactedEventPayloadSchema.safeParse(payload).success) {
    return true;
  }
  return schema.safeParse('meta' in payload ? payload.meta : undefined).success;
}

export const eventAttributesSchema = z
  .strictObject({
    name: eventNameSchema,
    payload: storedEventPayloadSchema,
    /** C14: true for events made by `POST /webhooks/:id/simulate`. Servers since Phase 2 send it. */
    simulated: z.boolean().optional(),
    'created-at': timestampSchema,
  })
  .refine(({ name, payload }) => payloadFitsName(name, payload.data.type), {
    message: 'the payload resource does not match the event name',
    path: ['payload', 'data', 'type'],
  })
  .refine(
    ({ name, payload }) =>
      name !== 'inquiry.transitioned' ||
      redactedEventPayloadSchema.safeParse(payload).success ||
      ('meta' in payload && inquiryTransitionMetaSchema.safeParse(payload.meta).success),
    {
      message: 'inquiry.transitioned carries payload.meta { from, to }',
      path: ['payload', 'meta'],
    },
  )
  .refine(({ name, payload }) => reportMetaFits(name, payload), {
    message: 'report .dismissed and .reviewed events carry their meta (C70.4)',
    path: ['payload', 'meta'],
  })
  .refine(({ name, payload }) => eventMetaFits(name, payload), {
    message: 'this event carries its meta (C104.6, C105.3, C112.7, C127.12)',
    path: ['payload', 'meta'],
  })
  .refine(({ payload }) => carriesNoValue(payload), {
    message: 'an event carries no value of its subject (C107.5, C112.7)',
    path: ['payload', 'data', 'attributes'],
  });

export const eventResourceSchema = resourceSchema('event', 'evt', eventAttributesSchema);
export type EventResource = z.infer<typeof eventResourceSchema>;

/** `GET /api/v1/events/:id` response and webhook delivery body. */
export const eventDocumentSchema = singleDocumentSchema(eventResourceSchema);
export type EventDocument = z.infer<typeof eventDocumentSchema>;

/** `GET /api/v1/events` response. */
export const eventListDocumentSchema = listDocumentSchema(eventResourceSchema);

/**
 * `GET /api/v1/events` query (C12, scope `events:read`). `filter[simulated]` defaults to
 * `false`: simulated events are listed only on request.
 */
export const listEventsQuerySchema = listQuerySchema('evt', {
  'filter[name]': filterListSchema(eventNameSchema).optional(),
  /** The id of the payload's resource. */
  'filter[object-id]': anyIdSchema.optional(),
  'filter[simulated]': booleanFilterSchema.optional(),
  /**
   * C25.7 (Workflow 2E): events whose subject is the inquiry, one of its verifications or one of
   * its inquiry sessions (comma values meaning OR), for the inquiry's timeline.
   */
  'filter[inquiry-id]': filterListSchema(idSchema('inq')).optional(),
});
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

export interface EventRecord {
  id: string;
  name: EventName;
  payload: StoredEventPayload;
  createdAt: Date;
  /** C14. Left out, the attribute is not sent (Phase 1 callers). */
  simulated?: boolean;
}

/**
 * Builds the event resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildEventResource(record: EventRecord): EventResource {
  return eventResourceSchema.parse({
    type: 'event',
    id: record.id,
    attributes: {
      name: record.name,
      payload: record.payload,
      ...(record.simulated === undefined ? {} : { simulated: record.simulated }),
      'created-at': toTimestamp(record.createdAt),
    },
  });
}
