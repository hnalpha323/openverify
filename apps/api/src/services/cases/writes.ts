/**
 * C134, C136 (Workflow 8B, `api-cases`): the writes a case's routes, its creation and the bulk job
 * share, each inside a {@link CaseUnit}: held objects (C136.1-C136.3), comments with their mentions
 * (C134.1, C134.3) and the notifications they make (C134.4), and the events of a case's change.
 */
import { newId, type EventName } from '@openverify/contracts';
import { CASE_LIMITS, type CaseHeldObjectType } from '@openverify/core';
import {
  attachCaseObjects,
  countCaseObjects,
  createCaseCommentRow,
  findAttachableObjects,
  getCaseRow,
  heldKindOfId,
  hiddenCaseObjectIds,
  roles,
  userRoles,
  users,
  type AttachableObject,
  type Case,
  type CaseComment,
  type CaseTemplateVersionRow,
  roleAssignmentReaches,
} from '@openverify/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { UNMASKED } from '../../auth/pii.js';
import { UnprocessableContentError } from '../../errors.js';
import { caseProblemAt, CaseProblemError } from './problems.js';
import { caseCommentResource, caseEventResource } from './resources.js';
import { historyActor, type CaseUnit } from './shared.js';
import { notifyByPreferencesInTx } from './notification-channels.js';

/** C136.1: the kinds a document counts as for a version's `held-object-types`. */
const KIND_LISTED = (kinds: readonly string[], kind: CaseHeldObjectType) => kinds.includes(kind);

/**
 * C136.1-C136.3: attaches `objectIds` to the case, each once (a repeat is no change), refusing a kind
 * the case cannot hold (`object_type_unsupported`), an id this environment does not hold, and more
 * than 1,000 in all (`case_objects_limit`). Answers what was newly attached.
 */
export async function attachObjectsInTx(
  unit: CaseUnit,
  row: Case,
  version: CaseTemplateVersionRow,
  objectIds: readonly string[],
  pointer: string,
): Promise<AttachableObject[]> {
  if (objectIds.length === 0) {
    return [];
  }
  const { environmentId } = unit.acting.ctx;
  for (const [index, id] of objectIds.entries()) {
    if (heldKindOfId(id) === null) {
      throw caseProblemAt(
        'object_type_unsupported',
        'A case holds accounts, inquiries, reports, report runs, transactions, verifications, ' +
          'documents and graph queries only.',
        `${pointer}/${String(index)}`,
      );
    }
  }
  const found = await findAttachableObjects(unit.tx, environmentId, objectIds);
  const byId = new Map(found.map((object) => [object.objectId, object]));
  const missing = objectIds.flatMap((id, index) =>
    byId.has(id)
      ? []
      : [
          {
            location: 'body',
            pointer: `${pointer}/${String(index)}`,
            detail: 'Names nothing this environment holds.',
          },
        ],
  );
  if (missing.length > 0) {
    throw new UnprocessableContentError(
      'An object id names nothing this environment holds.',
      missing,
    );
  }
  for (const [index, id] of objectIds.entries()) {
    const object = byId.get(id);
    if (object !== undefined && !KIND_LISTED(version.heldObjectTypes, object.objectType)) {
      throw caseProblemAt(
        'object_type_unsupported',
        'This template’s cases do not hold objects of this kind.',
        `${pointer}/${String(index)}`,
      );
    }
  }
  const attached = await attachCaseObjects(
    unit.tx,
    environmentId,
    objectIds.flatMap((id) => {
      const object = byId.get(id);
      return object === undefined
        ? []
        : [
            {
              caseId: row.id,
              objectType: object.objectType,
              objectId: object.objectId,
              attachedState: object.attachedState,
              attachedByType: unit.acting.actor.type,
              attachedById: unit.acting.actor.id,
            },
          ];
    }),
  );
  if (attached.length === 0) {
    return [];
  }
  if (
    (await countCaseObjects(unit.tx, environmentId, row.id)) > CASE_LIMITS['held-objects'].value
  ) {
    throw new CaseProblemError(
      'case_objects_limit',
      `A case holds at most ${String(CASE_LIMITS['held-objects'].value)} objects.`,
    );
  }
  await unit.history([
    {
      caseId: row.id,
      kind: 'object-attached',
      ...historyActor(unit.acting),
      to: {
        objects: attached.map(({ objectType, objectId }) => ({ type: objectType, id: objectId })),
      },
      requestId: unit.acting.ctx.requestId ?? null,
    },
  ]);
  return attached.map(({ objectType, objectId, attachedState }) => ({
    objectType,
    objectId,
    attachedState,
  }));
}

const MENTION = /@\[(usr_[0-9A-HJKMNP-TV-Z]{26})\]/g;

/**
 * C134.3: the users a message names as `@[usr_…]` who belong to the organisation, are active, read
 * cases and may see this case's template. A token naming anyone else stays text and makes nobody a
 * mention, so a comment never says whether an id exists elsewhere.
 */
async function checkedMentions(unit: CaseUnit, row: Case, message: string): Promise<string[]> {
  const named = [...new Set([...message.matchAll(MENTION)].map(([, id]) => id ?? ''))]
    .filter((id) => id !== '')
    .slice(0, CASE_LIMITS['mentions-per-comment'].value);
  if (named.length === 0) {
    return [];
  }
  const readers = await unit.tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, unit.acting.ctx.organizationId),
        eq(users.status, 'active'),
        inArray(users.id, named),
        // C167.2 (Workflow 9B): a role reaching this environment.
        sql`exists (select 1 from ${userRoles} ur join ${roles} r on r.id = ur.role_id
          where ur.user_id = ${users.id} and 'cases:read' = any(r.permissions)
            and ${roleAssignmentReaches(sql`ur`, unit.acting.ctx.environmentId)})`,
      ),
    );
  const mentions: string[] = [];
  for (const { id } of readers) {
    const hidden = await hiddenCaseObjectIds(
      unit.tx,
      unit.acting.ctx.environmentId,
      { kind: 'user', userId: id },
      [row.id],
    );
    if (!hidden.has(row.id)) {
      mentions.push(id);
    }
  }
  return named.filter((id) => mentions.includes(id));
}

/**
 * C134.1: a comment on the case: its message sealed, its mentions checked, `case-comment.created` with
 * no message, a history row naming the comment, and a notification for each person mentioned.
 */
export async function addCommentInTx(
  unit: CaseUnit,
  row: Case,
  message: string,
  options: { workflowRunStepId?: string | null } = {},
): Promise<CaseComment> {
  const { environmentId } = unit.acting.ctx;
  const mentions = await checkedMentions(unit, row, message);
  const comment = await createCaseCommentRow(unit.tx, environmentId, {
    id: newId('cscm'),
    caseId: row.id,
    message,
    commenterType: unit.acting.actor.type,
    commenterId: unit.acting.actor.id,
    mentions,
    workflowRunStepId: options.workflowRunStepId ?? null,
  });
  await unit.history([
    {
      caseId: row.id,
      kind: 'comment-added',
      ...historyActor(unit.acting),
      to: { 'comment-id': comment.id },
      requestId: unit.acting.ctx.requestId ?? null,
    },
  ]);
  await unit.emit('case-comment.created', {
    data: caseCommentResource(comment, UNMASKED, { forEvent: true }),
  });
  await notify(
    unit,
    row.id,
    'mentioned',
    mentions.filter((id) => !(unit.acting.actor.type === 'user' && unit.acting.actor.id === id)),
  );
  return comment;
}

/** C134.4: a notification of `kind` for each user; a kind and a case, never text. */
export async function notify(
  unit: CaseUnit,
  caseId: string,
  kind: 'assigned' | 'mentioned' | 'sla-breached',
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  const existing = await unit.tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, unit.acting.ctx.organizationId),
        inArray(users.id, [...userIds]),
      ),
    );
  await notifyByPreferencesInTx(
    unit.tx,
    unit.acting.ctx.environmentId,
    caseId,
    kind,
    existing.map(({ id }) => id),
  );
}

/** Stages a case event, its case as it is now in this transaction and without its fields. */
export async function emitCaseEvent(
  unit: CaseUnit,
  caseId: string,
  name: EventName,
  meta?: Readonly<Record<string, unknown>>,
): Promise<Case> {
  const { environmentId } = unit.acting.ctx;
  const row = await getCaseRow(unit.tx, environmentId, caseId);
  if (row === null) {
    throw new Error(`emitCaseEvent: case ${caseId} was not found`);
  }
  await unit.emit(name, {
    data: await caseEventResource(unit.tx, environmentId, row),
    ...(meta === undefined ? {} : { meta: { ...meta } }),
  });
  return row;
}
