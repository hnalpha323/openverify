/**
 * C140.1, C128.7 (Workflow 8B): what `routes/server/case-actions.ts` and
 * `routes/server/inquiry-review-requests.ts` call. Owner `api-case-workflows`.
 *
 * - **Case actions** (C140.1) bind a running workflow whose trigger is `trigger-case` to 1 to 50
 *   templates, with a label and a parameter form (the trigger's inputs, each optionally prefilled
 *   from `case.fields.*`, or from the fields of the case's first held inquiry or account). A prefill
 *   names a path, never a value.
 * - **Available actions** (H14, P38) are the actions of the case's template that the caller may run,
 *   by the version's grant, each prefill rendered under the caller's mask: a masked field stays
 *   empty, and a run reads the live value under its grant.
 * - **Running one** needs `workflows:trigger`, `cases:read` and the version's grant (C121.3), and a
 *   refusal names every missing scope. The run's trigger is the case, and `current_case` is in scope.
 * - **A review request** (P40) opens a case on the template the inquiry's newest decline names in its
 *   contest route, holding the inquiry, with the person's statement as a sealed comment. Only a user
 *   opens one, and a redacted inquiry answers 410.
 *
 * Case creation is `createCaseInTx` (`../create.js`, `api-cases`), the one creation path, under the
 * `case-create` limit (C143.3), which fails open as C12 does for a route. A case the caller could not
 * see (template visibility, P14) is never made.
 */
import {
  buildCaseActionResource,
  caseAvailableActionResourceSchema,
  contestRouteSchema,
  filterValues,
  idSchema,
  type CaseActionDocument,
  type CaseActionListDocument,
  type CaseDocument,
  type CreateCaseActionBody,
  type RunCaseActionBody,
  type RunCaseActionDocument,
  type UpdateCaseActionBody,
  type WorkflowInput,
  type caseAvailableActionListDocumentSchema,
  type createInquiryReviewRequestBodySchema,
  type listCaseActionsQuerySchema,
} from '@openverify/contracts';
import {
  createCaseAction as createRow,
  firstHeldInquiryAndAccount,
  getCaseRow,
  getAccount,
  getCaseAction as getRow,
  getInquiry,
  getWorkflowCase,
  listCaseActions as listRows,
  listCaseActionsForTemplate,
  listDecisionsForSubjects,
  missingCaseTemplates,
  updateCaseAction as updateRow,
  type CaseAction,
  type CaseActionRow,
  type Db,
  type WorkflowCase,
} from '@openverify/db';
import { caseActionStatusSchema } from '@openverify/core';
import type { JsonRecord, JsonValue } from '@openverify/workflow-engine';
import type { z } from 'zod';
import { UNMASKED, type PiiMask } from '../../../auth/pii.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  RedactedError,
  WorkflowProblemError,
} from '../../../errors.js';
import type { StagedEvent } from '../../../events/index.js';
import { rateLimitRules } from '../../../plugins/rate-limit.js';
import type { Principal } from '../../../ports.js';
import { caseResourceOf } from '../../../workflows/actions/cases/case-view.js';
import { caseTriggerDocumentOf } from '../../../workflows/actions/cases/trigger.js';
import { startWorkflowRunInTx, wakeStartedRun } from '../../../workflows/engine/start-run.js';
import { readTriggerFields } from '../../../workflows/triggers/inputs.js';
import { snapshotFits, triggerViewOf } from '../../../workflows/triggers/objects.js';
import type { RunTarget } from '../../../workflows/triggers/start-target.js';
import {
  consumeTriggerRate,
  engineOfApi,
  idempotencyDigest,
  missingForStart,
  principalIdOf,
  recordTriggerFiles,
  removeTriggerFiles,
  runningWorkflow,
  storeTriggerFiles,
  targetFor,
} from '../../../workflows/triggers/start.js';
import { auditEntryOf, type ApiDependencies } from '../../context.js';
import { nextLink, pageRequest, withCursor } from '../../pagination.js';
import { createCaseInTx } from '../create.js';
import {
  assertCaseActionPlacement,
  assertCaseActionVisible,
  assertVisibleWhenRoles,
  caseActionViewerOf,
  isCaseActionVisible,
} from '../layout/action-visibility.js';
import { caseUnitIn } from '../shared.js';
import { addCommentInTx } from '../writes.js';
import type { CaseActing } from '../service.js';
import { filterCaseVisibility } from '../visibility.js';

export const CASE_ACTIONS_PATH = '/api/v1/case-actions';

const CASE_TRIGGER = 'trigger-case';
const CASES_READ = 'cases:read';
/** C140.1: a prefill reads the case's fields, or its first held inquiry's or account's. */
const PREFILL_PATH = /^(case|inquiry|account)\.fields\.([\w-]+)$/;

type PrefillSource = 'case' | 'inquiry' | 'account';
type FieldsBySource = Readonly<Record<PrefillSource, Readonly<Record<string, unknown>> | null>>;

const resourceOf = (action: CaseAction) => buildCaseActionResource(action);

const invalidPrefill = (name: string) =>
  new WorkflowProblemError(
    'trigger_input_invalid',
    'A prefill maps a declared input to a case.fields, inquiry.fields or account.fields path.',
    { members: { source: { pointer: `/data/attributes/prefill/${name}` } } },
  );

/** C140.1: each key a declared input, each value a fields path of a source the case reads. */
function assertPrefill(
  inputs: readonly WorkflowInput[],
  prefill: Readonly<Record<string, string>>,
): void {
  for (const [name, path] of Object.entries(prefill)) {
    if (!inputs.some((input) => input.name === name) || !PREFILL_PATH.test(path)) {
      throw invalidPrefill(name);
    }
  }
}

/** @throws {NotFoundError} naming the first template this environment does not hold. */
async function assertTemplates(
  deps: ApiDependencies,
  environmentId: string,
  ids: readonly string[],
): Promise<void> {
  const [missing] = await missingCaseTemplates(deps.db, environmentId, ids);
  if (missing !== undefined) {
    throw new NotFoundError(`Case template ${missing} was not found.`);
  }
}

export async function createCaseAction(
  deps: ApiDependencies,
  acting: CaseActing,
  body: CreateCaseActionBody,
): Promise<CaseActionDocument> {
  const { ctx, actor } = acting;
  const { environmentId } = ctx;
  const attributes = body.data.attributes;
  const { 'workflow-id': workflowId, 'case-template-ids': caseTemplateIds, label } = attributes;
  const prefill = attributes.prefill ?? {};
  const live = await runningWorkflow(deps.db, environmentId, workflowId);
  const target = targetFor(live, workflowId, CASE_TRIGGER);
  await assertTemplates(deps, environmentId, caseTemplateIds);
  assertPrefill(target.definition.inputs, prefill);
  // C172.5 (Workflow 9B, api-cases-reports): a layout module, and roles of this organisation.
  assertCaseActionPlacement(attributes.placement);
  await assertVisibleWhenRoles(deps.db, ctx.organizationId, attributes['visible-when']);
  const action = await deps.db.transaction(async (tx) => {
    const created = await createRow(tx, environmentId, {
      id: deps.ids.newId('cact'),
      workflowId,
      label,
      placement: attributes.placement,
      ...(attributes['visible-when'] === undefined
        ? {}
        : { visibleWhen: attributes['visible-when'] }),
      prefill,
      caseTemplateIds,
    });
    await deps.audit.record(
      tx,
      auditEntryOf(ctx, actor, {
        action: 'case-action.created',
        resourceType: 'case-action',
        resourceId: created.id,
        metadata: { 'workflow-id': workflowId, 'case-template-ids': created.caseTemplateIds },
      }),
    );
    return created;
  });
  return { data: resourceOf(action) };
}

export async function listCaseActions(
  deps: ApiDependencies,
  acting: CaseActing,
  query: z.infer<typeof listCaseActionsQuerySchema>,
): Promise<CaseActionListDocument> {
  const page = await withCursor(() =>
    listRows(
      deps.db,
      acting.ctx.environmentId,
      {
        workflowIds: filterValues(query['filter[workflow-id]'], idSchema('wfl')),
        caseTemplateIds: filterValues(query['filter[case-template-id]'], idSchema('ctmpl')),
        statuses: filterValues(query['filter[status]'], caseActionStatusSchema),
      },
      pageRequest(query),
    ),
  );
  return {
    data: page.items.map(resourceOf),
    links: {
      next: nextLink(
        CASE_ACTIONS_PATH,
        {
          'filter[workflow-id]': query['filter[workflow-id]'],
          'filter[case-template-id]': query['filter[case-template-id]'],
          'filter[status]': query['filter[status]'],
        },
        query,
        page.next,
      ),
    },
  };
}

async function findAction(
  deps: ApiDependencies,
  environmentId: string,
  id: string,
): Promise<CaseAction> {
  const action = await getRow(deps.db, environmentId, id);
  if (action === null) {
    throw new NotFoundError(`Case action ${id} was not found.`);
  }
  return action;
}

export async function getCaseAction(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
): Promise<CaseActionDocument> {
  return { data: resourceOf(await findAction(deps, acting.ctx.environmentId, id)) };
}

export async function updateCaseAction(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: UpdateCaseActionBody,
): Promise<CaseActionDocument> {
  const { ctx, actor } = acting;
  const { environmentId } = ctx;
  const current = await findAction(deps, environmentId, id);
  const {
    label,
    prefill,
    status,
    placement,
    'visible-when': visibleWhen,
    'case-template-ids': caseTemplateIds,
  } = body.data.attributes;
  // C172.5 (Workflow 9B, api-cases-reports): a layout module, and roles of this organisation.
  assertCaseActionPlacement(placement);
  await assertVisibleWhenRoles(deps.db, ctx.organizationId, visibleWhen);
  if (caseTemplateIds !== undefined) {
    await assertTemplates(deps, environmentId, caseTemplateIds);
  }
  if (prefill !== undefined) {
    const live = await runningWorkflow(deps.db, environmentId, current.workflowId);
    assertPrefill(targetFor(live, id, CASE_TRIGGER).definition.inputs, prefill);
  }
  const action = await deps.db.transaction(async (tx) => {
    const updated = await updateRow(tx, environmentId, id, {
      label,
      prefill,
      status,
      placement,
      visibleWhen,
      caseTemplateIds,
    });
    await deps.audit.record(
      tx,
      auditEntryOf(ctx, actor, {
        action: 'case-action.updated',
        resourceType: 'case-action',
        resourceId: id,
      }),
    );
    return updated;
  });
  if (action === null) {
    throw new NotFoundError(`Case action ${id} was not found.`);
  }
  return { data: resourceOf(action) };
}

/** The case of this environment that the caller may see (P14), or 404. */
async function findCase(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
): Promise<WorkflowCase> {
  const { environmentId } = acting.ctx;
  const found = await getWorkflowCase(deps.db, environmentId, id);
  const visible =
    found === null
      ? []
      : await filterCaseVisibility(
          deps.db,
          { environmentId, principal: acting.principal },
          [found],
          ({ row }) => [row.id],
        );
  const [seen] = visible;
  if (seen === undefined) {
    throw new NotFoundError(`Case ${id} was not found.`);
  }
  return seen;
}

/** A field as an input takes it: a case's or transaction's `{ type, value }` gives its value. */
function inputValueOf(field: unknown): unknown {
  if (field !== null && typeof field === 'object' && 'value' in field && 'type' in field) {
    return (field as { value: unknown }).value;
  }
  return field;
}

/** The fields each prefill source holds, under `mask`; a source the case lacks holds none. */
async function prefillFields(
  deps: ApiDependencies,
  environmentId: string,
  found: WorkflowCase,
  mask: PiiMask,
): Promise<FieldsBySource> {
  const { inquiryId, accountId } = await firstHeldInquiryAndAccount(
    deps.db,
    environmentId,
    found.row.id,
  );
  const inquiry = inquiryId === null ? null : await getInquiry(deps.db, environmentId, inquiryId);
  const account = accountId === null ? null : await getAccount(deps.db, environmentId, accountId);
  const open = (fields: Readonly<Record<string, unknown>> | null | undefined) =>
    fields == null ? null : mask.fields(fields);
  return {
    case: open(found.fields),
    inquiry: inquiry?.redactedAt == null ? open(inquiry?.fields) : null,
    account: account?.redactedAt == null ? open(account?.fields) : null,
  };
}

/** Each prefilled input's value, and only those that hold one. */
function prefilledValues(
  prefill: Readonly<Record<string, string>>,
  fields: FieldsBySource,
): JsonRecord {
  return Object.fromEntries(
    Object.entries(prefill).flatMap(([name, path]) => {
      const [, source, key] = PREFILL_PATH.exec(path) ?? [];
      const held = source === undefined ? null : fields[source as PrefillSource];
      const value = held === null || key === undefined ? undefined : inputValueOf(held[key]);
      return value === undefined || value === null ? [] : [[name, value as JsonValue]];
    }),
  );
}

/** What `principal` lacks to run `target` on a case: `cases:read`, then the start's (C121.3). */
function missingForCase(principal: Principal, target: RunTarget): string[] {
  const missing = missingForStart(principal, target);
  return principal.permissions.has(CASES_READ) ? missing : [CASES_READ, ...missing];
}

/** An active action offered on the case's template, or 404. */
async function offeredAction(
  deps: ApiDependencies,
  environmentId: string,
  actionId: string,
): Promise<CaseAction> {
  const action = await getRow(deps.db, environmentId, actionId);
  if (action?.status !== 'active') {
    throw new NotFoundError(`Case action ${actionId} was not found.`);
  }
  return action;
}

/**
 * C140.1: `POST /cases/:id/run-action`. A parameter stands over a prefill; a prefill the caller left
 * out reads the live value, because a masked viewer's form held none (P38).
 */
export async function runCaseAction(
  deps: ApiDependencies,
  acting: CaseActing,
  caseId: string,
  body: RunCaseActionBody,
  idempotencyKey: string | undefined,
): Promise<RunCaseActionDocument> {
  const { principal, ctx, actor } = acting;
  const { environmentId } = ctx;
  const { 'case-action-id': actionId, parameters = {} } = body.data;
  await consumeTriggerRate(deps, acting);
  const action = await offeredAction(deps, environmentId, actionId);
  const live = await runningWorkflow(deps.db, environmentId, action.workflowId);
  const target = targetFor(live, caseId, CASE_TRIGGER);
  const missing = missingForCase(principal, target);
  if (missing.length > 0) {
    throw new ForbiddenError('Running this case action needs more than you hold.', missing);
  }
  const found = await findCase(deps, acting, caseId);
  if (!action.caseTemplateIds.includes(found.row.caseTemplateId)) {
    throw new NotFoundError(`Case action ${actionId} was not found.`);
  }
  // C172.5 (Workflow 9B, api-cases-reports; P28): the rule available-actions applies.
  assertCaseActionVisible(
    action.visibleWhen,
    await caseActionViewerOf(deps.db, principal, found.row),
  );
  if (found.row.redactedAt !== null) {
    throw new RedactedError(`Case ${caseId} was redacted; it starts no run.`);
  }
  // A run reads every value; only a reader's mask hides one (C120.6).
  const liveFields = await prefillFields(deps, environmentId, found, UNMASKED);
  const fields = readTriggerFields(
    target.definition.inputs,
    { ...prefilledValues(action.prefill, liveFields), ...parameters },
    deps.ids,
  );
  const document = await caseTriggerDocumentOf(deps.db, environmentId, caseId);
  if (document === null) {
    throw new NotFoundError(`Case ${caseId} was not found.`);
  }
  const view = await triggerViewOf(deps.db, environmentId, target.definition, document);
  if (!snapshotFits(view)) {
    throw new WorkflowProblemError('trigger_input_invalid', 'This case is too large to run on.');
  }
  const stored = await storeTriggerFiles(deps, environmentId, fields.files);
  const engine = engineOfApi(deps);
  try {
    const started = await deps.db.transaction(async (tx) => {
      const run = await startWorkflowRunInTx(tx, engine, {
        environmentId,
        workflowId: action.workflowId,
        workflowVersionId: target.version.id,
        deploymentId: target.deploymentId,
        rolloutLabel: target.rolloutLabel,
        triggerType: CASE_TRIGGER,
        idempotencyKey:
          idempotencyKey === undefined ? null : idempotencyDigest(principal, idempotencyKey),
        creator: { type: 'case-action', id: action.id },
        trigger: view,
        inputs: fields.inputs,
        subjectIds: [caseId],
        causedByPrincipal: principalIdOf(principal),
        grant: target.grant,
        oneRunPerSubject:
          target.definition.trigger?.['one-run-per-subject'] === true ? caseId : null,
      });
      if (run.created) {
        await recordTriggerFiles(tx, environmentId, run.run.id, stored);
        await deps.audit.record(
          tx,
          auditEntryOf(ctx, actor, {
            action: 'case-action.run',
            resourceType: 'case-action',
            resourceId: action.id,
            metadata: { 'workflow-run-id': run.run.id, 'case-id': caseId },
          }),
        );
      }
      return run;
    });
    if (!started.created) {
      await removeTriggerFiles(deps, stored);
    }
    await wakeStartedRun(engine, started);
    return { data: { 'workflow-run-id': started.run.id } };
  } catch (error) {
    await removeTriggerFiles(deps, stored);
    throw error;
  }
}

/** The form of one action, each prefill as this viewer may see it (P38). */
function formOf(target: RunTarget, action: CaseActionRow, fields: FieldsBySource) {
  const prefilled = prefilledValues(action.prefill, fields);
  return target.definition.inputs.map(({ name, type, required }) => ({
    name,
    type,
    required,
    'prefilled-value': prefilled[name] ?? null,
  }));
}

/** The target of a listed action, when this principal may run it; otherwise it is left out. */
async function runnableTarget(
  deps: ApiDependencies,
  acting: CaseActing,
  action: CaseActionRow,
  caseId: string,
): Promise<RunTarget | null> {
  try {
    const live = await runningWorkflow(deps.db, acting.ctx.environmentId, action.workflowId);
    const target = targetFor(live, caseId, CASE_TRIGGER);
    return missingForStart(acting.principal, target).length === 0 ? target : null;
  } catch (error) {
    if (error instanceof WorkflowProblemError || error instanceof NotFoundError) {
      return null;
    }
    throw error;
  }
}

/** C140.1 (H14): the case actions the caller may run, by the caller's grant. */
export async function listAvailableCaseActions(
  deps: ApiDependencies,
  acting: CaseActing,
  caseId: string,
): Promise<z.infer<typeof caseAvailableActionListDocumentSchema>> {
  const { environmentId } = acting.ctx;
  if (!acting.principal.permissions.has(CASES_READ)) {
    throw new ForbiddenError('Listing a case’s actions needs cases:read.', [CASES_READ]);
  }
  const found = await findCase(deps, acting, caseId);
  if (found.row.redactedAt !== null) {
    return { data: [], links: { next: null } };
  }
  const fields = await prefillFields(deps, environmentId, found, acting.mask);
  const actions = await listCaseActionsForTemplate(
    deps.db,
    environmentId,
    found.row.caseTemplateId,
  );
  const data: z.infer<typeof caseAvailableActionResourceSchema>[] = [];
  // C172.5 (Workflow 9B, api-cases-reports; P28): the rule run-action applies.
  const viewer = await caseActionViewerOf(deps.db, acting.principal, found.row);
  for (const action of actions) {
    if (!isCaseActionVisible(action.visibleWhen, viewer)) {
      continue;
    }
    const target = await runnableTarget(deps, acting, action, caseId);
    if (target !== null) {
      data.push(
        caseAvailableActionResourceSchema.parse({
          type: 'case-action',
          id: action.id,
          attributes: {
            label: action.label,
            placement: action.placement,
            form: formOf(target, action, fields),
          },
          relationships: { workflow: { data: { type: 'workflow', id: action.workflowId } } },
        }),
      );
    }
  }
  return { data, links: { next: null } };
}

/**
 * C143.3: `case-create`, per environment, for a route that makes a case. Like every route policy it
 * follows C12, so a limiter that cannot answer lets the request by.
 * @throws {RateLimitedError} 429 with `Retry-After` beyond the limit.
 */
export async function consumeCaseCreateRate(
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

/**
 * P14: a case the creator could not see is never made. Called inside the creating transaction, so a
 * refusal rolls the case back.
 * @throws {NotFoundError} naming the template.
 */
export async function assertCreatedCaseVisible(
  tx: Db,
  acting: Pick<CaseActing, 'ctx' | 'principal'>,
  caseId: string,
  caseTemplateId: string,
): Promise<void> {
  const visible = await filterCaseVisibility(
    tx,
    { environmentId: acting.ctx.environmentId, principal: acting.principal },
    [caseId],
    (id) => [id],
  );
  if (visible.length === 0) {
    throw new NotFoundError(`Case template ${caseTemplateId} was not found.`);
  }
}

/** The case template the inquiry's newest decline names in its contest route, or `null`. */
async function contestCaseTemplateOf(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<string | null> {
  const decisions = await listDecisionsForSubjects(db, environmentId, [inquiryId]);
  const decline = decisions.find(({ kind }) => kind === 'decline');
  if (decline?.contestRoute == null) {
    return null;
  }
  const route = contestRouteSchema.safeParse(decline.contestRoute);
  return route.success ? (route.data['case-template-id'] ?? null) : null;
}

/**
 * C128.7: the person's statement as the case's first comment, through the one comment service
 * (`addCommentInTx`): sealed, with its history row and `case-comment.created`, and no message in the
 * event. The operator who relays it is its commenter.
 */
async function recordStatementInTx(
  tx: Db,
  deps: ApiDependencies,
  acting: CaseActing,
  input: { caseId: string; statement: string },
  staged: StagedEvent[],
): Promise<void> {
  const unit = caseUnitIn(tx, deps, acting, staged);
  const row = await getCaseRow(tx, acting.ctx.environmentId, input.caseId);
  if (row === null) {
    throw new NotFoundError(`Case ${input.caseId} was not found.`);
  }
  await addCommentInTx(unit, row, input.statement);
}

/** C128.7 (P40): a case on the contest route's template, holding the inquiry; 410 when redacted. */
export async function createInquiryReviewRequest(
  deps: ApiDependencies,
  acting: CaseActing,
  inquiryId: string,
  body: z.infer<typeof createInquiryReviewRequestBodySchema>,
): Promise<CaseDocument> {
  const { principal, ctx, actor } = acting;
  const { environmentId } = ctx;
  if (principal.kind !== 'user') {
    throw new ForbiddenError('A person opens a review request: an API key cannot.');
  }
  const inquiry = await getInquiry(deps.db, environmentId, inquiryId);
  if (inquiry === null) {
    throw new NotFoundError(`Inquiry ${inquiryId} was not found.`);
  }
  if (inquiry.redactedAt !== null) {
    throw new RedactedError(`Inquiry ${inquiryId} was redacted; it takes no review request.`);
  }
  const caseTemplateId = await contestCaseTemplateOf(deps.db, environmentId, inquiryId);
  if (caseTemplateId === null) {
    throw new ConflictError(
      `No decline of inquiry ${inquiryId} names a case template for review requests.`,
    );
  }
  await consumeCaseCreateRate(deps, environmentId);
  const staged: StagedEvent[] = [];
  const caseId = await deps.db.transaction(async (tx) => {
    const created = await createCaseInTx(tx, deps, {
      environmentId,
      caseTemplateId,
      creator: { type: 'user', id: principal.userId },
      objectIds: [inquiryId],
      origin: { 'inquiry-id': inquiryId },
      requestId: ctx.requestId ?? null,
    });
    staged.push(...created.staged);
    await assertCreatedCaseVisible(tx, acting, created.id, caseTemplateId);
    await recordStatementInTx(
      tx,
      deps,
      acting,
      { caseId: created.id, statement: body.meta.statement },
      staged,
    );
    await deps.audit.record(
      tx,
      auditEntryOf(ctx, actor, {
        action: 'inquiry.review-requested',
        resourceType: 'inquiry',
        resourceId: inquiryId,
        metadata: { 'case-id': created.id, 'case-template-id': caseTemplateId },
      }),
    );
    return created.id;
  });
  await deps.events.dispatch(staged);
  const resource = await caseResourceOf(deps.db, environmentId, caseId, acting.mask);
  if (resource === null) {
    throw new NotFoundError(`Case ${caseId} was not found.`);
  }
  return { data: resource };
}
