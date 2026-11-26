/**
 * C140.2 (Workflow 8B): `current_case`, the case's flattened view (C114.4) for a workflow about a
 * case: a case action (`trigger-case`), an event trigger on case or case-comment events, and a
 * recurring or manual run over cases. Its type joins the check's scope in
 * `workflows/definitions/context.ts`, and its value the run's seed in
 * `workflows/engine/advance-run.ts`. Owner `api-case-workflows`; `foundation-8b` made the joins.
 *
 * A path under `current_case` in any other workflow reads `current_case_unavailable` at publish. The
 * value is the live case when the run starts, read unmasked as a run reads everything (C120.6): a
 * case event's payload carries no field (C129.6), so the trigger alone could not give it. A case that
 * is gone when the run starts reads as `null`, never as values.
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import { openWorkflowRunValues, type Db, type WorkflowRunRow } from '@openverify/db';
import {
  buildTriggerView,
  isJsonRecord,
  triggerViewType,
  type JsonValue,
  type ScopeType,
} from '@openverify/workflow-engine';
import { caseTriggerDocumentOf } from './trigger.js';

const CASE = 'case';
const CASE_COMMENT = 'case-comment';

/** The events whose subject is a case, or a comment on one. */
const isCaseEvent = (name: string): boolean =>
  name.startsWith(`${CASE}.`) || name.startsWith(`${CASE_COMMENT}.`);

/** Whether every way this definition starts is about a case. */
function aboutCases({ trigger }: WorkflowDefinition): boolean {
  switch (trigger?.type) {
    case 'trigger-case':
      return true;
    case 'trigger-event':
      return trigger.config.events.every(isCaseEvent);
    case 'trigger-recurring':
    case 'trigger-direct':
      return trigger.config['object-type'] === CASE;
    default:
      return false;
  }
}

/** The type of `current_case` in a definition's scope, or `undefined` when it has none. */
export function currentCaseScopeOf(definition: WorkflowDefinition): ScopeType | undefined {
  return aboutCases(definition) ? (triggerViewType(CASE) ?? undefined) : undefined;
}

/** The case a trigger snapshot is about: the case itself, or a comment's case. */
function caseIdOf(snapshot: unknown): string | null {
  if (!isJsonRecord(snapshot)) {
    return null;
  }
  const { type, id } = snapshot as { type?: unknown; id?: unknown; case?: unknown };
  if (type === CASE) {
    return typeof id === 'string' ? id : null;
  }
  const related = (snapshot as { case?: unknown }).case;
  if (type === CASE_COMMENT && isJsonRecord(related)) {
    const caseId = (related as { id?: unknown }).id;
    return typeof caseId === 'string' ? caseId : null;
  }
  return null;
}

/** The value of `current_case` when a run starts, or `undefined` when it has none. */
export async function currentCaseValueOf(
  tx: Db,
  run: WorkflowRunRow,
): Promise<JsonValue | undefined> {
  const caseId = caseIdOf(openWorkflowRunValues(run).triggerSnapshot);
  if (caseId === null) {
    return undefined;
  }
  const document = await caseTriggerDocumentOf(tx, run.environmentId, caseId);
  return document === null ? null : buildTriggerView(document);
}
