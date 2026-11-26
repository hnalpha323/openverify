/**
 * C112.2, C121.6 (Workflow 8B): the case objects a workflow definition can name (a case template, a
 * queue, an assignment policy), joined to `WORKFLOW_REFERENCE_KINDS` and `readWorkflowReferences` in
 * `workflow-versions.ts`. Owner `api-case-workflows`; `foundation-8b` made the join.
 *
 * Publish refuses a literal id that is not an active object of its kind in the environment, and a
 * promote re-resolves it by name. A template and a queue are active until archived (C130.1, C132.1);
 * an assignment policy has no status, so every policy of the environment is active.
 */
import { eq, type SQL } from 'drizzle-orm';
import { caseAssignmentPolicies, caseQueues } from '../tables/case-queues.js';
import { caseTemplates } from '../tables/cases.js';

/** The case kinds of a reference, each re-resolved by name in a promote. */
export const CASE_WORKFLOW_REFERENCE_KINDS = [
  'case-template',
  'case-queue',
  'case-assignment-policy',
] as const;
export type CaseWorkflowReferenceKind = (typeof CASE_WORKFLOW_REFERENCE_KINDS)[number];

/** Where a case kind's objects live, and which of them are active. */
export interface CaseReferenceSource {
  table: typeof caseTemplates | typeof caseQueues | typeof caseAssignmentPolicies;
  active: SQL | undefined;
}

/** The table and active test of a case kind. */
export function caseReferenceSource(kind: CaseWorkflowReferenceKind): CaseReferenceSource {
  const sources: Record<CaseWorkflowReferenceKind, CaseReferenceSource> = {
    'case-template': { table: caseTemplates, active: eq(caseTemplates.status, 'active') },
    'case-queue': { table: caseQueues, active: eq(caseQueues.status, 'active') },
    'case-assignment-policy': { table: caseAssignmentPolicies, active: undefined },
  };
  return sources[kind];
}
