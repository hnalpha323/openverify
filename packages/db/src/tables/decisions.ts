/**
 * C128.1 (Workflow 8A Stage 1b (A)): the decision record, `idec_`, one row for every approve, decline
 * and adverse step, whoever makes it, a `review` row for a mark-for-review (V17), and a `reopen` row
 * for the human review of a decline (C128.6).
 *
 * It is an accountability record (Art. 5(2), Art. 22), so redacting the subject keeps every code, id,
 * basis and flag here and nulls only `comment` (P35, V25). Its subject is polymorphic, so it has no
 * foreign key, and the record outlives whatever its subject becomes. Everything but `comment` is plain:
 * codes, ids and the operator's own text, never the subject's (a C128.1 rule, held by
 * `buildDecisionResource`'s schema for the JSON members).
 */
import {
  BIOMETRIC_BASES,
  DECISION_BASES,
  DECISION_KINDS,
  DECISION_SUBJECT_TYPES,
  INQUIRY_DECISION_ACTOR_TYPES,
  type BiometricBasis,
  type InquiryDecisionActorType,
  type DecisionBasis,
  type DecisionKind,
  type DecisionSubjectType,
} from '@openverify/core';
import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { idPattern } from '../ids.js';
import { sealedColumn } from '../sealed.js';
import {
  createdAt,
  deciderIdFormat,
  idColumnFormat,
  idFormat,
  oneOf,
  updatedAt,
} from './columns.js';
import { environmentId } from './environment-id.js';
import { LIST_ITEM_ID_PATTERN } from './lists.js';

/** The JSON members, in the shape `buildDecisionResource` reads. */
export interface DecisionRunFacts {
  workflowId: string;
  workflowVersionId: string;
  nodeId: string;
  routes: readonly { nodeId: string; routeKey: string }[];
  conditionSha256: readonly string[];
  codeSha256: readonly string[];
}

/**
 * C150.7 (Workflow 9A Stage 1b (S)): a flow failure's path, in the shape `buildDecisionResource`
 * reads: the template version, the failure step, and each branch passed with its port and `onNull`
 * (step ids and codes only, never a value).
 */
export interface DecisionFlowFacts {
  templateVersionId: string;
  failureStepId: string;
  routes: readonly { stepId: string; port: string; onNull: string | null }[];
}

export interface DecisionHumanStep {
  kind: string;
  actorId: string;
  eventId: string;
  resolvedVia: string;
  nodeId: string | null;
}

export interface DecisionEvidence {
  kind: string;
  id: string | null;
  name: string | null;
  status: string | null;
  tier: string;
  stage: string;
  confidence: number | null;
}

export interface DecisionPendingEvidence {
  kind: string;
  id: string | null;
  name: string | null;
}

export const inquiryDecisions = pgTable(
  'inquiry_decisions',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    kind: text('kind').$type<DecisionKind>().notNull(),
    subjectType: text('subject_type').$type<DecisionSubjectType>().notNull(),
    subjectId: text('subject_id').notNull(),
    actorType: text('actor_type').$type<InquiryDecisionActorType>().notNull(),
    actorId: text('actor_id').notNull(),
    /** For a run: the workflow, version, node, routes taken and digests; `null` otherwise. */
    run: jsonb('run').$type<DecisionRunFacts>(),
    /** C150.7: for a `flow-failure`, the inquiry's flow path; `null` on every other record. */
    flow: jsonb('flow').$type<DecisionFlowFacts>(),
    /** C128.2: computed at run time, or what an API caller declared; `null` if it declared none. */
    solelyAutomated: boolean('solely_automated'),
    humanStep: jsonb('human_step').$type<DecisionHumanStep>(),
    evidence: jsonb('evidence').$type<DecisionEvidence[]>().notNull().default([]),
    pendingEvidence: jsonb('pending_evidence')
      .$type<DecisionPendingEvidence[]>()
      .notNull()
      .default([]),
    decisionBasis: text('decision_basis').$type<DecisionBasis>(),
    contestRoute: jsonb('contest_route').$type<Record<string, unknown>>(),
    biometricBasis: text('biometric_basis').$type<BiometricBasis>(),
    /** Sealed to the row; `null` once its subject is redacted. */
    commentSealed: sealedColumn('comment'),
    /** C128.3: a subject that cannot be marked for review waits in the console's review list. */
    needsReview: boolean('needs_review').notNull().default(false),
    /** C128.6: open on a `reopen` row until a user decides. */
    humanReviewPending: boolean('human_review_pending').notNull().default(false),
    /** C128.3: the gate that stopped an adverse step. A code, never text. */
    errorCode: text('error_code'),
    /** C120.7: a test run's own decision. */
    testRunId: text('test_run_id'),
    /** C235.4 (Workflow 11A): whether the decision relied on a cloned result that counted. */
    reliedOnCloned: boolean('relied_on_cloned').notNull().default(false),
    /** C235.4: the share token of the clones it relied on (a handle, never a secret). */
    shareTokenId: text('share_token_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'inquiry_decisions_share_token_id_format',
      sql`${table.shareTokenId} is null or ${table.shareTokenId} ~ '^cnst_[0-9A-HJKMNP-TV-Z]{26}$'`,
    ),
    check(
      'inquiry_decisions_relied_on_cloned_token',
      sql`not ${table.reliedOnCloned} or ${table.shareTokenId} is not null`,
    ),
    // `GET /decisions?filter[subject-id]=` and the `decisions` include, newest first.
    index('inquiry_decisions_subject_created_at_idx').on(
      table.environmentId,
      table.subjectId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // C128.3: the console's review list.
    index('inquiry_decisions_needs_review_idx')
      .on(table.environmentId, table.createdAt.desc().nullsFirst())
      .where(sql`${table.needsReview}`),
    // C128.6: `inquiryDecisionGuardInTx` reads this, and one review is open at a time.
    uniqueIndex('inquiry_decisions_one_review_pending_idx')
      .on(table.environmentId, table.subjectId)
      .where(sql`${table.humanReviewPending}`),
    idFormat('inquiry_decisions', table.id, 'idec'),
    check('inquiry_decisions_kind_valid', oneOf(table.kind, DECISION_KINDS)),
    check('inquiry_decisions_subject_type_valid', oneOf(table.subjectType, DECISION_SUBJECT_TYPES)),
    check(
      'inquiry_decisions_subject_id_format',
      sql`(${table.subjectType} = 'inquiry' and ${table.subjectId} ~ ${sql.raw(`'${idPattern('inq')}'`)})
        or (${table.subjectType} = 'transaction' and ${table.subjectId} ~ ${sql.raw(`'${idPattern('txn')}'`)})
        or (${table.subjectType} = 'account' and ${table.subjectId} ~ ${sql.raw(`'${idPattern('acc')}'`)})
        or (${table.subjectType} = 'list-item' and ${table.subjectId} ~ ${sql.raw(`'${LIST_ITEM_ID_PATTERN}'`)})
        or ${table.subjectType} not in ('inquiry', 'transaction', 'account', 'list-item')`,
    ),
    // C150.7 (Workflow 9A): an inquiry's own flow decides it, named by the inquiry's id.
    check(
      'inquiry_decisions_actor_type_valid',
      oneOf(table.actorType, INQUIRY_DECISION_ACTOR_TYPES),
    ),
    deciderIdFormat('inquiry_decisions_actor_id_format', table.actorType, table.actorId, [
      ['inquiry-flow', 'inq'],
    ]),
    check('inquiry_decisions_decision_basis_valid', oneOf(table.decisionBasis, DECISION_BASES)),
    check('inquiry_decisions_biometric_basis_valid', oneOf(table.biometricBasis, BIOMETRIC_BASES)),
    check(
      'inquiry_decisions_human_step_is_not_automated',
      sql`${table.humanStep} is null or ${table.solelyAutomated} is false`,
    ),
    check(
      'inquiry_decisions_pending_is_reopen',
      sql`not ${table.humanReviewPending} or ${table.kind} = 'reopen'`,
    ),
    check('inquiry_decisions_evidence_array', sql`jsonb_typeof(${table.evidence}) = 'array'`),
    // C150.7 (Workflow 9A Stage 1b (S)): a flow failure carries its path, and nothing else does.
    check(
      'inquiry_decisions_flow_coherent',
      sql`(${table.kind} = 'flow-failure') = (${table.flow} is not null and jsonb_typeof(${table.flow}) = 'object')`,
    ),
    check(
      'inquiry_decisions_pending_evidence_array',
      sql`jsonb_typeof(${table.pendingEvidence}) = 'array'`,
    ),
    check(
      'inquiry_decisions_contest_route_object',
      sql`${table.contestRoute} is null or jsonb_typeof(${table.contestRoute}) = 'object'`,
    ),
    check(
      'inquiry_decisions_error_code_format',
      sql`${table.errorCode} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    idColumnFormat('inquiry_decisions_test_run_id_format', table.testRunId, 'wfr'),
  ],
);

export type InquiryDecisionRow = typeof inquiryDecisions.$inferSelect;
