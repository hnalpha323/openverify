/**
 * C121.6, C140.5 (Workflow 8B): the case objects a definition can name by a literal id, joined to
 * `KIND_OF_PREFIX` and `REFERENCE_MEMBERS` in `workflows/publish/references.ts`, and in the db
 * package to `WORKFLOW_REFERENCE_KINDS` (`repositories/case-references.ts`). Owner
 * `api-case-workflows`; `foundation-8b` made the joins.
 *
 * A case template, a queue and an assignment policy are named wherever they stand (a `create_case`,
 * `add_case_to_queue` or `assign_case` step, a contest route): publish refuses one the environment
 * does not hold active (`reference_unknown`), a recipe's placeholder stays refused until it is filled,
 * and a promote re-resolves it by name.
 */
import type { WorkflowReferenceKind } from '@openverify/db';

/** An id prefix to the reference kind it names. */
export const CASE_KIND_OF_PREFIX: Readonly<Record<string, WorkflowReferenceKind>> = {
  ctmpl: 'case-template',
  cqueue: 'case-queue',
  cap: 'case-assignment-policy',
};

/** The config members that must name an object once a version is published. */
export const CASE_REFERENCE_MEMBERS: readonly string[] = [
  'case-template-id',
  'case-queue-id',
  'assignment-policy-id',
];
