/**
 * C128.1 (F16): the decision record of an inquiry, written in `applyInquiryAction`'s transaction,
 * before the move, so `inquiry.declined` can carry it. A simulated decision writes none (decision 77),
 * and a refused transition never gets here. A user's approve or decline closes a human review a
 * reopen left open (C128.6); a `reopen` row opens one.
 */
import type { AuditActor, DecisionMeta } from '@openverify/contracts';
import { contestRouteSchema } from '@openverify/contracts';
import type { DecisionKind } from '@openverify/core';
import {
  closePendingHumanReview,
  createInquiryDecision,
  type Db,
  type Inquiry,
  type NewInquiryDecision,
} from '@openverify/db';
import type { Clock, IdGenerator } from '../../ports.js';
import { clonedRelianceOf } from '../connect/cloned-results.js';
import { inquiryEvidence } from './evidence.js';

/** What a run knows of its own decision, computed at run time (C128.1, C128.2). */
export type RunDecisionFacts = Pick<
  NewInquiryDecision,
  | 'run'
  | 'solelyAutomated'
  | 'humanStep'
  | 'evidence'
  | 'pendingEvidence'
  | 'decisionBasis'
  | 'contestRoute'
  | 'biometricBasis'
  | 'testRunId'
>;

/** What a caller of `applyInquiryAction` says of a decision. */
export interface InquiryDecisionInput {
  /** A run names its record first, so its step's output can say which it wrote. */
  id?: string | undefined;
  /** C128.2: what an API caller declares; left out is `null`, not declared. */
  solelyAutomated?: boolean | undefined;
  /** Sealed in the record, never in audit metadata (P19). */
  comment?: string | undefined;
  /** A run's facts (`api-actions`). */
  run?: RunDecisionFacts | undefined;
  /** C128.3: the gate that sent this subject to review. */
  errorCode?: string | undefined;
}

export interface RecordInquiryDecision {
  /** As read under the row lock. */
  inquiry: Inquiry;
  kind: Exclude<DecisionKind, 'adverse'>;
  actor: AuditActor;
  decision: InquiryDecisionInput;
}

export interface DecisionRecordDeps {
  ids: IdGenerator;
  clock: Clock;
}

const USER_DECISIONS: ReadonlySet<string> = new Set(['approve', 'decline']);

/** Writes the row in `tx`, and answers what `inquiry.declined` says of it (P40). */
export async function recordInquiryDecisionInTx(
  tx: Db,
  deps: DecisionRecordDeps,
  { inquiry, kind, actor, decision }: RecordInquiryDecision,
): Promise<DecisionMeta | null> {
  const { environmentId, id: subjectId } = inquiry;
  const { run } = decision;
  const evidence =
    run?.evidence === undefined ? await inquiryEvidence(tx, inquiry) : { evidence: run.evidence };
  const pendingEvidence =
    run?.pendingEvidence ?? ('pendingEvidence' in evidence ? evidence.pendingEvidence : []);
  // C235.4 (Workflow 11A, api-redeem's named borrowed edit): a decision resting on a counted clone
  // names its share token and says so (`relied_on_cloned`).
  const reliance = await clonedRelianceOf(tx, inquiry, deps.clock.now());
  const stored = await createInquiryDecision(tx, environmentId, {
    reliedOnCloned: reliance.reliedOnCloned,
    shareTokenId: reliance.shareTokenId,
    id: decision.id ?? deps.ids.newId('idec'),
    kind,
    subjectType: 'inquiry',
    subjectId,
    actorType: actor.type,
    actorId: actor.id,
    run: run?.run ?? null,
    solelyAutomated:
      run === undefined ? (decision.solelyAutomated ?? null) : (run.solelyAutomated ?? null),
    humanStep: run?.humanStep ?? null,
    evidence: evidence.evidence,
    pendingEvidence,
    decisionBasis: run?.decisionBasis ?? null,
    contestRoute: run?.contestRoute ?? null,
    biometricBasis: run?.biometricBasis ?? null,
    comment: decision.comment ?? null,
    humanReviewPending: kind === 'reopen',
    errorCode: decision.errorCode ?? null,
    testRunId: run?.testRunId ?? null,
  });
  if (actor.type === 'user' && USER_DECISIONS.has(kind)) {
    await closePendingHumanReview(tx, environmentId, subjectId);
  }
  return {
    id: stored.id,
    'solely-automated': stored.solelyAutomated,
    'decision-basis': stored.decisionBasis,
    'contest-route':
      stored.contestRoute === null ? null : contestRouteSchema.parse(stored.contestRoute),
  };
}
