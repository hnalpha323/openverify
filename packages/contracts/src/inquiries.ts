/** Inquiry resource, request bodies and queries (contracts C2, C10 and C13). */
import {
  INQUIRY_LIST_MATCH_FILTERS,
  checkStatusSchema,
  inquiryStatusSchema,
  type InquiryStatus,
} from '@openverify/core';
import { z } from 'zod';
import { provenanceSchema } from './provenance.js';
import { parseFlowUrlFragment, safeUrl } from './flow-url.js';
import { idSchema } from './ids.js';
import {
  accountIdentifierSchema,
  referenceIdSchema,
  inquiryTemplateIdentifierSchema,
  inquiryTemplateVersionIdentifierSchema,
  verificationIdentifierSchema,
  transactionIdentifierSchema,
} from './identifiers.js';
import { selfieCaptureIdentifierSchema, selfieCaptureResourceSchema } from './selfie-captures.js';
import { decisionResourceSchema } from './decisions.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceWithRelationshipsSchema,
  timestampSchema,
  toManyRelationshipSchema,
  toNullableTimestamp,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';
import { tagInputSchema, tagsSchema } from './tags.js';
import { sessionTokenSchema } from './tokens.js';
import { MAX_EXPIRATION_SECONDS, MIN_EXPIRATION_SECONDS } from './template-settings.js';
import { redirectUriSchema } from './inquiry-template-versions.js';
import {
  toVerificationResourceType,
  type SupportedVerificationType,
} from './verification-types.js';
import { VERIFICATION_RESOURCE_SCHEMAS, verificationResourceSchema } from './verifications.js';
import { listMatchResourceSchema } from './lists.js';
import { REPORT_RESOURCE_SCHEMAS } from './reports.js';
import {
  signalAttributeIssues,
  signalDetailsSchema,
  signalValueSchema,
  type SignalValue,
} from './signals.js';

/** Customer-chosen reference such as a user ID (C13); it lives with the identifiers (Phase 6). */
export { referenceIdSchema };

/** Field names follow flow-spec form field names (snake_case). */
export const INQUIRY_FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/** C149.2 (public; a C10 amendment, Workflow 9A): at most 1,000 fields, as a version declares. */
export const MAX_INQUIRY_FIELDS = 1000;

/**
 * C149.2 (ours, provisional; V17): the serialised size of `fields`, in UTF-8 bytes, past which a
 * write answers 422 `fields_too_large`. Basis: 1,000 values of up to 10,000 characters would make a
 * 10 MB sealed blob decrypted and re-encrypted on every submission (review F25).
 */
export const MAX_INQUIRY_FIELDS_BYTES = 256 * 1024;

export const inquiryFieldValueSchema = z.union([
  z.string().max(10_000),
  z.number(),
  z.boolean(),
  z.null(),
]);
export type InquiryFieldValue = z.infer<typeof inquiryFieldValueSchema>;

/** Data about the person being verified. It is PII: encrypted at rest and never logged. */
export const inquiryFieldsSchema = z
  .record(
    z.string().regex(INQUIRY_FIELD_NAME_PATTERN, 'must be a snake_case field name'),
    inquiryFieldValueSchema,
  )
  .refine((fields) => Object.keys(fields).length <= MAX_INQUIRY_FIELDS, {
    message: `at most ${String(MAX_INQUIRY_FIELDS)} fields are allowed`,
  });
export type InquiryFields = z.infer<typeof inquiryFieldsSchema>;

/** An operator's note on an inquiry (C10): at most 2,000 characters, encrypted at rest. */
export const MAX_INQUIRY_NOTE_LENGTH = 2000;
export const inquiryNoteSchema = z.string().max(MAX_INQUIRY_NOTE_LENGTH);

/**
 * C151.13 (review H09; ours): how a completion was reached, PII-free: the verification types on the
 * path, the steps whose `exhausted` fallback was taken, and flags as codes (`unverified-path`,
 * `flag_for_review:<reason>`, `on-null-review`, `scope_path_missing`, `flow_loop_limit`). Served on
 * the inquiry and in `inquiry.completed`'s `meta`, so a consumer can tell a fully verified
 * completion from one through a fallback or with no verification.
 */
export const flowOutcomeSchema = z.strictObject({
  'verification-types-on-path': z.array(z.string().max(64)).max(20),
  'fallbacks-taken': z.array(z.string().max(64)).max(20),
  flags: z.array(z.string().regex(/^[a-z][a-z0-9_:-]{0,99}$/, 'must be a code')).max(50),
});
export type FlowOutcome = z.infer<typeof flowOutcomeSchema>;

/** `payload.meta` of `inquiry.completed` (C151.13, a C5 amendment). Absent on older events. */
export const inquiryCompletedMetaSchema = z.strictObject({ 'flow-outcome': flowOutcomeSchema });

/**
 * Inquiry attributes. The Phase 2 members (C10) are optional so that Phase 1 documents, such
 * as event payloads stored before Phase 2, still validate; servers since Phase 2 always send
 * them. `fields` values and `note` are null for a user without `pii:view` (C15).
 */
export const inquiryAttributesSchema = z
  .strictObject({
    status: inquiryStatusSchema,
    'reference-id': referenceIdSchema.nullable(),
    /** PII (C15): masked member by member; marked so masking by name stays safe (C70.3). */
    fields: inquiryFieldsSchema.meta({ pii: true }),
    tags: tagsSchema.optional(),
    note: inquiryNoteSchema.nullable().optional(),
    /** Creation time plus the template's `inquiry-expiration-seconds`; null before Phase 2. */
    'expires-at': timestampSchema.nullable().optional(),
    /**
     * C151.10 (Workflow 9B, (F); 9A Stage 3 amendment 21): the windows `POST /inquiries`' `meta` set
     * for this inquiry beyond creation; `null` when its version's settings decide. Left out before.
     */
    'expiration-after-start-interval-seconds': z.int().min(1).nullable().optional(),
    'expiration-after-resume-interval-seconds': z.int().min(1).nullable().optional(),
    'one-time-link-expiration-seconds': z.int().min(1).nullable().optional(),
    'redacted-at': timestampSchema.nullable().optional(),
    /** When the inquiry was approved or declined. */
    'decisioned-at': timestampSchema.nullable().optional(),
    /**
     * C90.5 (Phase 7): the public `signals` array, in registry order, and our `signal-details`. Both
     * are optional so payloads from before Phase 7 still parse; servers since Workflow 7A send them:
     * `[]` and `{ computed-at: null }` until the signals job ran, or when the environment hides them.
     */
    signals: z.array(signalValueSchema).max(64).optional(),
    'signal-details': signalDetailsSchema.optional(),
    /**
     * C151.8 (public names; Workflow 9A): the step the person left and the step they are on (`null`
     * once ended). Each is `null` without PII visibility when that step was reached through a
     * sensitive exit (C151.1), because it can reveal a masked value (review P15).
     */
    'previous-step-name': z.string().max(64).nullable().optional(),
    'next-step-name': z.string().max(64).nullable().optional(),
    /** C151.13 (review H09): PII-free; `null` until the person's part ends. */
    'flow-outcome': flowOutcomeSchema.nullable().optional(),
    /** C158.4: the inquiry's own redirect URI, `null` when it has none. */
    'redirect-uri': z.string().max(2048).nullable().optional(),
    /** C160.7 (public): the inquiry's own theme set, `null` when it takes its version's. */
    'theme-set-id': idSchema('theset').nullable().optional(),
    /**
     * C235.1, C235.7 (Workflow 11A; ours): present only on an inquiry a Connect redemption made
     * (`connect-clone`) or filled (`connect-hydrate`). Every `inquiry.*` event about a cloned
     * inquiry carries it, so a receiver never reads a copy as the destination's own result.
     */
    provenance: provenanceSchema.optional(),
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
  })
  .superRefine((attributes, ctx) => {
    // C90.3, C90.5 (H12): the honesty rules between the two members.
    if (attributes.signals === undefined && attributes['signal-details'] === undefined) {
      return;
    }
    if (attributes.signals === undefined || attributes['signal-details'] === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'signals and signal-details go together',
        path: ['signals'],
      });
      return;
    }
    for (const issue of signalAttributeIssues(attributes.signals, attributes['signal-details'])) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
  });

export const inquiryRelationshipsSchema = z.strictObject({
  'inquiry-template': toOneRelationshipSchema(inquiryTemplateIdentifierSchema),
  /** Every attempt, oldest first: a user retry creates a new verification (C7). */
  verifications: toManyRelationshipSchema(verificationIdentifierSchema),
  /** C13. Null only for inquiries created before accounts existed. */
  account: toOneRelationshipSchema(accountIdentifierSchema.nullable()).optional(),
  /** C105.7 (Workflow 7B): the latest transaction it was attached to by `add-objects`. */
  transaction: toOneRelationshipSchema(transactionIdentifierSchema.nullable()).optional(),
  /**
   * The template version the inquiry pinned at creation (C10/C11, C25.4 Workflow 2E). Optional so
   * earlier answers still parse; servers since Workflow 2E always send it.
   */
  'inquiry-template-version': toOneRelationshipSchema(
    inquiryTemplateVersionIdentifierSchema,
  ).optional(),
  /** C40.1: the inquiry's selfie captures, newest first. Optional so earlier answers parse. */
  selfies: toManyRelationshipSchema(selfieCaptureIdentifierSchema).optional(),
});

export const inquiryResourceSchema = resourceWithRelationshipsSchema(
  'inquiry',
  'inq',
  inquiryAttributesSchema,
  inquiryRelationshipsSchema,
);
export type InquiryResource = z.infer<typeof inquiryResourceSchema>;

/** `GET /api/v1/inquiries/:id`; `?include=verifications` adds them to `included`. */
export const inquiryDocumentSchema = z.strictObject({
  data: inquiryResourceSchema,
  included: z.array(verificationResourceSchema).optional(),
});
export type InquiryDocument = z.infer<typeof inquiryDocumentSchema>;

/**
 * `GET /api/v1/inquiries/:id` with any `include` (C40.1, Workflow 4A Stage 3): `verifications`
 * and `selfies` (the inquiry's captures, newest first) add those resources to `included`. Every
 * {@link InquiryDocument} is one.
 */
export const inquiryIncludeDocumentSchema = z.strictObject({
  data: inquiryResourceSchema,
  included: z
    .array(
      z.discriminatedUnion('type', [
        ...VERIFICATION_RESOURCE_SCHEMAS,
        selfieCaptureResourceSchema,
        // C70.5 (Phase 6): the inquiry's reports, newest first, at most 50.
        ...REPORT_RESOURCE_SCHEMAS,
        // C107.6 (Workflow 7B): the inquiry's list matches.
        listMatchResourceSchema,
        // C128.1 (Workflow 8A): the inquiry's decisions, its comments masked.
        decisionResourceSchema,
      ]),
    )
    .optional(),
});
export type InquiryIncludeDocument = z.infer<typeof inquiryIncludeDocumentSchema>;

export const inquiryListDocumentSchema = listDocumentSchema(inquiryResourceSchema);
export type InquiryListDocument = z.infer<typeof inquiryListDocumentSchema>;

export const createInquiryAttributesSchema = z.strictObject({
  'inquiry-template-id': idSchema('itmpl'),
  'reference-id': referenceIdSchema.optional(),
  fields: inquiryFieldsSchema.optional().meta({ pii: true }),
  /**
   * C13: the inquiry's account, in the same environment. Without it, `reference-id` finds or
   * creates the account, and otherwise a new account is created.
   */
  'account-id': idSchema('acc').optional(),
  /**
   * C158.4 (public; Workflow 9A): where the flow sends the person on completion, checked against the
   * environment's allowed redirect origins and the version's schemes (`redirect_uri_not_allowed`).
   */
  'redirect-uri': redirectUriSchema.optional(),
  /**
   * C160.7 (public): the inquiry's theme set, an active set of the environment (checked by the API),
   * before the version's and the environment's default.
   */
  'theme-set-id': idSchema('theset').optional(),
});
export type CreateInquiryAttributes = z.infer<typeof createInquiryAttributesSchema>;

const expirySeconds = z.int().min(MIN_EXPIRATION_SECONDS).max(MAX_EXPIRATION_SECONDS);

/**
 * C151.10 (public `meta` names; Workflow 9A): this inquiry's expiry windows, within C11's bounds,
 * overriding its version's settings. Semantics the public sources leave open are ours.
 */
export const createInquiryMetaSchema = z.strictObject({
  'expiration-after-create-interval-seconds': expirySeconds.optional(),
  'expiration-after-start-interval-seconds': expirySeconds.optional(),
  'expiration-after-resume-interval-seconds': expirySeconds.optional(),
  'one-time-link-expiration-seconds': expirySeconds.optional(),
  /**
   * C238.5 (Phase 11, Workflow 11A; ours): client-side redemption. A share token inbound to the
   * caller's environment, `created` and unexpired, reserved for this inquiry (one inquiry per token,
   * 409 `share_token_in_use`); the template must hold a destination-side `share_consent` step (422
   * `share_consent_step_missing`). Needs `connect-share-tokens:redeem` besides `inquiries:write`.
   * The token never appears in a URL, a client view or a flow request.
   */
  'share-token-id': idSchema('cnst').optional(),
});

/** `POST /api/v1/inquiries` body. The inquiry starts in status `created`. */
export const createInquiryBodySchema = z.strictObject({
  data: z.strictObject({
    type: z.literal('inquiry').optional(),
    attributes: createInquiryAttributesSchema,
  }),
  meta: createInquiryMetaSchema.optional(),
});
export type CreateInquiryBody = z.infer<typeof createInquiryBodySchema>;

/**
 * What `GET /api/v1/inquiries/:id` can include, alone or comma-separated (C40.1); `reports`
 * (C70.5) needs `reports:read`, `list-matches` (C107.6) needs `lists:read`, and `decisions` (C128.1)
 * only the route's own `inquiries:read`.
 */
export const INQUIRY_INCLUDES = [
  'verifications',
  'selfies',
  'reports',
  'list-matches',
  'decisions',
] as const;
export const inquiryIncludeSchema = z.enum(INQUIRY_INCLUDES);
export type InquiryInclude = z.infer<typeof inquiryIncludeSchema>;

/** `GET /api/v1/inquiries/:id` query. */
export const getInquiryQuerySchema = z.strictObject({
  include: filterListSchema(inquiryIncludeSchema, INQUIRY_INCLUDES.length).optional(),
});

/**
 * `PATCH /api/v1/inquiries/:id` body (C10). `fields` are merged and change only while the
 * inquiry is `created` or `pending`; `null` clears the reference id or the note.
 */
export const updateInquiryBodySchema = requestDocumentSchema(
  'inquiry',
  z
    .strictObject({
      fields: inquiryFieldsSchema.optional().meta({ pii: true }),
      'reference-id': referenceIdSchema.nullable().optional(),
      note: inquiryNoteSchema.nullable().optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateInquiryBody = z.infer<typeof updateInquiryBodySchema>;

/**
 * `GET /api/v1/inquiries` query (also used by the dashboard list). Filters take
 * comma-separated values meaning OR (C9), except `reference-id`, whose values may contain
 * commas.
 */
export const listInquiriesQuerySchema = listQuerySchema('inq', {
  'filter[status]': filterListSchema(inquiryStatusSchema).optional(),
  'filter[reference-id]': referenceIdSchema.optional(),
  'filter[account-id]': filterListSchema(idSchema('acc')).optional(),
  'filter[inquiry-template-id]': filterListSchema(idSchema('itmpl')).optional(),
  'filter[tag]': filterListSchema(tagInputSchema).optional(),
  /**
   * C165.3 (Workflow 9B; K10), over Phase 7's screenings (`INQUIRY_LIST_MATCH_FILTERS`): `matched`
   * an open list match, `not-matched` a completed screening with none, `unscreened` a pending,
   * partial or errored screening with none; an inquiry with no screening matches none.
   */
  'filter[list-match]': z.enum(INQUIRY_LIST_MATCH_FILTERS).optional(),
  /** C165.3: an open match on that list. */
  'filter[list-id]': idSchema('lst').optional(),
  /** C165.3 (the public filter by a check's outcome): `filter[check-status]` comes with it. */
  'filter[check]': z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,79}$/)
    .optional(),
  'filter[check-status]': checkStatusSchema.optional(),
  /**
   * C165.3, C151.8 (review P15): the step the inquiry is on; needs PII visibility, because the
   * step reached can reveal a masked value, and is personal data in a saved view.
   */
  'filter[next-step-name]': z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,63}$/)
    .optional(),
}).refine(
  (query) =>
    (query['filter[check]'] === undefined) === (query['filter[check-status]'] === undefined),
  { message: 'filter[check] takes filter[check-status]', path: ['filter[check-status]'] },
);
export type ListInquiriesQuery = z.infer<typeof listInquiriesQuerySchema>;

/** Credentials in a flow URL's fragment, or `null` when it is malformed or has a query. */
function flowUrlCredentials(flowUrl: string) {
  const url = safeUrl(flowUrl);
  return url?.search === '' ? parseFlowUrlFragment(url.hash) : null;
}

/**
 * `meta` of `POST /api/v1/inquiries/:id/resume`. The flow URL carries the same token in its
 * fragment and has no query string, so the token never reaches a server log or `Referer`.
 */
export const inquirySessionMetaSchema = z
  .strictObject({
    'session-token': sessionTokenSchema,
    'flow-url': z.url({ protocol: /^https?$/ }),
  })
  .refine((meta) => flowUrlCredentials(meta['flow-url'])?.sessionToken === meta['session-token'], {
    message: 'the flow URL must carry the session token in its fragment',
    path: ['flow-url'],
  });
export type InquirySessionMeta = z.infer<typeof inquirySessionMetaSchema>;

export const resumeInquiryDocumentSchema = z
  .strictObject({ data: inquiryResourceSchema, meta: inquirySessionMetaSchema })
  .refine(({ data, meta }) => flowUrlCredentials(meta['flow-url'])?.inquiryId === data.id, {
    message: 'the flow URL must name this inquiry',
    path: ['meta', 'flow-url'],
  });
export type ResumeInquiryDocument = z.infer<typeof resumeInquiryDocumentSchema>;

/**
 * An inquiry as the API stores it. The Phase 2 members are optional so Phase 1 callers keep
 * compiling; a member that is left out is not sent, and one that is present (even `null`) is.
 */
export interface InquiryRecord {
  id: string;
  status: InquiryStatus;
  referenceId: string | null;
  fields: Record<string, InquiryFieldValue>;
  inquiryTemplateId: string;
  /** Oldest first. */
  verifications: readonly { id: string; type: SupportedVerificationType }[];
  createdAt: Date;
  updatedAt: Date;
  tags?: readonly string[];
  /** `null` when there is none or the caller may not see it. */
  note?: string | null;
  expiresAt?: Date | null;
  /** C151.10 (Workflow 9B): the per-inquiry windows; each left out is not sent. */
  expirationAfterStartSeconds?: number | null;
  expirationAfterResumeSeconds?: number | null;
  oneTimeLinkExpirationSeconds?: number | null;
  redactedAt?: Date | null;
  decisionedAt?: Date | null;
  accountId?: string | null;
  /** C105.7 (Workflow 7B): left out, the relationship is not sent. */
  transactionId?: string | null;
  /** C25.4: the template version the inquiry pinned. Left out, the relationship is not sent. */
  inquiryTemplateVersionId?: string;
  /** C40.1: the inquiry's selfie captures, newest first. Left out, the relationship is not sent. */
  selfieCaptureIds?: readonly string[];
  /**
   * C90.5 (Phase 7): the stored signals and their details, as the principal may see them. Left
   * out, neither attribute is sent (payloads from before Phase 7).
   */
  signals?: readonly SignalValue[];
  signalDetails?: Readonly<Record<string, unknown>>;
  /**
   * C151.8 (Workflow 9A): the step the flow left and the step the person is on, each `null` when
   * none or hidden from the reader. Left out, the attribute is not sent.
   */
  previousStepName?: string | null;
  nextStepName?: string | null;
  /** C151.13 (Workflow 9A): the PII-free flow outcome. Left out, the attribute is not sent. */
  flowOutcome?: FlowOutcome | null;
}

/** C105.7: the `transaction` relationship of an object that carries one. */
export function transactionRelationship(transactionId: string | null | undefined) {
  return transactionId === undefined
    ? {}
    : {
        transaction: {
          data: transactionId === null ? null : { type: 'transaction', id: transactionId },
        },
      };
}

function phase2Attributes(record: InquiryRecord): Record<string, unknown> {
  return {
    ...(record.tags === undefined ? {} : { tags: [...record.tags] }),
    ...(record.note === undefined ? {} : { note: record.note }),
    ...(record.expiresAt === undefined
      ? {}
      : { 'expires-at': toNullableTimestamp(record.expiresAt) }),
    ...(record.expirationAfterStartSeconds === undefined
      ? {}
      : { 'expiration-after-start-interval-seconds': record.expirationAfterStartSeconds }),
    ...(record.expirationAfterResumeSeconds === undefined
      ? {}
      : { 'expiration-after-resume-interval-seconds': record.expirationAfterResumeSeconds }),
    ...(record.oneTimeLinkExpirationSeconds === undefined
      ? {}
      : { 'one-time-link-expiration-seconds': record.oneTimeLinkExpirationSeconds }),
    ...(record.redactedAt === undefined
      ? {}
      : { 'redacted-at': toNullableTimestamp(record.redactedAt) }),
    ...(record.decisionedAt === undefined
      ? {}
      : { 'decisioned-at': toNullableTimestamp(record.decisionedAt) }),
  };
}

/**
 * Builds the inquiry resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildInquiryResource(record: InquiryRecord): InquiryResource {
  const { accountId, inquiryTemplateVersionId: versionId } = record;
  return inquiryResourceSchema.parse({
    type: 'inquiry',
    id: record.id,
    attributes: {
      status: record.status,
      'reference-id': record.referenceId,
      fields: record.fields,
      ...phase2Attributes(record),
      ...(record.signals === undefined
        ? {}
        : { signals: record.signals.map((signal) => ({ ...signal })) }),
      ...(record.signalDetails === undefined ? {} : { 'signal-details': record.signalDetails }),
      ...(record.previousStepName === undefined
        ? {}
        : { 'previous-step-name': record.previousStepName }),
      ...(record.nextStepName === undefined ? {} : { 'next-step-name': record.nextStepName }),
      ...(record.flowOutcome === undefined ? {} : { 'flow-outcome': record.flowOutcome }),
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
    relationships: {
      'inquiry-template': { data: { type: 'inquiry-template', id: record.inquiryTemplateId } },
      verifications: {
        data: record.verifications.map(({ id, type }) => ({
          type: toVerificationResourceType(type),
          id,
        })),
      },
      ...(accountId === undefined
        ? {}
        : { account: { data: accountId === null ? null : { type: 'account', id: accountId } } }),
      ...transactionRelationship(record.transactionId),
      ...(versionId === undefined
        ? {}
        : {
            'inquiry-template-version': {
              data: { type: 'inquiry-template-version', id: versionId },
            },
          }),
      ...(record.selfieCaptureIds === undefined
        ? {}
        : { selfies: { data: record.selfieCaptureIds.map((id) => ({ type: 'selfie', id })) } }),
    },
  });
}
