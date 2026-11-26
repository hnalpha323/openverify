/**
 * C172.2, C172.7 (Workflow 9B, `api-cases-reports`): `POST /api/v1/cases/:id/checklist`
 * (`cases:write`), frozen by `foundation-9b` (Stage 1b (C), `routes/server/case-checklists.ts`).
 *
 * - Under the case's row lock and `meta.lock-version` (409 `case_version_conflict`), one item of the
 *   checklists of the case's pinned version is checked or unchecked (`case_checklist_states`).
 * - A checked item names who checked it and when, an unchecked one neither: nothing reads as checked
 *   on a person's behalf (C172.7). A user or a workflow run checks an item; an API key does not
 *   (403), since the state names a person or a run.
 * - A change writes a PII-free history row (`checklist-item-checked` or `-unchecked`, the keys and the
 *   actor), moves the case's `lock-version` as every case change, fires `case.updated` (C131.5) and
 *   is audited by member name. Setting the state an item holds writes nothing.
 * - The answer is every item of the version's checklists with its state.
 * - An item or checklist the version does not hold is 422 at its pointer; a redacted case 410
 *   (`case_redacted`); a case the caller may not see 404.
 */
import type {
  AuditActor,
  CaseChecklistStateDocument,
  SetCaseChecklistItemBody,
} from '@openverify/contracts';
import {
  appendCaseChecklistHistory,
  getCaseTemplateVersionRow,
  listCaseChecklistStates,
  setCaseChecklistItemState,
  updateCaseRow,
  type Case,
  type CaseChecklistActorType,
  type CaseTemplateVersionRow,
  type Db,
} from '@openverify/db';
import { toTimestamp } from '@openverify/contracts';
import { ForbiddenError, UnprocessableContentError } from '../../../errors.js';
import type { ApiDependencies } from '../../context.js';
import { versionCompletionMembers } from '../layout/version-members.js';
import type { CaseActing } from '../service.js';
import { caseChange, lockWritableCase, requireVisibleCase } from '../shared.js';
import { emitCaseEvent } from '../writes.js';

export type SetCaseChecklistItem = (
  deps: ApiDependencies,
  acting: CaseActing,
  caseId: string,
  body: SetCaseChecklistItemBody,
) => Promise<CaseChecklistStateDocument>;

/** Who an item names as its checker: a user or a workflow run, never an API key. */
function checkerOf(actor: AuditActor): { type: CaseChecklistActorType; id: string } {
  if (actor.type === 'user' || actor.type === 'workflow-run') {
    return { type: actor.type, id: actor.id };
  }
  throw new ForbiddenError(
    'A person or a workflow run checks a case checklist item; an API key does not (C172.7).',
  );
}

/** The version a case is pinned to. */
async function versionOf(db: Db, row: Case): Promise<CaseTemplateVersionRow> {
  const version = await getCaseTemplateVersionRow(db, row.environmentId, row.caseTemplateVersionId);
  if (version === null) {
    throw new Error(`setCaseChecklistItem: case ${row.id} has no version`);
  }
  return version;
}

const unknownAt = (pointer: string, what: string) =>
  new UnprocessableContentError(`The case’s version holds no such ${what}.`, [
    { location: 'body', pointer, detail: `Names no ${what} of the case’s version.` },
  ]);

/** The case's checklist state: every item of its version's checklists, set or not. */
export async function caseChecklistStateDocument(
  db: Db,
  row: Case,
  version: CaseTemplateVersionRow,
): Promise<CaseChecklistStateDocument> {
  const stored = new Map(
    (await listCaseChecklistStates(db, row.environmentId, row.id)).map((state) => [
      `${state.checklistKey}/${state.itemKey}`,
      state,
    ]),
  );
  const items = versionCompletionMembers(version).checklists.flatMap((checklist) =>
    checklist.items.map((item) => {
      const state = stored.get(`${checklist.key}/${item.key}`);
      const checked = state?.checked === true ? state : null;
      return {
        'checklist-key': checklist.key,
        'item-key': item.key,
        checked: checked !== null,
        'checked-by': checked?.checkedById ?? null,
        'checked-at': checked?.checkedAt == null ? null : toTimestamp(checked.checkedAt),
      };
    }),
  );
  return {
    data: {
      type: 'case-checklist-state',
      id: row.id,
      attributes: { items, 'lock-version': row.lockVersion },
    },
  };
}

export const setCaseChecklistItem: SetCaseChecklistItem = async (deps, acting, caseId, body) => {
  const checker = checkerOf(acting.actor);
  const {
    'checklist-key': checklistKey,
    'item-key': itemKey,
    checked,
    'lock-version': lockVersion,
  } = body.meta;
  const { environmentId } = acting.ctx;
  await caseChange(deps, acting, async (unit) => {
    const row = await lockWritableCase(unit, caseId, lockVersion);
    const version = await versionOf(unit.tx, row);
    const checklist = versionCompletionMembers(version).checklists.find(
      ({ key }) => key === checklistKey,
    );
    if (checklist === undefined) {
      throw unknownAt('/meta/checklist-key', 'checklist');
    }
    if (!checklist.items.some(({ key }) => key === itemKey)) {
      throw unknownAt('/meta/item-key', 'checklist item');
    }
    const stored = await setCaseChecklistItemState(unit.tx, environmentId, {
      caseId,
      checklistKey,
      itemKey,
      checkedBy: checked ? checker : null,
      at: unit.at,
    });
    if (stored === null) {
      return;
    }
    await appendCaseChecklistHistory(unit.tx, environmentId, {
      caseId,
      kind: checked ? 'checklist-item-checked' : 'checklist-item-unchecked',
      actorType: acting.actor.type,
      actorId: acting.actor.id,
      checklistKey,
      itemKey,
      requestId: acting.ctx.requestId ?? null,
    });
    await updateCaseRow(unit.tx, environmentId, caseId, {
      updaterType: acting.actor.type,
      updaterId: acting.actor.id,
    });
    await emitCaseEvent(unit, caseId, 'case.updated');
    await unit.audit({
      action: 'case.updated',
      resourceType: 'case',
      resourceId: caseId,
      metadata: { attributes: ['checklist'] },
    });
  });
  const row = await requireVisibleCase(deps.db, acting, caseId);
  return caseChecklistStateDocument(deps.db, row, await versionOf(deps.db, row));
};

/**
 * `GET /cases/:id/checklist` (C172.2; Workflow 9B, integration-9b): every item of the case's
 * version with its state, for a case the caller sees; writes nothing.
 */
export async function getCaseChecklist(
  deps: ApiDependencies,
  acting: CaseActing,
  caseId: string,
): Promise<CaseChecklistStateDocument> {
  const row = await requireVisibleCase(deps.db, acting, caseId);
  return caseChecklistStateDocument(deps.db, row, await versionOf(deps.db, row));
}
