/**
 * C151.3 (Workflow 9A; C7, C30.5, C50.5 amended): the verifications an inquiry must settle are those
 * whose steps were entered on the path taken (from the step record) and the current step's. The
 * call site is `settleInquiry` (`services/inquiry-settlement.ts`), placed by `foundation-9a`.
 *
 * An inquiry the engine never positioned keeps the v1 rule: every verification step of the flow
 * (`requiredVerifications`), so skipping the session never lowers what is required.
 */
import { getInquiry, listInquiryFlowSteps, type Db, type Inquiry } from '@openverify/db';
import type { Flow } from '@openverify/flow-spec';
import { requiredVerifications, type RequiredVerification } from '../jobs/inquiry-outcome.js';
import { pinnedFlowOf } from './pinned-flow.js';
import { isSilentStep, maxAttemptsOf, stepVerificationType } from './verification-state.js';

/** The verifications `inquiry` must settle, read in `tx` (the caller's transaction). */
export async function requiredVerificationsForInquiry(
  tx: Db,
  inquiry: Pick<Inquiry, 'id' | 'environmentId' | 'inquiryTemplateVersionId'>,
  flow: Flow,
): Promise<RequiredVerification[]> {
  const row = await getInquiry(tx, inquiry.environmentId, inquiry.id);
  const pinned = row?.flowStepId == null ? null : await pinnedFlowOf(tx, inquiry);
  if (row === null || pinned === null) {
    return requiredVerifications(flow);
  }
  const entered = new Set(
    (await listInquiryFlowSteps(tx, inquiry.environmentId, inquiry.id)).map(
      (entry) => entry.stepId,
    ),
  );
  const required: RequiredVerification[] = [];
  for (const step of pinned.flow.steps) {
    const type = stepVerificationType(step);
    if (type === null || !entered.has(step.id)) {
      continue;
    }
    required.push({
      type,
      maxAttempts: maxAttemptsOf(step),
      ...(isSilentStep(step) ? { silent: true as const } : {}),
    });
  }
  return required;
}
