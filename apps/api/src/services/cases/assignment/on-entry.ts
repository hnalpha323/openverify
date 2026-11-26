/**
 * C132.2 (F15; Workflow 8B): a case entering a queue (or created on a template) with an assignment
 * policy is assigned at once when an agent is eligible, else stays unassigned for pull. `api-cases`
 * calls it in the transaction that creates the case or moves its queue, after the case row's lock,
 * and stages `case.assigned` and the assignee's notification itself when it answers a user. Owner
 * `api-queues-sla`; `foundation-8b` froze the signature.
 *
 * Entry is also when a version's SLA policy starts by `sla-starts-on` (C133.1): `created` on the
 * case's first entry, `entered-queue` on entering a queue, and `assigned` when the policy assigns
 * (ours: `api-cases` calls no other hook at creation or on a queue change, and a case that ever had
 * an SLA, a public one included, never starts a policy's).
 */
import { getCaseTemplateVersionRow, type Db } from '@openverify/db';
import { organizationOf, type QueueWork } from '../queues/work.js';
import { startPolicySlaInTx } from '../sla/policy-sla.js';
import { assignByPolicyInTx } from './apply.js';

export interface CaseEntry {
  environmentId: string;
  caseId: string;
  caseTemplateVersionId: string;
  caseQueueId: string | null;
  at: Date;
}

/** The user assigned, or `null` when no policy assigned one. */
export const assignOnEntry: (tx: Db, entry: CaseEntry) => Promise<string | null> = async (
  tx,
  entry,
) => {
  const version = await getCaseTemplateVersionRow(
    tx,
    entry.environmentId,
    entry.caseTemplateVersionId,
  );
  if (version === null) {
    return null;
  }
  const work: QueueWork = {
    tx,
    environmentId: entry.environmentId,
    organizationId: await organizationOf(tx, entry.environmentId),
    at: entry.at,
    requestId: null,
    actor: { actorType: 'system', actorId: null },
    events: null,
  };
  await startPolicySlaInTx(
    work,
    entry.caseId,
    version,
    entry.caseQueueId === null ? ['created'] : ['created', 'entered-queue'],
  );
  return assignByPolicyInTx(work, entry.caseId);
};
