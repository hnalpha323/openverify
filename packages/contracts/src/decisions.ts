/**
 * The decision record (plan C128; Article 22 GDPR): one row, `idec_`, for every approve, decline and
 * adverse step, whoever makes it, a `review` row for a mark-for-review, and a `reopen` row for the
 * human review of a decline. Served as `GET /api/v1/decisions?filter[subject-id]=` under the subject's
 * read scope (V10), as the `decisions` include of an inquiry under `inquiries:read`, and in part as
 * `meta.decision` on `inquiry.declined` (P40). A simulated decision writes none (decision 77).
 *
 * What it keeps is an accountability record, so its evidence is codes and ids only. Redacting the
 * subject keeps everything here and nulls `comment` (P35, V25), the one sealed, PII member, which
 * reads `null` without PII visibility (P19).
 *
 * This file imports no resource, so `inquiries.ts`, `events.ts`, the type contracts and the flow can
 * all read it.
 */
import {
  SIGNAL_TIERS,
  biometricBasisSchema,
  checkStageSchema,
  decisionBasisSchema,
  decisionEvidenceKindSchema,
  decisionHumanStepKindSchema,
  decisionKindSchema,
  decisionPendingEvidenceKindSchema,
  decisionResolvedViaSchema,
} from '@openverify/core';
import { onNullSchema, portSchema, stepIdSchema as flowStepIdSchema } from '@openverify/flow-spec';
import { z } from 'zod';
import {
  accountIdentifierSchema,
  listItemIdentifierSchema,
  transactionIdentifierSchema,
} from './identifiers.js';
import { anyIdSchema, idSchema } from './ids.js';
import {
  listDocumentSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toTimestamp,
} from './json-api.js';
import { listQuerySchema } from './list-filters.js';

const NO_CONTROL_CHARACTERS = /^\P{Cc}+$/u;

const httpsUrlSchema = z.url({ protocol: /^https$/ }).max(2048);

/**
 * C128.3: how a person contests a decision: an `https:` URL or a contact, optionally with a case
 * template for review requests. A case template alone is refused, because it does not reach the
 * person. Whether a URL's host is on `workflow-link-hosts` is checked at publish, where the setting
 * is known. This is the operator's text, never the subject's, so it is plain.
 */
export const contestRouteSchema = z
  .strictObject({
    url: httpsUrlSchema.optional(),
    contact: z.string().min(1).max(200).regex(NO_CONTROL_CHARACTERS).optional(),
    'case-template-id': idSchema('ctmpl').optional(),
  })
  .refine(
    ({ url, contact }) => url !== undefined || contact !== undefined,
    'a contest route reaches the person by a URL or a contact',
  );
export type ContestRoute = z.infer<typeof contestRouteSchema>;

/** C128.1: a comment, sealed in the record (P19); request bodies and action configs share this. */
export const decisionCommentSchema = z.string().min(1).max(2000);

export const decisionActorSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('user'), id: idSchema('usr') }),
  z.strictObject({ type: z.literal('api-key'), id: idSchema('key') }),
  z.strictObject({ type: z.literal('workflow-run'), id: idSchema('wfr') }),
  /** C150.7 (Phase 9): the inquiry's own flow, named by the inquiry's id; on `flow-failure` only. */
  z.strictObject({ type: z.literal('inquiry-flow'), id: idSchema('inq') }),
]);
export type DecisionActor = z.infer<typeof decisionActorSchema>;

/** C128: the four kinds of subject, a list item by its `list-item/<kind>` type. */
export const decisionSubjectIdentifierSchema = z.union([
  z.strictObject({ type: z.literal('inquiry'), id: idSchema('inq') }),
  transactionIdentifierSchema,
  accountIdentifierSchema,
  listItemIdentifierSchema,
]);
export type DecisionSubjectIdentifier = z.infer<typeof decisionSubjectIdentifierSchema>;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 digest');
const stepIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'must be a step id');
const routeKeySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/, 'must be a route key');
/** A code or an enum value, never text about a person. */
const codeSchema = z.string().regex(/^[a-z][a-z0-9_.:/-]{0,127}$/, 'must be a code');

/** C128.1: for a run, the path actually executed, with the digest of what it depended on. */
export const decisionRunSchema = z.strictObject({
  'workflow-id': idSchema('wfl'),
  'workflow-version-id': idSchema('wfv'),
  'node-id': stepIdSchema,
  routes: z.array(z.strictObject({ 'node-id': stepIdSchema, 'route-key': routeKeySchema })),
  /** Each condition the routes taken read. */
  'condition-sha256': z.array(sha256Schema),
  /** Each Evaluate Code source a decision depended on (C123.8). */
  'code-sha256': z.array(sha256Schema),
});

/**
 * C150.7 (Phase 9): for a flow failure, the template version, the failure step, and each branch
 * passed with the port it left through and the `onNull` it used: step ids and codes only, never a
 * value. `null` on every record a flow did not make.
 */
export const decisionFlowSchema = z.strictObject({
  'template-version-id': idSchema('itmplv'),
  'failure-step-id': flowStepIdSchema,
  routes: z.array(
    z.strictObject({
      'step-id': flowStepIdSchema,
      port: portSchema,
      'on-null': onNullSchema.nullable(),
    }),
  ),
});
export type DecisionFlow = z.infer<typeof decisionFlowSchema>;

/** C128.2: the person who took part, named by id, never by what the case says. */
export const decisionHumanStepSchema = z.strictObject({
  kind: decisionHumanStepKindSchema,
  'actor-id': idSchema('usr'),
  'event-id': idSchema('evt'),
  'resolved-via': decisionResolvedViaSchema,
  /** The wait step that read the resolution, on a run. */
  'node-id': stepIdSchema.nullable(),
});

/** C128.1 (H10): the tier, stage and confidence of an input; an H-tier one needs all three. */
const decisionEvidenceSchema = z
  .strictObject({
    kind: decisionEvidenceKindSchema,
    id: anyIdSchema.nullable(),
    /** A check or signal name, or a list's kind: a code, never a value. */
    name: codeSchema.nullable(),
    status: codeSchema.nullable(),
    tier: z.enum(SIGNAL_TIERS),
    stage: checkStageSchema,
    confidence: z.number().min(0).max(1).nullable(),
  })
  .refine(({ id, name }) => id !== null || name !== null, 'evidence names what it was');

const decisionPendingEvidenceSchema = z.strictObject({
  kind: decisionPendingEvidenceKindSchema,
  id: anyIdSchema.nullable(),
  name: codeSchema.nullable(),
});

interface PersonFacts {
  readonly 'solely-automated': boolean | null;
  readonly 'human-step': unknown;
}

/** C128.2: a person on the path and `solely-automated: true` cannot both be so. */
const personFits = (attributes: PersonFacts): boolean =>
  attributes['human-step'] === null || attributes['solely-automated'] === false;

export const decisionAttributesSchema = z
  .strictObject({
    kind: decisionKindSchema,
    actor: decisionActorSchema,
    /** `null` unless a run made it. */
    run: decisionRunSchema.nullable(),
    /** `null` unless an inquiry's flow made it (C150.7). */
    flow: decisionFlowSchema.nullable(),
    /**
     * C128.2: computed at run time for a run. For an API decision it is what the caller declared,
     * `null` when it declared nothing.
     */
    'solely-automated': z.boolean().nullable(),
    'human-step': decisionHumanStepSchema.nullable(),
    evidence: z.array(decisionEvidenceSchema),
    'pending-evidence': z.array(decisionPendingEvidenceSchema),
    'decision-basis': decisionBasisSchema.nullable(),
    'contest-route': contestRouteSchema.nullable(),
    'biometric-basis': biometricBasisSchema.nullable(),
    /** Sealed with a row AAD; `null` without PII visibility and after redaction. */
    comment: decisionCommentSchema.nullable().meta({ pii: true }),
    /** C128.3: a subject that cannot be marked for review waits in the console's review list. */
    'needs-review': z.boolean(),
    /** C128.6: open on a `reopen` row until a user decides; runs and keys cannot decline then. */
    'human-review-pending': z.boolean(),
    /** C128.3: the gate that stopped an adverse step (`decision_basis_missing`). */
    'error-code': codeSchema.nullable(),
    /** C120.7: a test run's own decision. */
    'test-run-id': idSchema('wfr').nullable(),
    'created-at': timestampSchema,
  })
  .refine(personFits, {
    message: 'a person took part, so the decision is not solely automated',
    path: ['human-step'],
  });

export const decisionRelationshipsSchema = z.strictObject({
  subject: z.strictObject({ data: decisionSubjectIdentifierSchema }),
});

export const decisionResourceSchema = resourceWithRelationshipsSchema(
  'decision',
  'idec',
  decisionAttributesSchema,
  decisionRelationshipsSchema,
);
export type DecisionResource = z.infer<typeof decisionResourceSchema>;

export const decisionDocumentSchema = singleDocumentSchema(decisionResourceSchema);
export type DecisionDocument = z.infer<typeof decisionDocumentSchema>;
export const decisionListDocumentSchema = listDocumentSchema(decisionResourceSchema);
export type DecisionListDocument = z.infer<typeof decisionListDocumentSchema>;

/** The four subjects by id prefix; a list item's prefixes are the thirteen `li*`. */
const decisionSubjectIdSchema = anyIdSchema.refine(
  (id) => /^(?:inq|txn|acc|li[a-z]{1,3})_/.test(id),
  'must be an inquiry, transaction, account or list item id',
);

/**
 * `GET /api/v1/decisions` (C128.1, V10). The route refuses a request without `filter[subject-id]`
 * with 400 `filter_required`, as the devices route does, and needs the subject's read scope; the
 * schema keeps it optional so the refusal names the problem code.
 */
export const listDecisionsQuerySchema = listQuerySchema('idec', {
  'filter[subject-id]': decisionSubjectIdSchema.optional(),
});
export type ListDecisionsQuery = z.infer<typeof listDecisionsQuerySchema>;

/** C128.1 (P40): what a declined event says of its decision, and no more. */
export const decisionMetaSchema = z.strictObject({
  id: idSchema('idec'),
  'solely-automated': z.boolean().nullable(),
  'decision-basis': decisionBasisSchema.nullable(),
  'contest-route': contestRouteSchema.nullable(),
});
export type DecisionMeta = z.infer<typeof decisionMetaSchema>;

/** `payload.meta` of `inquiry.declined`. A simulated decline has no record, so no meta. */
export const inquiryDeclinedMetaSchema = z.strictObject({ decision: decisionMetaSchema });
export type InquiryDeclinedMeta = z.infer<typeof inquiryDeclinedMetaSchema>;

interface FlowRouteShape {
  readonly url: string | null;
  readonly host: string | null;
  readonly contact: string | null;
}

/** The host a URL's address bar shows, which is what the person is told before the link. */
const hostOf = (url: string | null): string | null => (url === null ? null : new URL(url).host);

/**
 * C128.7 (a C3 amendment): what the hosted flow shows a person on a declined inquiry. The case
 * template is the operator's and stays out of it, and a URL comes with its host, shown first.
 */
export const flowDecisionContestRouteSchema = z
  .strictObject({
    url: httpsUrlSchema.nullable(),
    host: z.string().min(1).max(253).nullable(),
    contact: z.string().min(1).max(200).regex(NO_CONTROL_CHARACTERS).nullable(),
  })
  .refine((route: FlowRouteShape) => route.url !== null || route.contact !== null, {
    message: 'a contest route shows a URL or a contact',
    path: ['url'],
  })
  .refine((route: FlowRouteShape) => route.host === hostOf(route.url), {
    message: 'the host is the host of the URL',
    path: ['host'],
  });
export type FlowDecisionContestRoute = z.infer<typeof flowDecisionContestRouteSchema>;

/** C143.5: the PII names of the decision resource and its request bodies. */
export const PII_DECISION_ATTRIBUTES: readonly string[] = Object.freeze(['comment']);

export interface DecisionRecord {
  id: string;
  kind: string;
  subject: { readonly type: string; readonly id: string };
  actor: { readonly type: string; readonly id: string };
  run: {
    workflowId: string;
    workflowVersionId: string;
    nodeId: string;
    routes: readonly { nodeId: string; routeKey: string }[];
    conditionSha256: readonly string[];
    codeSha256: readonly string[];
  } | null;
  /** C150.7: a flow failure's path; absent or `null` on every other record. */
  flow?: {
    templateVersionId: string;
    failureStepId: string;
    routes: readonly { stepId: string; port: string; onNull: string | null }[];
  } | null;
  solelyAutomated: boolean | null;
  humanStep: {
    kind: string;
    actorId: string;
    eventId: string;
    resolvedVia: string;
    nodeId: string | null;
  } | null;
  evidence: readonly {
    kind: string;
    id: string | null;
    name: string | null;
    status: string | null;
    tier: string;
    stage: string;
    confidence: number | null;
  }[];
  pendingEvidence: readonly { kind: string; id: string | null; name: string | null }[];
  decisionBasis: string | null;
  contestRoute: unknown;
  biometricBasis: string | null;
  /** Decrypted, and already masked where the reader has no PII visibility. */
  comment: string | null;
  needsReview: boolean;
  humanReviewPending: boolean;
  errorCode: string | null;
  testRunId: string | null;
  createdAt: Date;
}

/**
 * Builds a decision resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildDecisionResource(record: DecisionRecord): DecisionResource {
  return decisionResourceSchema.parse({
    type: 'decision',
    id: record.id,
    attributes: {
      kind: record.kind,
      actor: record.actor,
      run:
        record.run === null
          ? null
          : {
              'workflow-id': record.run.workflowId,
              'workflow-version-id': record.run.workflowVersionId,
              'node-id': record.run.nodeId,
              routes: record.run.routes.map(({ nodeId, routeKey }) => ({
                'node-id': nodeId,
                'route-key': routeKey,
              })),
              'condition-sha256': record.run.conditionSha256,
              'code-sha256': record.run.codeSha256,
            },
      flow:
        record.flow === undefined || record.flow === null
          ? null
          : {
              'template-version-id': record.flow.templateVersionId,
              'failure-step-id': record.flow.failureStepId,
              routes: record.flow.routes.map(({ stepId, port, onNull }) => ({
                'step-id': stepId,
                port,
                'on-null': onNull,
              })),
            },
      'solely-automated': record.solelyAutomated,
      'human-step':
        record.humanStep === null
          ? null
          : {
              kind: record.humanStep.kind,
              'actor-id': record.humanStep.actorId,
              'event-id': record.humanStep.eventId,
              'resolved-via': record.humanStep.resolvedVia,
              'node-id': record.humanStep.nodeId,
            },
      evidence: record.evidence,
      'pending-evidence': record.pendingEvidence,
      'decision-basis': record.decisionBasis,
      'contest-route': record.contestRoute,
      'biometric-basis': record.biometricBasis,
      comment: record.comment,
      'needs-review': record.needsReview,
      'human-review-pending': record.humanReviewPending,
      'error-code': record.errorCode,
      'test-run-id': record.testRunId,
      'created-at': toTimestamp(record.createdAt),
    },
    relationships: { subject: { data: record.subject } },
  });
}
