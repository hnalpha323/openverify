/**
 * C143.4 (F14): the webhook filter subject of a workflow, workflow-version, workflow-run or list
 * event. Owner: `api-triggers`; called from `events/subject.ts`, which makes each one strict. A
 * workflow resolves through its own id, a version and a run through their workflow, and a list event
 * through its list. Every id is the payload's own, so this reads nothing and crosses no environment.
 * A subject it cannot read stays empty, and strictness then fails any present filter. Trigger
 * filters use the same subjects (outcome 29).
 */
import type { WebhookFilterSubject } from '@openverify/core';
import type { Db } from '@openverify/db';

interface PayloadData {
  type?: unknown;
  id?: unknown;
  relationships?: { workflow?: { data?: { id?: unknown } | null } | null } | null;
}

function subjectOf(payload: unknown): Pick<WebhookFilterSubject, 'workflowId' | 'listId'> {
  const data = (payload as { data?: PayloadData } | null | undefined)?.data;
  const type = data?.type;
  if (type === 'workflow' && typeof data?.id === 'string') {
    return { workflowId: data.id };
  }
  if (typeof type === 'string' && type.startsWith('list/') && typeof data?.id === 'string') {
    return { listId: data.id };
  }
  const workflowId = data?.relationships?.workflow?.data?.id;
  return typeof workflowId === 'string' ? { workflowId } : {};
}

export const resolveWorkflowFilterSubjects: (
  db: Db,
  environmentId: string,
  payloads: readonly unknown[],
) => Promise<WebhookFilterSubject[]> = (_db, _environmentId, payloads) =>
  Promise.resolve(payloads.map(subjectOf));
