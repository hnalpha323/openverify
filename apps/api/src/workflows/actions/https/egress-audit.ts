/**
 * C121.4: a step whose rendered values carry PII taint and leave the platform is marked in its
 * version's `egress`, and every such send writes an audit entry with the step and the destination,
 * never the values. The entry is written before the send, so nothing marked leaves unrecorded. The
 * mark is the publish step's, so a step no mark names records nothing.
 */
import { workflowEgressMarkSchema } from '@openverify/contracts';
import { getWorkflowVersion } from '@openverify/db';
import { z } from 'zod';
import type { ActionContext } from '../../engine/action-port.js';

/** C143.5 (P19): strict, with no free text. A destination is a literal host or a secret's id. */
const egressAuditSchema = z.strictObject({
  'workflow-id': z.string(),
  'workflow-version-id': z.string(),
  'node-id': z.string(),
  destination: z.string(),
});

const marksSchema = z.array(workflowEgressMarkSchema);

/** @throws when the entry cannot be written, so nothing is sent unrecorded. */
export async function auditEgress(context: ActionContext): Promise<void> {
  const { services, environmentId, organizationId, workflowVersionId, nodeId } = context;
  const version = await getWorkflowVersion(services.db, environmentId, workflowVersionId);
  const marks = marksSchema.safeParse(version?.egress ?? []);
  const mark = marks.success
    ? marks.data.find((candidate) => candidate['step-id'] === nodeId)
    : undefined;
  if (mark === undefined) {
    return;
  }
  await services.audit.record(services.db, {
    environmentId,
    organizationId,
    actor: context.acting.actor,
    action: 'workflow-run.egress-sent',
    resourceType: 'workflow-run',
    resourceId: context.runId,
    metadata: egressAuditSchema.parse({
      'workflow-id': context.workflowId,
      'workflow-version-id': workflowVersionId,
      'node-id': nodeId,
      destination: mark.destination,
    }),
  });
}
