/**
 * C172.2, C172.3 (Workflow 9B, `api-cases-reports`): what a case must hold before it enters a
 * status. `foundation-9b` (Stage 1b (C)) froze the signature and placed the call in Phase 8's
 * transition service, `setCaseStatusInTx` (`services/cases/service.ts`), under the case's row lock,
 * after the version's map allowed the move and before anything is written, so the status change,
 * `POST /cases/:id/set-status`, the bulk job's `set-status` and the workflow step that sets a status
 * all pass through it. A throw rolls the change back.
 *
 * - A status that an unchecked item of the version's `checklists` names in its
 *   `required-for-statuses` is refused with 422 `case_checklist_incomplete` (C172.2).
 * - A status whose `requires-fields` names a field without a value is refused with 422
 *   `case_fields_required` (C172.3, the public status-switcher rule; behaviour ours). A field holds a
 *   value when it is stored and its value is neither `null`, blank text nor an empty list.
 * - The checklist is asked first. Each refusal names keys at `/meta/status`, never a value.
 */
import type { Case, CaseTemplateVersionRow } from '@openverify/db';
import { listCaseChecklistStates } from '@openverify/db';
import type { ProblemFieldError } from '../../../errors.js';
import { requiredFieldsOf, versionCompletionMembers } from '../layout/version-members.js';
import { CaseProblemError } from '../problems.js';
import type { CaseUnit } from '../shared.js';

export interface CaseTransitionInput {
  /** The case as locked, its fields opened. */
  row: Case;
  /** The version the case is pinned to. */
  version: CaseTemplateVersionRow;
  /** The status keys the map moves between. */
  from: string;
  to: string;
}

export type AssertCaseTransitionAllowedInTx = (
  unit: CaseUnit,
  input: CaseTransitionInput,
) => Promise<void>;

const POINTER = '/meta/status';

const atStatus = (detail: string): ProblemFieldError => ({
  location: 'body',
  pointer: POINTER,
  detail,
});

/** Whether a stored field (`{ type, value }`) holds a value. */
export function holdsValue(field: unknown): boolean {
  const value =
    field !== null && typeof field === 'object' && 'value' in field ? field.value : field;
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return !Array.isArray(value) || value.length > 0;
}

export const assertCaseTransitionAllowedInTx: AssertCaseTransitionAllowedInTx = async (
  unit,
  { row, version, to },
) => {
  const { checklists } = versionCompletionMembers(version);
  const required = checklists.flatMap((checklist) =>
    checklist.items
      .filter((item) => item['required-for-statuses'].includes(to))
      .map((item) => ({ checklist: checklist.key, item: item.key })),
  );
  if (required.length > 0) {
    const checked = new Set(
      (await listCaseChecklistStates(unit.tx, row.environmentId, row.id))
        .filter((state) => state.checked)
        .map((state) => `${state.checklistKey}/${state.itemKey}`),
    );
    const unchecked = required.filter(
      ({ checklist, item }) => !checked.has(`${checklist}/${item}`),
    );
    if (unchecked.length > 0) {
      throw new CaseProblemError(
        'case_checklist_incomplete',
        'A required checklist item of that status is not checked.',
        {
          errors: unchecked.map(({ item }) =>
            atStatus(`The checklist item ${item} is required for ${to}.`),
          ),
        },
      );
    }
  }
  const status = version.statuses.find((stored) => (stored as { key?: unknown }).key === to);
  const fields = row.fields ?? {};
  const missing = requiredFieldsOf(status).filter((key) => !holdsValue(fields[key]));
  if (missing.length > 0) {
    throw new CaseProblemError(
      'case_fields_required',
      'That status needs fields the case does not hold yet.',
      { errors: missing.map((key) => atStatus(`The field ${key} is required for ${to}.`)) },
    );
  }
};
