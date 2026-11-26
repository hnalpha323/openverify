/**
 * C127.1, C128: `approve_inquiry`, `decline_inquiry` and `mark_inquiry_for_review`, each through
 * `applyInquiryAction` in the effect's transaction, under the row lock, with the run as actor. A
 * target already in the requested state, by anyone, is `no_change`; an inquiry another actor decided
 * otherwise first is `already_decided`; a transition the state machine refuses is the step error
 * `invalid_transition`; a redacted inquiry ends it with `subject_redacted`. Only a run that performed
 * the transition writes a decision record.
 */
import { canTransitionInquiry, type InquiryStatus } from '@openverify/core';
import {
  hasRejectedHandoffVerifications,
  listInquiryVerifications,
  getListScreening,
  getReports,
  listInquiryReportIds,
  type Db,
  type Inquiry,
} from '@openverify/db';
import {
  approveInquiryConfigSchema,
  declineInquiryConfigSchema,
} from '@openverify/workflow-engine/actions';
import { applyInquiryAction, lockedInquiry } from '../../../services/inquiries.js';
import { deleteObjects } from '../../../services/selfie-captures.js';
import { inquiryEvidence } from '../../../services/decisions/evidence.js';
import {
  ActionStepError,
  type ActionContext,
  type ActionResult,
  type TransactionActionHandler,
} from '../../engine/action-port.js';
import { stepIsBiometric } from '../decisions/biometric.js';
import { runDecisionFactsOf, runEvidenceOf } from '../decisions/facts.js';
import { adverseRefusal } from '../decisions/gate.js';
import { markInquiryForReviewInTx } from '../decisions/review.js';
import { apiDepsOf, configOf, refusing } from '../shared.js';

const DECIDED: ReadonlySet<InquiryStatus> = new Set(['approved', 'declined']);

/** A decision that made no change: `null` when this one has to run. */
function settledOutcome(
  inquiry: Inquiry,
  to: InquiryStatus,
): 'no_change' | 'already_decided' | null {
  if (inquiry.status === to) {
    return 'no_change';
  }
  return DECIDED.has(inquiry.status) ? 'already_decided' : null;
}

const outputOf = (
  inquiry: Pick<Inquiry, 'id' | 'status'>,
  outcome: 'applied' | 'no_change' | 'already_decided',
  decisionId: string | null,
) => ({ 'inquiry-id': inquiry.id, status: inquiry.status, outcome, 'decision-id': decisionId });

/**
 * C127.1, outcome 19: what keeps a run from approving: missing evidence (ADR 0002 §3b), an errored
 * report, an unscreened list, an unevaluated signal, or a rejected handoff. Each is read from the
 * record itself, so it fails closed on a cause that left no status.
 */
async function reviewBlockedBy(tx: Db, inquiry: Inquiry): Promise<boolean> {
  const { environmentId, id } = inquiry;
  if (await hasRejectedHandoffVerifications(tx, environmentId, id)) {
    return true;
  }
  if (inquiry.status !== 'needs_review') {
    return false;
  }
  const verifications = await listInquiryVerifications(tx, environmentId, id);
  if (verifications.some(({ status }) => status === 'needs_review')) {
    return true;
  }
  const reports = await getReports(
    tx,
    environmentId,
    await listInquiryReportIds(tx, environmentId, id),
  );
  if (reports.some(({ status }) => status === 'errored')) {
    return true;
  }
  const screening = await getListScreening(tx, environmentId, id);
  if (screening?.status === 'errored' || screening?.reviewCause === 'list_unscreened') {
    return true;
  }
  const review = inquiry.signalDetails?.review as { cause?: unknown } | undefined;
  return review?.cause === 'signal_unevaluated';
}

async function move(
  tx: Db,
  context: ActionContext,
  inquiry: Inquiry,
  to: InquiryStatus,
  facts: Awaited<ReturnType<typeof runDecisionFactsOf>>,
  comment: string | undefined,
): Promise<ActionResult> {
  const deps = apiDepsOf(context);
  const decisionId = context.services.ids.newId('idec');
  const { evidence, pendingEvidence } = await inquiryEvidence(tx, inquiry);
  const {
    inquiry: moved,
    staged,
    storageKeys,
  } = await refusing(() =>
    applyInquiryAction(tx, deps, context.acting, inquiry, to, {
      decision: {
        id: decisionId,
        comment,
        run: {
          ...facts,
          evidence: [...evidence, ...runEvidenceOf(context.state)],
          pendingEvidence,
        },
      },
    }),
  );
  return {
    kind: 'succeeded',
    output: {
      ...outputOf(moved, 'applied', decisionId),
      ...(to === 'declined' ? { 'solely-automated': facts.solelyAutomated ?? null } : {}),
    },
    staged,
    afterCommit: async () => {
      await deleteObjects(deps.storage, storageKeys);
    },
    subjects: [{ subjectId: inquiry.id, source: 'written' }],
  };
}

async function lockedSubject(tx: Db, context: ActionContext, id: string): Promise<Inquiry> {
  const inquiry = await refusing(() => lockedInquiry(tx, context.environmentId, id));
  if (inquiry.redactedAt !== null) {
    throw new ActionStepError('subject_redacted');
  }
  return inquiry;
}

/** C121.3: the cause lacks this step's scope, so a person looks at the inquiry. */
function onCauseRefused(tx: Db, context: ActionContext) {
  const { 'inquiry-id': id } = configOf(context, approveInquiryConfigSchema);
  return runDecisionFactsOf(tx, context, id).then((facts) =>
    markInquiryForReviewInTx(tx, context, id, facts, 'cause_lacks_scope'),
  );
}

const refusedTransition = (inquiry: Inquiry, to: InquiryStatus): boolean =>
  !canTransitionInquiry(inquiry.status, to);

export const APPROVE_INQUIRY_HANDLER: TransactionActionHandler = {
  key: 'approve_inquiry',
  version: 1,
  shape: 'transaction',
  onCauseRefused,
  async execute(tx, context) {
    const config = configOf(context, approveInquiryConfigSchema);
    const inquiry = await lockedSubject(tx, context, config['inquiry-id']);
    const settled = settledOutcome(inquiry, 'approved');
    if (settled !== null) {
      return { kind: 'succeeded', output: outputOf(inquiry, settled, null) };
    }
    if (refusedTransition(inquiry, 'approved')) {
      return { kind: 'failed', code: 'invalid_transition' };
    }
    const facts = await runDecisionFactsOf(tx, context, inquiry.id);
    if (facts.humanStep === null && (await reviewBlockedBy(tx, inquiry))) {
      return { kind: 'failed', code: 'review_required' };
    }
    return move(tx, context, inquiry, 'approved', facts, config.comment);
  },
};

export const DECLINE_INQUIRY_HANDLER: TransactionActionHandler = {
  key: 'decline_inquiry',
  version: 1,
  shape: 'transaction',
  onCauseRefused,
  async execute(tx, context) {
    const config = configOf(context, declineInquiryConfigSchema);
    const inquiry = await lockedSubject(tx, context, config['inquiry-id']);
    const settled = settledOutcome(inquiry, 'declined');
    if (settled !== null) {
      return {
        kind: 'succeeded',
        output: { ...outputOf(inquiry, settled, null), 'solely-automated': null },
      };
    }
    if (refusedTransition(inquiry, 'declined')) {
      return { kind: 'failed', code: 'invalid_transition' };
    }
    const facts = await runDecisionFactsOf(tx, context, inquiry.id, config);
    const refusal = await adverseRefusal(tx, context, {
      facts,
      biometric: await stepIsBiometric(tx, context, inquiry),
      inquiryId: inquiry.id,
    });
    if (refusal !== null) {
      const followUp = await markInquiryForReviewInTx(tx, context, inquiry.id, facts, refusal);
      return { kind: 'failed', code: refusal, ...followUp };
    }
    return move(tx, context, inquiry, 'declined', facts, config.comment);
  },
};

export const MARK_INQUIRY_FOR_REVIEW_HANDLER: TransactionActionHandler = {
  key: 'mark_inquiry_for_review',
  version: 1,
  shape: 'transaction',
  async execute(tx, context) {
    const config = configOf(context, approveInquiryConfigSchema);
    const inquiry = await lockedSubject(tx, context, config['inquiry-id']);
    const settled = settledOutcome(inquiry, 'needs_review');
    if (settled !== null) {
      return { kind: 'succeeded', output: outputOf(inquiry, settled, null) };
    }
    if (refusedTransition(inquiry, 'needs_review')) {
      return { kind: 'failed', code: 'invalid_transition' };
    }
    const facts = await runDecisionFactsOf(tx, context, inquiry.id);
    return move(tx, context, inquiry, 'needs_review', facts, config.comment);
  },
};
