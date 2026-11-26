/**
 * C129.5, C131-C137 (Workflow 8B, `api-cases`): what the case routes of `routes/server/cases.ts` call.
 *
 * - Every read and change applies template visibility (C129.4, P14): a case of a template the reader
 *   may not see reads as one that does not exist (404), in lists, pages and counts alike.
 * - Every change takes the case row `FOR UPDATE`, refuses a redacted case (410 `case_redacted`),
 *   checks `lock-version` when sent (409 `case_version_conflict`), moves `lock-version` by one, writes
 *   its history rows (PII-free by rule, C131.4), stages its events with no field value (C136.4) and
 *   records an audit entry with ids, keys and counts only (P19), all in one transaction.
 * - A change that changes nothing is `no_change`: no history, no event, no new `lock-version`.
 * - Fields are masked member-wise without PII visibility (C136.4); `case.updated` fires only for a
 *   change no specific event names (C131.5).
 */
import {
  type addCaseCommentBodySchema,
  type addCaseObjectsBodySchema,
  type addCaseTagBodySchema,
  type CaseDocument,
  type CaseHeldObjectListDocument,
  type CaseHistoryListDocument,
  type CaseIncludeDocument,
  type CaseListDocument,
  type CreateCaseBody,
  type getCaseQuerySchema,
  type ListCaseHeldObjectsQuery,
  type ListCaseHistoryQuery,
  type ListCasesQuery,
  type removeCaseObjectsBodySchema,
  type removeCaseTagBodySchema,
  type SetCaseStatusBody,
  type setCaseTagsBodySchema,
  type UpdateCaseBody,
} from '@openverify/contracts';
import {
  addTag,
  decideCaseTransition,
  normalizeTag,
  removeTag,
  type CaseHeldObjectType,
} from '@openverify/core';
import {
  getCaseRow,
  getCaseTemplateRow,
  getCaseTemplateVersionRow,
  listCaseCommentRows,
  listCaseHeldObjectRows,
  listCaseHistoryRows,
  listCaseRows,
  listCaseTemplateVersionHeads,
  removeCaseObjects as detachCaseObjects,
  replaceCaseFieldKeys,
  updateCaseRow,
  users,
  type Case,
  type CaseTemplateVersionRow,
  type Db,
} from '@openverify/db';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  BadRequestError,
  NotFoundError,
  RateLimitedError,
  UnprocessableContentError,
} from '../../errors.js';
import { rateLimitRules } from '../../plugins/rate-limit.js';
import type { WorkflowActing } from '../../workflows/acting.js';
import type { ApiDependencies } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import { acceptPatchAttachments, requestAttachmentWork } from './attachments/patch.js';
import { assignOnEntry } from './assignment/on-entry.js';
import { assertCaseTransitionAllowedInTx } from './checklists/guard.js';
import { assertQueueIn, createCaseWithDeps, tagsOf } from './create.js';
import { caseSearchableKeys, fieldSchemasOf, validatedCaseFields } from './fields.js';
import { heldIncludes, isHeldInclude } from './includes.js';
import { caseProblemAt } from './problems.js';
import { setPublicSlaInTx } from './public-sla.js';
import {
  caseCommentResource,
  caseHeldObjectResource,
  caseHistoryResource,
  caseResource,
  caseResources,
  caseTemplateResource,
} from './resources.js';
import {
  assertCaseVisible,
  caseChange,
  CASES_PATH,
  createdAtOf,
  dateOf,
  filterList,
  historyActor,
  lockWritableCase,
  readerOf,
  requireVisibleCase,
  statusDefinitionOf,
  statusMachineOf,
  type CaseUnit,
} from './shared.js';
import { applySlaOnStatusChangeInTx } from './sla/status-hook.js';
import { addCommentInTx, attachObjectsInTx, emitCaseEvent, notify } from './writes.js';

/** The principal a case route acts as: who it is, and what it may see. */
export type CaseActing = WorkflowActing;

const ATTRIBUTES = '/data/attributes';

async function caseDocument(
  deps: Pick<ApiDependencies, 'db'>,
  acting: CaseActing,
  row: Case,
): Promise<CaseDocument> {
  return { data: await caseResource(deps.db, acting.ctx.environmentId, row, acting.mask) };
}

/** The case as it is now, for the answer of a change. */
async function documentOf(deps: ApiDependencies, acting: CaseActing, id: string) {
  const row = await getCaseRow(deps.db, acting.ctx.environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Case ${id} was not found.`);
  }
  return caseDocument(deps, acting, row);
}

async function requireVersion(db: Db, row: Case): Promise<CaseTemplateVersionRow> {
  const version = await getCaseTemplateVersionRow(db, row.environmentId, row.caseTemplateVersionId);
  if (version === null) {
    throw new Error(`The pinned version of case ${row.id} was not found`);
  }
  return version;
}

const updater = (unit: CaseUnit) => ({
  updaterType: unit.acting.actor.type,
  updaterId: unit.acting.actor.id,
});

const requestIdOf = (unit: CaseUnit) => unit.acting.ctx.requestId ?? null;

/** `GET /cases`: newest first (C1), visible templates only (P14). */
export async function listCases(
  deps: ApiDependencies,
  acting: CaseActing,
  query: ListCasesQuery,
): Promise<CaseListDocument> {
  const { environmentId } = acting.ctx;
  const { start, end } = createdAtOf(query);
  const page = await withCursor(() =>
    listCaseRows(
      deps.db,
      environmentId,
      readerOf(acting.principal),
      {
        statuses: filterList(query['filter[status]']),
        caseTemplateIds: filterList(query['filter[case-template-id]']),
        accountIds: filterList(query['filter[account-id]']),
        referenceId: query['filter[reference-id]'],
        inquiryIds: filterList(query['filter[inquiry-id]']),
        reportIds: filterList(query['filter[report-id]']),
        caseQueueIds: filterList(query['filter[case-queue-id]']),
        assigneeIds: filterList(query['filter[assignee-id]']),
        statusCategories: filterList(query['filter[status-category]']),
        slaStates: filterList(query['filter[sla-state]']),
        createdAtStart: dateOf(start),
        createdAtEnd: dateOf(end),
      },
      pageRequest(query),
    ),
  );
  // K8-30: the page's views and attachments in a fixed number of queries.
  const data = await caseResources(deps.db, environmentId, page.items, acting.mask);
  return {
    data,
    links: {
      next: nextLink(
        CASES_PATH,
        {
          'filter[status]': query['filter[status]'],
          'filter[case-template-id]': query['filter[case-template-id]'],
          'filter[account-id]': query['filter[account-id]'],
          'filter[reference-id]': query['filter[reference-id]'],
          'filter[inquiry-id]': query['filter[inquiry-id]'],
          'filter[report-id]': query['filter[report-id]'],
          'filter[case-queue-id]': query['filter[case-queue-id]'],
          'filter[assignee-id]': query['filter[assignee-id]'],
          'filter[status-category]': query['filter[status-category]'],
          'filter[sla-state]': query['filter[sla-state]'],
          'filter[created-at-start]': start,
          'filter[created-at-end]': end,
        },
        query,
        page.next,
      ),
    },
  };
}

/** C143.3: `case-create`, 600 an hour per environment; 429 past it, through when unanswered (C12). */
export async function consumeCaseCreate(
  deps: Pick<ApiDependencies, 'rateLimiter'>,
  environmentId: string,
): Promise<void> {
  let decision;
  try {
    decision = await deps.rateLimiter.consume(
      `case-create:${environmentId}`,
      rateLimitRules()['case-create'],
    );
  } catch {
    return;
  }
  if (!decision.allowed) {
    throw new RateLimitedError('Too many cases made; retry later.', decision.retryAfterSeconds);
  }
}

/** C129.5: `creator-email-address` names a person of this organisation, or nobody (never "elsewhere"). */
async function creatorOf(
  deps: ApiDependencies,
  acting: CaseActing,
  email: string | undefined,
): Promise<{ type: 'user' | 'api-key' | 'workflow-run'; id: string }> {
  if (email === undefined) {
    return acting.actor;
  }
  const [user] = await deps.db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, acting.ctx.organizationId),
        eq(users.email, email.toLowerCase()),
      ),
    )
    .limit(1);
  if (user === undefined) {
    throw new UnprocessableContentError(
      'creator-email-address names no person of this organisation.',
      [
        {
          location: 'body',
          pointer: `${ATTRIBUTES}/creator-email-address`,
          detail: 'Names no person of this organisation.',
        },
      ],
    );
  }
  return { type: 'user', id: user.id };
}

/** `POST /cases` (C129.5): through `createCaseInTx` (`create.ts`), under `case-create` (C143.3). */
export const createCase: (
  deps: ApiDependencies,
  acting: CaseActing,
  body: CreateCaseBody,
  idempotencyKey: string | undefined,
) => Promise<CaseDocument> = (deps, acting, body) => createCaseDocument(deps, acting, body);

/** The idempotency of `POST /cases` is the platform's (C12), so the key is not read here. */
async function createCaseDocument(
  deps: ApiDependencies,
  acting: CaseActing,
  body: CreateCaseBody,
): Promise<CaseDocument> {
  const { environmentId } = acting.ctx;
  const attributes = body.data.attributes;
  const creator = await creatorOf(deps, acting, attributes['creator-email-address']);
  await consumeCaseCreate(deps, environmentId);
  const caseId = await caseChange(deps, acting, async (unit) => {
    const created = await createCaseWithDeps(unit.tx, deps, {
      environmentId,
      caseTemplateId: attributes['case-template-id'],
      creator,
      ...(attributes['case-queue-id'] === undefined
        ? {}
        : { caseQueueId: attributes['case-queue-id'] }),
      fields: attributes.fields ?? {},
      tags: attributes.tags ?? [],
      objectIds: body.meta?.['object-ids'] ?? [],
      slaExpiresInSeconds: body.meta?.['sla-expires-in-seconds'] ?? null,
      requestId: acting.ctx.requestId ?? null,
      acting,
    });
    unit.staged.push(...created.staged);
    // P14: a case its creator could not see is never made; the refusal rolls it back.
    await assertCaseVisible(unit.tx, acting, created.id);
    await unit.audit({
      action: 'case.created',
      resourceType: 'case',
      resourceId: created.id,
      metadata: {
        'case-template-id': attributes['case-template-id'],
        'held-object-count': created.heldObjects.length,
      },
    });
    return created.id;
  });
  return documentOf(deps, acting, caseId);
}

/**
 * `GET /cases/:id?include=`: the template and the newest 50 comments under `cases:read`, and the
 * queue and each held kind under their own routes' scopes (K8-19, `includes.ts`).
 */
export async function getCase(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  query: z.infer<typeof getCaseQuerySchema>,
): Promise<CaseIncludeDocument> {
  const { environmentId } = acting.ctx;
  const include = filterList(query.include) ?? [];
  const row = await requireVisibleCase(deps.db, acting, id);
  const document: CaseIncludeDocument = await caseDocument(deps, acting, row);
  const included: NonNullable<CaseIncludeDocument['included']> = [];
  if (include.includes('case-template')) {
    const template = await getCaseTemplateRow(deps.db, environmentId, row.caseTemplateId);
    if (template !== null) {
      const heads = await listCaseTemplateVersionHeads(deps.db, environmentId, [template.id]);
      included.push(
        caseTemplateResource(template, heads.get(template.id) ?? { published: null, draft: null }),
      );
    }
  }
  if (include.includes('case-comments')) {
    const comments = await listCaseCommentRows(deps.db, environmentId, row.id, { size: 50 });
    included.push(...comments.items.map((comment) => caseCommentResource(comment, acting.mask)));
  }
  included.push(
    ...(await heldIncludes(deps, acting, document.data, include.filter(isHeldInclude))),
  );
  return include.length === 0 ? document : { ...document, included };
}

/** `PATCH /cases/:id`: attachments go to `acceptPatchAttachments` (`api-case-files`, C135.1). */
/**
 * C136.4 (K8-31): the fields given, validated by the pinned version as `PATCH` validates them, and
 * merged; `fieldKeys` names the keys whose value changed, sorted. Nothing is written.
 */
export async function changedCaseFieldsInTx(
  unit: CaseUnit,
  row: Case,
  version: CaseTemplateVersionRow,
  given: Readonly<Record<string, unknown>>,
): Promise<{ fields: Case['fields']; fieldKeys: string[] }> {
  const typed = await validatedCaseFields(unit.tx, unit.acting, version, given, true);
  const fieldKeys = Object.keys(typed)
    .filter((key) => JSON.stringify(typed[key]) !== JSON.stringify(row.fields?.[key]))
    .sort();
  return {
    fields: fieldKeys.length > 0 ? { ...(row.fields ?? {}), ...typed } : row.fields,
    fieldKeys,
  };
}

/**
 * C136.4, P25 (K8-31): after the row holds `fields`, the searchable keys rebuilt from them and the
 * `fields-changed` history row naming the changed keys, never a value. The caller writes the row,
 * emits `case.updated-fields` and audits.
 */
export async function recordCaseFieldsInTx(
  unit: CaseUnit,
  row: Case,
  version: CaseTemplateVersionRow,
  change: { fields: Case['fields']; fieldKeys: readonly string[] },
  more: { blindIndexKey: ApiDependencies['blindIndexKey']; requestId: string | null },
): Promise<void> {
  const { environmentId } = unit.acting.ctx;
  await replaceCaseFieldKeys(
    unit.tx,
    environmentId,
    row.id,
    caseSearchableKeys(
      more.blindIndexKey,
      environmentId,
      row.caseTemplateId,
      fieldSchemasOf(version),
      change.fields,
    ),
  );
  await unit.history([
    {
      caseId: row.id,
      kind: 'fields-changed',
      ...historyActor(unit.acting),
      to: { 'field-keys': [...change.fieldKeys] },
      requestId: more.requestId,
    },
  ]);
}

export async function updateCase(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: UpdateCaseBody,
): Promise<CaseDocument> {
  const { environmentId } = acting.ctx;
  const attributes = body.data?.attributes ?? {};
  let attachmentIds: string[] = [];
  await caseChange(deps, acting, async (unit) => {
    const row = await lockWritableCase(unit, id, body.meta?.['lock-version']);
    const version = await requireVersion(unit.tx, row);
    const changed: string[] = [];
    const events: (() => Promise<unknown>)[] = [];
    const { fields, fieldKeys } =
      attributes.fields === undefined
        ? { fields: row.fields, fieldKeys: [] }
        : await changedCaseFieldsInTx(unit, row, version, attributes.fields);
    const queueChanged =
      attributes['case-queue-id'] !== undefined && attributes['case-queue-id'] !== row.caseQueueId;
    if (
      queueChanged &&
      attributes['case-queue-id'] !== null &&
      attributes['case-queue-id'] !== undefined
    ) {
      await assertQueueIn(
        unit.tx,
        environmentId,
        attributes['case-queue-id'],
        `${ATTRIBUTES}/case-queue-id`,
      );
    }
    if (fieldKeys.length > 0 || queueChanged) {
      await updateCaseRow(unit.tx, environmentId, id, {
        ...(fieldKeys.length > 0 ? { fields } : {}),
        ...(queueChanged ? { caseQueueId: attributes['case-queue-id'] ?? null } : {}),
        ...updater(unit),
      });
    }
    if (fieldKeys.length > 0) {
      await recordCaseFieldsInTx(
        unit,
        row,
        version,
        { fields, fieldKeys },
        { blindIndexKey: deps.blindIndexKey, requestId: requestIdOf(unit) },
      );
      changed.push('fields');
      events.push(() =>
        emitCaseEvent(unit, id, 'case.updated-fields', { context: { 'field-keys': fieldKeys } }),
      );
    }
    if (queueChanged) {
      await unit.history([
        {
          caseId: id,
          kind: 'queue-changed',
          ...historyActor(acting),
          from: { 'case-queue-id': row.caseQueueId },
          to: { 'case-queue-id': attributes['case-queue-id'] ?? null },
          requestId: requestIdOf(unit),
        },
      ]);
      changed.push('case-queue-id');
      events.push(() => emitCaseEvent(unit, id, 'case.queue-updated'));
      const target = attributes['case-queue-id'] ?? null;
      if (target !== null) {
        const assignee = await assignOnEntry(unit.tx, {
          environmentId,
          caseId: id,
          caseTemplateVersionId: row.caseTemplateVersionId,
          caseQueueId: target,
          at: unit.at,
        });
        if (assignee !== null) {
          events.push(() => emitCaseEvent(unit, id, 'case.assigned'));
          await notify(unit, id, 'assigned', [assignee]);
        }
      }
    }
    if (attributes.attachments !== undefined && attributes.attachments.length > 0) {
      // C135.1 (F15): stored, sealed and typed as an upload is; scanned and rendered after commit.
      attachmentIds = await acceptPatchAttachments(
        unit.tx,
        { environmentId, caseId: id, uploader: acting.actor },
        attributes.attachments,
        { deps, environmentKind: acting.environmentKind, requestId: acting.ctx.requestId },
      );
      changed.push('attachments');
      // C131.5: an attachment has no event of its own, as the multipart upload's `case.updated`.
      events.push(() => emitCaseEvent(unit, id, 'case.updated'));
    }
    const seconds = body.meta?.['sla-expires-in-seconds'];
    if (seconds !== undefined) {
      const current = (await getCaseRow(unit.tx, environmentId, id)) ?? row;
      const status = version.statuses
        .map(statusDefinitionOf)
        .find(({ key }) => key === current.status);
      if (await setPublicSlaInTx(unit, current, seconds, status?.['pauses-sla'] ?? false)) {
        changed.push('sla-expires-in-seconds');
        if (!changed.includes('attachments')) {
          events.push(() => emitCaseEvent(unit, id, 'case.updated'));
        }
      }
    }
    for (const emit of events) {
      await emit();
    }
    if (changed.length > 0) {
      await unit.audit({
        action: 'case.updated',
        resourceType: 'case',
        resourceId: id,
        metadata: {
          attributes: changed,
          ...(fieldKeys.length > 0 ? { 'field-keys': fieldKeys } : {}),
        },
      });
    }
  });
  await requestAttachmentWork(deps, environmentId, attachmentIds);
  return documentOf(deps, acting, id);
}

/** `DELETE /cases/:id` (C139.1): through `RedactionService.redactCase`. */
export async function redactCase(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
): Promise<CaseDocument> {
  await requireVisibleCase(deps.db, acting, id);
  await deps.redaction.redactCase(acting.ctx, id, acting.actor);
  return documentOf(deps, acting, id);
}

/**
 * C131: by the pinned version's map (`decideCaseTransition`); a required comment becomes a comment;
 * the SLA hook (`api-queues-sla`) follows every change; the events in the machine's order.
 */
export async function setCaseStatus(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: SetCaseStatusBody,
): Promise<CaseDocument> {
  await caseChange(deps, acting, (unit) => setCaseStatusInTx(unit, id, body.meta));
  return documentOf(deps, acting, id);
}

/** {@link setCaseStatus} in a unit (the bulk job's too); answers whether anything changed. */
export async function setCaseStatusInTx(
  unit: CaseUnit,
  id: string,
  meta: SetCaseStatusBody['meta'],
): Promise<boolean> {
  const { environmentId } = unit.acting.ctx;
  const row = await lockWritableCase(unit, id, meta['lock-version']);
  const version = await requireVersion(unit.tx, row);
  const decision = decideCaseTransition(statusMachineOf(version), row.status, {
    status: meta.status,
    resolution: meta.resolution,
    comment: meta.comment,
    statusTag: meta['status-tag'],
  });
  if (decision.outcome === 'no_change') {
    return false;
  }
  if (decision.outcome === 'refused') {
    throw caseProblemAt(
      decision.code,
      'This status change is refused by the template.',
      decision.pointer,
    );
  }
  const { from, to } = decision;
  // C172.2, C172.3 (Workflow 9B Stage 1b (C)): the checklist and required-field guard
  // (`api-cases-reports`), before anything is written; a throw rolls the change back.
  await assertCaseTransitionAllowedInTx(unit, { row, version, from: from.key, to: to.key });
  await updateCaseRow(unit.tx, environmentId, id, {
    status: to.key,
    statusCategory: to.category,
    resolution: decision.resolution,
    ...(decision.resolves
      ? {
          resolverType: unit.acting.actor.type,
          resolverId: unit.acting.actor.id,
          resolvedAt: unit.at,
        }
      : {}),
    ...(decision.reopens ? { resolverType: null, resolverId: null, resolvedAt: null } : {}),
    ...updater(unit),
  });
  await unit.history([
    {
      caseId: id,
      kind: decision.kind,
      ...historyActor(unit.acting),
      from: {
        status: from.key,
        ...(row.resolution === null ? {} : { resolution: row.resolution }),
      },
      to: {
        status: to.key,
        ...(decision.resolution === null ? {} : { resolution: decision.resolution }),
        ...(decision.statusTag === null ? {} : { 'status-tag': decision.statusTag }),
      },
      requestId: requestIdOf(unit),
    },
  ]);
  if (decision.comment !== null) {
    await addCommentInTx(unit, row, decision.comment);
  }
  await applySlaOnStatusChangeInTx(unit.tx, {
    environmentId,
    caseId: id,
    from: { status: from.key, category: from.category },
    to: { status: to.key, category: to.category, pausesSla: to['pauses-sla'] },
    at: unit.at,
    events: { publisher: unit.deps.events, staged: unit.staged },
  });
  for (const name of decision.events) {
    await emitCaseEvent(
      unit,
      id,
      name,
      name === 'case.status-updated' ? { context: { from: from.key, to: to.key } } : undefined,
    );
  }
  await unit.audit({
    action: 'case.status-changed',
    resourceType: 'case',
    resourceId: id,
    metadata: { from: from.key, to: to.key },
  });
  return true;
}

export async function addCaseComment(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: z.infer<typeof addCaseCommentBodySchema>,
): Promise<CaseDocument> {
  await caseChange(deps, acting, async (unit) => {
    const row = await lockWritableCase(unit, id);
    const comment = await addCommentInTx(unit, row, body.meta.message);
    await unit.audit({
      action: 'case.comment-added',
      resourceType: 'case',
      resourceId: id,
      metadata: { 'comment-id': comment.id, 'mention-count': comment.mentions.length },
    });
  });
  return documentOf(deps, acting, id);
}

/** C136.1-C136.3: in a unit; answers whether anything was attached. */
export async function addCaseObjectsInTx(
  unit: CaseUnit,
  id: string,
  objectIds: readonly string[],
): Promise<boolean> {
  const row = await lockWritableCase(unit, id);
  const version = await requireVersion(unit.tx, row);
  const attached = await attachObjectsInTx(unit, row, version, objectIds, '/meta/object-ids');
  if (attached.length === 0) {
    return false;
  }
  await updateCaseRow(unit.tx, unit.acting.ctx.environmentId, id, updater(unit));
  await emitCaseEvent(unit, id, 'case.updated');
  await unit.audit({
    action: 'case.objects-added',
    resourceType: 'case',
    resourceId: id,
    metadata: { 'object-ids': attached.map(({ objectId }) => objectId) },
  });
  return true;
}

export async function addCaseObjects(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: z.infer<typeof addCaseObjectsBodySchema>,
): Promise<CaseDocument> {
  await caseChange(deps, acting, (unit) => addCaseObjectsInTx(unit, id, body.meta['object-ids']));
  return documentOf(deps, acting, id);
}

export async function removeCaseObjects(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: z.infer<typeof removeCaseObjectsBodySchema>,
): Promise<CaseDocument> {
  await caseChange(deps, acting, async (unit) => {
    await lockWritableCase(unit, id);
    const removed = await detachCaseObjects(
      unit.tx,
      acting.ctx.environmentId,
      id,
      body.meta['object-ids'],
    );
    if (removed.length === 0) {
      return;
    }
    await updateCaseRow(unit.tx, acting.ctx.environmentId, id, updater(unit));
    await unit.history([
      {
        caseId: id,
        kind: 'object-removed',
        ...historyActor(acting),
        from: {
          objects: removed.map(({ objectType, objectId }) => ({ type: objectType, id: objectId })),
        },
        requestId: requestIdOf(unit),
      },
    ]);
    await emitCaseEvent(unit, id, 'case.updated');
    await unit.audit({
      action: 'case.objects-removed',
      resourceType: 'case',
      resourceId: id,
      metadata: { 'object-ids': removed.map(({ objectId }) => objectId) },
    });
  });
  return documentOf(deps, acting, id);
}

/** C136.5: a tag change in a unit, with `case.updated-tags`; answers whether anything changed. */
export async function changeCaseTagsInTx(
  unit: CaseUnit,
  id: string,
  next: (tags: readonly string[]) => string[],
): Promise<boolean> {
  const row = await lockWritableCase(unit, id);
  const tags = next(row.tags);
  const key = (tag: string) => normalizeTag(tag).toLowerCase();
  const before = new Set(row.tags.map(key));
  const after = new Set(tags.map(key));
  const added = tags.filter((tag) => !before.has(key(tag)));
  const removed = row.tags.filter((tag) => !after.has(key(tag)));
  if (added.length === 0 && removed.length === 0) {
    return false;
  }
  await updateCaseRow(unit.tx, unit.acting.ctx.environmentId, id, { tags, ...updater(unit) });
  await unit.history([
    {
      caseId: id,
      kind: 'tags-changed',
      ...historyActor(unit.acting),
      to: { added, removed },
      requestId: requestIdOf(unit),
    },
  ]);
  await emitCaseEvent(unit, id, 'case.updated-tags', {
    context: { 'added-tags': added, 'removed-tags': removed },
  });
  await unit.audit({
    action: 'case.tags-changed',
    resourceType: 'case',
    resourceId: id,
    metadata: { added: added.length, removed: removed.length },
  });
  return true;
}

const tagNameOf = (meta: { 'tag-name'?: string | undefined; 'tag-id'?: string | undefined }) =>
  meta['tag-name'] ?? meta['tag-id'] ?? '';

export async function addCaseTag(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: z.infer<typeof addCaseTagBodySchema>,
): Promise<CaseDocument> {
  const tag = tagNameOf(body.meta);
  await caseChange(deps, acting, (unit) =>
    changeCaseTagsInTx(unit, id, (tags) => tagsOf([...addTag(tags, tag)])),
  );
  return documentOf(deps, acting, id);
}

export async function removeCaseTag(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: z.infer<typeof removeCaseTagBodySchema>,
): Promise<CaseDocument> {
  const tag = tagNameOf(body.meta);
  await caseChange(deps, acting, (unit) =>
    changeCaseTagsInTx(unit, id, (tags) => removeTag(tags, tag)),
  );
  return documentOf(deps, acting, id);
}

export async function setCaseTags(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: z.infer<typeof setCaseTagsBodySchema>,
): Promise<CaseDocument> {
  const tags = tagsOf([
    ...(body.meta['tag-names'] ?? []),
    ...(body.meta['tag-name'] ?? []),
    ...(body.meta['tag-id'] ?? []),
  ]);
  await caseChange(deps, acting, (unit) => changeCaseTagsInTx(unit, id, () => tags));
  return documentOf(deps, acting, id);
}

export { searchCases } from './search.js';
export { createCaseBulkAction, getCaseBulkAction } from './bulk/service.js';

/** C131.4: newest first, paged by the row's number. */
export async function listCaseHistory(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  query: ListCaseHistoryQuery,
): Promise<CaseHistoryListDocument> {
  await requireVisibleCase(deps.db, acting, id);
  const after = query['page[after]'];
  const page = await withCursor(() =>
    listCaseHistoryRows(deps.db, acting.ctx.environmentId, id, {
      after: after === undefined ? undefined : Number(after),
      size: query['page[size]'],
    }),
  );
  return {
    data: page.items.map(caseHistoryResource),
    links: { next: nextLink(`${CASES_PATH}/${id}/history`, {}, query, page.next) },
  };
}

/** C136.3: every held object with its attached state. */
export async function listCaseHeldObjects(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  query: ListCaseHeldObjectsQuery,
): Promise<CaseHeldObjectListDocument> {
  await requireVisibleCase(deps.db, acting, id);
  const after = query['page[after]'];
  if (after !== undefined && !after.startsWith(`${id}:`)) {
    throw new BadRequestError('page[after] does not name a record in this list.');
  }
  const page = await withCursor(() =>
    listCaseHeldObjectRows(deps.db, acting.ctx.environmentId, id, {
      objectTypes: filterList(query['filter[object-type]']) as CaseHeldObjectType[] | undefined,
      afterObjectId: after?.slice(id.length + 1),
      size: query['page[size]'],
    }),
  );
  return {
    data: page.items.map(caseHeldObjectResource),
    links: {
      next: nextLink(
        `${CASES_PATH}/${id}/objects`,
        { 'filter[object-type]': query['filter[object-type]'] },
        query,
        page.next,
      ),
    },
  };
}
