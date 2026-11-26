/**
 * C122.1, C140.3 (F33; Workflow 8B): the case row of the generic actions' table (`tag_object`,
 * `remove_tag`, `copy_tags`, `fetch_object`, `update_object`), joined to `OBJECT_ROWS` in
 * `workflows/actions/objects/table.ts`. Owner `api-case-workflows`; `foundation-8b` made the join.
 *
 * A case is read as the case routes serve it, under the run's mask, and fetched as its flattened view
 * (C114.4), the shape the check gives a fetched object, so a path reads what it names. Its tags, its fields
 * and its queue change through the case services, in the step's transaction as the run, with their
 * history rows and the case's own events (C131.4, C136): `case.updated-tags`, `case.updated-fields`
 * with the changed keys only, `case.queue-updated` with the queue's policy on entry.
 */
import { addTag, removeTag } from '@openverify/core';
import { getCaseRow, getCaseTemplateVersionRow, updateCaseRow } from '@openverify/db';
import { buildTriggerView } from '@openverify/workflow-engine';
import type { StagedEvent } from '../../../events/index.js';
import { setCaseQueueInTx } from '../../../services/cases/bulk/apply.js';
import { tagsOf } from '../../../services/cases/create.js';
import {
  changeCaseTagsInTx,
  changedCaseFieldsInTx,
  recordCaseFieldsInTx,
} from '../../../services/cases/service.js';
import type { CaseUnit } from '../../../services/cases/shared.js';
import { emitCaseEvent } from '../../../services/cases/writes.js';
import { ActionStepError, type ActionContext } from '../../engine/action-port.js';
import type { ObjectRow, TagChange, UpdateAttributes } from '../objects/table.js';
import { apiDepsOf } from '../shared.js';
import { caseResourceOf } from './case-view.js';
import { assertActiveQueue, lockedCase, refusingCase, runCaseUnit } from './unit.js';

const FIELDS = 'fields';
const QUEUE = 'case-queue-id';

/** C136.5: the tags after `change`, normalised and capped as the tag routes do. */
function nextTags(change: TagChange): (tags: readonly string[]) => string[] {
  switch (change.kind) {
    case 'add':
      return (tags) => tagsOf([...addTag(tags, change.tag)]);
    case 'remove':
      return (tags) => removeTag(tags, change.tag);
    case 'set':
      return () => tagsOf(change.tags);
  }
}

/**
 * C136.4: the fields given, validated by the pinned version as `PATCH` validates them, merged, sealed
 * and keyed; `case.updated-fields` names the changed keys and never a value.
 */
async function writeFieldsInTx(
  unit: CaseUnit,
  context: ActionContext,
  caseId: string,
  given: Readonly<Record<string, unknown>>,
): Promise<void> {
  const { environmentId } = context;
  const row = await lockedCase(unit, caseId);
  const version = await getCaseTemplateVersionRow(
    unit.tx,
    environmentId,
    row.caseTemplateVersionId,
  );
  if (version === null) {
    throw new Error(`The pinned version of case ${caseId} was not found`);
  }
  const { fields, fieldKeys: keys } = await refusingCase(() =>
    changedCaseFieldsInTx(unit, row, version, given),
  );
  if (keys.length === 0) {
    return;
  }
  await updateCaseRow(unit.tx, environmentId, caseId, {
    fields,
    updaterType: unit.acting.actor.type,
    updaterId: unit.acting.actor.id,
  });
  await recordCaseFieldsInTx(
    unit,
    row,
    version,
    { fields, fieldKeys: keys },
    { blindIndexKey: apiDepsOf(context).blindIndexKey, requestId: null },
  );
  await emitCaseEvent(unit, caseId, 'case.updated-fields', { context: { 'field-keys': keys } });
  await unit.audit({
    action: 'case.updated',
    resourceType: 'case',
    resourceId: caseId,
    metadata: { attributes: [FIELDS], 'field-keys': keys },
  });
}

/** C132.1: `null` takes the case out of every queue; a queue must be an active one of this environment. */
async function writeQueueInTx(
  unit: CaseUnit,
  context: ActionContext,
  caseId: string,
  value: unknown,
): Promise<void> {
  if (value !== null && typeof value !== 'string') {
    throw new ActionStepError('action_input_invalid');
  }
  await lockedCase(unit, caseId);
  if (value !== null) {
    await assertActiveQueue(unit.tx, context, value);
  }
  const changed = await refusingCase(() => setCaseQueueInTx(unit, caseId, value));
  if (changed) {
    await unit.audit({
      action: 'case.updated',
      resourceType: 'case',
      resourceId: caseId,
      metadata: { attributes: [QUEUE] },
    });
  }
}

const caseRow: ObjectRow = {
  async read(tx, { environmentId }, id) {
    const found = await getCaseRow(tx, environmentId, id);
    return found === null ? null : { tags: found.tags, redacted: found.redactedAt !== null };
  },
  async fetch(context, id) {
    const { db } = apiDepsOf(context);
    const resource = await caseResourceOf(db, context.environmentId, id, context.acting.mask);
    if (resource === null) {
      throw new ActionStepError('object_not_found');
    }
    // The case's flattened view (C114.4), the shape the check types a fetched object by
    // (`triggerViewType`), so `steps.<id>.output.object.resolution` reads what it names.
    return buildTriggerView({ data: resource });
  },
  async tag(tx, context, id, change, staged: StagedEvent[]) {
    const unit = runCaseUnit(tx, context, staged);
    await refusingCase(() => changeCaseTagsInTx(unit, id, nextTags(change)));
  },
  async update(tx, context, id, attributes: UpdateAttributes, staged: StagedEvent[]) {
    const unit = runCaseUnit(tx, context, staged);
    const fields = attributes[FIELDS];
    if (fields !== undefined) {
      if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
        throw new ActionStepError('action_input_invalid');
      }
      await writeFieldsInTx(unit, context, id, fields as Readonly<Record<string, unknown>>);
    }
    if (QUEUE in attributes) {
      await writeQueueInTx(unit, context, id, attributes[QUEUE]);
    }
  },
};

export const CASE_OBJECT_ROWS: Readonly<Record<string, ObjectRow>> = { case: caseRow };
