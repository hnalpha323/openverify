/**
 * The decision record's vocabularies (plan C128), in `@openverify/core` because `packages/db` reads
 * core alone. Ours: the public product publishes no such record.
 */
import { z } from 'zod';

/**
 * C128.1, C128.6: `approve` and `decline` of an inquiry, `review` for a mark-for-review, so its
 * comment has a home (V17), `reopen` for the human review of a decline, and `adverse` for every other
 * adverse step: a block-list or face-list add, an adverse transaction status, an account archived.
 */
export const DECISION_KINDS = [
  'approve',
  'decline',
  'review',
  'reopen',
  'adverse',
  // C150.7 (Phase 9; ours): an inquiry failed on a flow path that read more than a verification's
  // own outcome, a solely automated decision.
  'flow-failure',
] as const;
export const decisionKindSchema = z.enum(DECISION_KINDS);
export type DecisionKind = z.infer<typeof decisionKindSchema>;

/** C128.1: who made it. A decision always has someone behind it, so never the system. */
export const DECISION_ACTOR_TYPES = ['user', 'api-key', 'workflow-run'] as const;
export const decisionActorTypeSchema = z.enum(DECISION_ACTOR_TYPES);
export type DecisionActorType = z.infer<typeof decisionActorTypeSchema>;

/**
 * C150.7 (Phase 9): who may decide an inquiry: `DECISION_ACTOR_TYPES` and the inquiry's own flow,
 * named by its `inq_` id. Transaction reviews and device trust keep `DECISION_ACTOR_TYPES`: a flow
 * never decides them.
 */
export const INQUIRY_DECISION_ACTOR_TYPES = [...DECISION_ACTOR_TYPES, 'inquiry-flow'] as const;
export const inquiryDecisionActorTypeSchema = z.enum(INQUIRY_DECISION_ACTOR_TYPES);
export type InquiryDecisionActorType = z.infer<typeof inquiryDecisionActorTypeSchema>;

/** C128: what it was about. A list item's JSON:API type is `list-item/<kind>`. */
export const DECISION_SUBJECT_TYPES = ['inquiry', 'list-item', 'transaction', 'account'] as const;
export const decisionSubjectTypeSchema = z.enum(DECISION_SUBJECT_TYPES);
export type DecisionSubjectType = z.infer<typeof decisionSubjectTypeSchema>;

/** C128.3: the operator's declared basis. Not legal advice: the operator is the controller. */
export const DECISION_BASES = ['contract', 'law', 'explicit-consent'] as const;
export const decisionBasisSchema = z.enum(DECISION_BASES);
export type DecisionBasis = z.infer<typeof decisionBasisSchema>;

/** C128.4: a biometric adverse step's basis. */
export const BIOMETRIC_BASES = ['explicit-consent', 'substantial-public-interest'] as const;
export const biometricBasisSchema = z.enum(BIOMETRIC_BASES);
export type BiometricBasis = z.infer<typeof biometricBasisSchema>;

/** C128.2: the only human step that counts is a resolved case; a data-driven table in 8B adds it. */
export const DECISION_HUMAN_STEP_KINDS = ['case-resolution'] as const;
export const decisionHumanStepKindSchema = z.enum(DECISION_HUMAN_STEP_KINDS);
export type DecisionHumanStepKind = z.infer<typeof decisionHumanStepKindSchema>;

/** C128.2: a bulk resolution is recorded as one and never counts as a person taking part. */
export const DECISION_RESOLVED_VIA = ['single', 'bulk'] as const;
export const decisionResolvedViaSchema = z.enum(DECISION_RESOLVED_VIA);
export type DecisionResolvedVia = z.infer<typeof decisionResolvedViaSchema>;

/** C128.1: evidence is codes and ids only. */
export const DECISION_EVIDENCE_KINDS = [
  'check',
  'verification',
  'report',
  'report-match',
  'list-item',
  'list-match',
  'signal',
  // C127.10 (H21): a step whose value the decision read was a default, not a result.
  'step',
  // C150.7 (Phase 9): the facts a flow route read, each a code with its tier, never a value: an
  // extracted value, a template field, the device class, an account member, a workflow output.
  'extraction',
  'field',
  'device',
  'account',
  'workflow-output',
] as const;
export const decisionEvidenceKindSchema = z.enum(DECISION_EVIDENCE_KINDS);
export type DecisionEvidenceKind = z.infer<typeof decisionEvidenceKindSchema>;

/** C128.1 (H13): what was still pending at the decision. */
export const DECISION_PENDING_EVIDENCE_KINDS = [
  'report',
  'list-screening',
  'graph-index',
  'signal',
] as const;
export const decisionPendingEvidenceKindSchema = z.enum(DECISION_PENDING_EVIDENCE_KINDS);
export type DecisionPendingEvidenceKind = z.infer<typeof decisionPendingEvidenceKindSchema>;

/** C122.1: the default `adverse-statuses` of a transaction type (a C104 amendment). */
export const DEFAULT_TRANSACTION_ADVERSE_STATUSES: readonly string[] = Object.freeze(['declined']);
