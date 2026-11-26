/**
 * C128.4: whether this step is biometric at run time: the action's own flag, or the static rule over
 * the definition with the subject's own template in hand, so a template that holds no selfie and no
 * face list bounds it. Without an inquiry the rule counts every template, which fails closed.
 */
import { getInquiryTemplateVersion, type Db, type Inquiry } from '@openverify/db';
import { analyzeAdverseSteps } from '@openverify/workflow-engine';
import type { ActionContext } from '../../engine/action-port.js';

const SELFIE_STEP = 'selfie';

async function templateHoldsSelfie(tx: Db, inquiry: Inquiry): Promise<boolean> {
  const version = await getInquiryTemplateVersion(
    tx,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const steps = (version?.flow as { steps?: readonly { type?: string }[] } | undefined)?.steps;
  return steps === undefined || steps.some(({ type }) => type === SELFIE_STEP);
}

export async function stepIsBiometric(
  tx: Db,
  context: ActionContext,
  inquiry: Inquiry | null,
): Promise<boolean> {
  if (context.entry.biometric) {
    return true;
  }
  const holdsSelfie = inquiry === null ? undefined : await templateHoldsSelfie(tx, inquiry);
  const analysis = analyzeAdverseSteps(context.definition, {
    registry: context.engine.actions.registry,
    ...(holdsSelfie === undefined ? {} : { templateIsBiometric: () => holdsSelfie }),
  });
  return analysis.find(({ stepId }) => stepId === context.nodeId)?.biometric === true;
}
