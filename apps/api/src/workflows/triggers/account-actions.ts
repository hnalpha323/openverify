/**
 * C118.7 (P38, H14): account actions. An action binds a running workflow whose trigger is
 * `trigger-account` to an account type, with a label and a parameter form (the trigger's inputs,
 * prefilled from `account.fields.*`). A prefill is rendered under the viewer's mask: a masked field
 * stays empty, and the run reads the live value under its grant, so a viewer without PII visibility
 * can run an action and never see what it reads.
 */
import {
  accountActionListDocumentSchema,
  accountAvailableActionListDocumentSchema,
  accountAvailableActionResourceSchema,
  accountActionStatusSchema,
  buildAccountActionResource,
  filterValues,
  idSchema,
  listAccountActionsQuerySchema,
  type AccountActionDocument,
  type CreateAccountActionBody,
  type RunAccountActionBody,
  type RunAccountActionDocument,
  type UpdateAccountActionBody,
  type WorkflowInput,
} from '@openverify/contracts';
import {
  createAccountAction as createRow,
  getAccount,
  getAccountAction,
  getAccountType,
  listAccountActions as listRows,
  listAccountActionsForType,
  updateAccountAction as updateRow,
  type Account,
  type AccountActionRow,
} from '@openverify/db';
import type { JsonRecord, JsonValue } from '@openverify/workflow-engine';
import type { z } from 'zod';
import { NotFoundError, RedactedError, WorkflowProblemError } from '../../errors.js';
import { auditEntryOf, type ApiDependencies } from '../../services/context.js';
import { nextLink, pageRequest, withCursor } from '../../services/pagination.js';
import type { WorkflowActing } from '../acting.js';
import { startWorkflowRunInTx, wakeStartedRun } from '../engine/start-run.js';
import { readTriggerFields, type TriggerFields } from './inputs.js';
import { snapshotFits, triggerDocumentOf, triggerViewOf } from './objects.js';
import {
  assertMayStart,
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
} from './start.js';
import type { RunTarget } from './start-target.js';

export const ACCOUNT_ACTIONS_PATH = '/api/v1/account-actions';

const ACCOUNT_TRIGGER = 'trigger-account';
const FIELD_PATH = /^account\.fields\.([\w-]+)$/;

const invalidPrefill = (name: string) =>
  new WorkflowProblemError(
    'trigger_input_invalid',
    'A prefill maps a declared input to an account.fields path.',
    { members: { source: { pointer: `/data/attributes/prefill/${name}` } } },
  );

/** C118.7: each key a declared input, each value an `account.fields.*` path. */
function assertPrefill(
  inputs: readonly WorkflowInput[],
  prefill: Readonly<Record<string, string>>,
): void {
  for (const [name, path] of Object.entries(prefill)) {
    if (!inputs.some((input) => input.name === name) || !FIELD_PATH.test(path)) {
      throw invalidPrefill(name);
    }
  }
}

const resourceOf = (row: AccountActionRow) => buildAccountActionResource(row);

export async function createAccountAction(
  deps: ApiDependencies,
  acting: WorkflowActing,
  body: CreateAccountActionBody,
): Promise<AccountActionDocument> {
  const { ctx, actor } = acting;
  const { environmentId } = ctx;
  const { 'workflow-id': workflowId, 'account-type-id': accountTypeId } = body.data.attributes;
  const { label, prefill = {} } = body.data.attributes;
  const live = await runningWorkflow(deps.db, environmentId, workflowId);
  const target = targetFor(live, workflowId, ACCOUNT_TRIGGER);
  if ((await getAccountType(deps.db, environmentId, accountTypeId)) === null) {
    throw new NotFoundError(`Account type ${accountTypeId} was not found.`);
  }
  assertPrefill(target.definition.inputs, prefill);
  const row = await deps.db.transaction(async (tx) => {
    const created = await createRow(tx, environmentId, {
      id: deps.ids.newId('accac'),
      workflowId,
      accountTypeId,
      label,
      prefill,
    });
    await deps.audit.record(
      tx,
      auditEntryOf(ctx, actor, {
        action: 'account-action.created',
        resourceType: 'account-action',
        resourceId: created.id,
        metadata: { 'workflow-id': workflowId, 'account-type-id': accountTypeId },
      }),
    );
    return created;
  });
  return { data: resourceOf(row) };
}

export async function listAccountActions(
  deps: ApiDependencies,
  acting: WorkflowActing,
  query: z.infer<typeof listAccountActionsQuerySchema>,
): Promise<z.infer<typeof accountActionListDocumentSchema>> {
  const page = await withCursor(() =>
    listRows(
      deps.db,
      acting.ctx.environmentId,
      {
        workflowIds: filterValues(query['filter[workflow-id]'], idSchema('wfl')),
        accountTypeIds: filterValues(query['filter[account-type-id]'], idSchema('acctp')),
        statuses: filterValues(query['filter[status]'], accountActionStatusSchema),
      },
      pageRequest(query),
    ),
  );
  return {
    data: page.items.map(resourceOf),
    links: {
      next: nextLink(
        ACCOUNT_ACTIONS_PATH,
        {
          'filter[workflow-id]': query['filter[workflow-id]'],
          'filter[account-type-id]': query['filter[account-type-id]'],
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
): Promise<AccountActionRow> {
  const row = await getAccountAction(deps.db, environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Account action ${id} was not found.`);
  }
  return row;
}

export async function getAccountActionDocument(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
): Promise<AccountActionDocument> {
  return { data: resourceOf(await findAction(deps, acting.ctx.environmentId, id)) };
}

export async function updateAccountAction(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  body: UpdateAccountActionBody,
): Promise<AccountActionDocument> {
  const { ctx, actor } = acting;
  const { environmentId } = ctx;
  const current = await findAction(deps, environmentId, id);
  const { label, prefill, status } = body.data.attributes;
  if (prefill !== undefined) {
    const live = await runningWorkflow(deps.db, environmentId, current.workflowId);
    assertPrefill(targetFor(live, id, ACCOUNT_TRIGGER).definition.inputs, prefill);
  }
  const row = await deps.db.transaction(async (tx) => {
    const updated = await updateRow(tx, environmentId, id, { label, prefill, status });
    await deps.audit.record(
      tx,
      auditEntryOf(ctx, actor, {
        action: 'account-action.updated',
        resourceType: 'account-action',
        resourceId: id,
      }),
    );
    return updated;
  });
  if (row === null) {
    throw new NotFoundError(`Account action ${id} was not found.`);
  }
  return { data: resourceOf(row) };
}

/** The account of this environment, or 404. */
async function findAccount(
  deps: ApiDependencies,
  environmentId: string,
  id: string,
): Promise<Account> {
  const account = await getAccount(deps.db, environmentId, id);
  if (account === null) {
    throw new NotFoundError(`Account ${id} was not found.`);
  }
  return account;
}

const fieldOf = (path: string): string | null => FIELD_PATH.exec(path)?.[1] ?? null;

/** Each prefilled input's value in `fields`, and only those that hold one. */
function prefilledValues(
  prefill: Readonly<Record<string, string>>,
  fields: Readonly<Record<string, unknown>>,
): JsonRecord {
  return Object.fromEntries(
    Object.entries(prefill).flatMap(([name, path]) => {
      const field = fieldOf(path);
      const value = field === null ? undefined : fields[field];
      return value === undefined || value === null ? [] : [[name, value as JsonValue]];
    }),
  );
}

/**
 * C118.7: `POST /accounts/:id/run-action`. A parameter stands over a prefill; a prefill the caller
 * left out reads the live value, because a masked viewer's form held none (P38).
 */
export async function runAccountAction(
  deps: ApiDependencies,
  acting: WorkflowActing,
  accountId: string,
  body: RunAccountActionBody,
  idempotencyKey?: string,
): Promise<RunAccountActionDocument> {
  const { principal, ctx, actor } = acting;
  const { environmentId } = ctx;
  const { 'account-action-id': actionId, parameters = {} } = body.data;
  await consumeTriggerRate(deps, acting);
  const account = await findAccount(deps, environmentId, accountId);
  const action = await getAccountAction(deps.db, environmentId, actionId);
  if (action?.status !== 'active' || action.accountTypeId !== account.accountTypeId) {
    throw new NotFoundError(`Account action ${actionId} was not found.`);
  }
  if (account.redactedAt !== null) {
    throw new RedactedError(`Account ${accountId} was redacted; it starts no run.`);
  }
  const live = await runningWorkflow(deps.db, environmentId, action.workflowId);
  const target = targetFor(live, accountId, ACCOUNT_TRIGGER);
  assertMayStart(principal, target);
  const fields: TriggerFields = readTriggerFields(
    target.definition.inputs,
    { ...prefilledValues(action.prefill, account.fields), ...parameters },
    deps.ids,
  );
  const document = await triggerDocumentOf(deps.db, environmentId, 'account', accountId);
  if (document === null) {
    throw new NotFoundError(`Account ${accountId} was not found.`);
  }
  const view = await triggerViewOf(deps.db, environmentId, target.definition, document);
  if (!snapshotFits(view)) {
    throw new WorkflowProblemError('trigger_input_invalid', 'This account is too large to run on.');
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
        triggerType: ACCOUNT_TRIGGER,
        idempotencyKey:
          idempotencyKey === undefined ? null : idempotencyDigest(principal, idempotencyKey),
        creator: { type: 'account-action', id: action.id },
        trigger: view,
        inputs: fields.inputs,
        subjectIds: [accountId],
        causedByPrincipal: principalIdOf(principal),
        grant: target.grant,
        oneRunPerSubject:
          target.definition.trigger?.['one-run-per-subject'] === true ? accountId : null,
      });
      if (run.created) {
        await recordTriggerFiles(tx, environmentId, run.run.id, stored);
        await deps.audit.record(
          tx,
          auditEntryOf(ctx, actor, {
            action: 'account-action.run',
            resourceType: 'account-action',
            resourceId: action.id,
            metadata: { 'workflow-run-id': run.run.id, 'account-id': accountId },
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
function formOf(target: RunTarget, action: AccountActionRow, fields: JsonRecord) {
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
  acting: WorkflowActing,
  action: AccountActionRow,
  accountId: string,
): Promise<RunTarget | null> {
  try {
    const live = await runningWorkflow(deps.db, acting.ctx.environmentId, action.workflowId);
    const target = targetFor(live, accountId, ACCOUNT_TRIGGER);
    return missingForStart(acting.principal, target).length === 0 ? target : null;
  } catch (error) {
    if (error instanceof WorkflowProblemError) {
      return null;
    }
    throw error;
  }
}

/** C118.7 (H14): the account actions the caller may run, by the caller's grant. */
export async function listAccountAvailableActions(
  deps: ApiDependencies,
  acting: WorkflowActing,
  accountId: string,
): Promise<z.infer<typeof accountAvailableActionListDocumentSchema>> {
  const { environmentId } = acting.ctx;
  const account = await findAccount(deps, environmentId, accountId);
  if (account.redactedAt !== null) {
    return { data: [], links: { next: null } };
  }
  const fields = acting.mask.fields(account.fields) as JsonRecord;
  const actions = await listAccountActionsForType(deps.db, environmentId, account.accountTypeId);
  const data: z.infer<typeof accountAvailableActionResourceSchema>[] = [];
  for (const action of actions) {
    const target = await runnableTarget(deps, acting, action, accountId);
    if (target !== null) {
      data.push(
        accountAvailableActionResourceSchema.parse({
          type: 'account-action',
          id: action.id,
          attributes: { label: action.label, form: formOf(target, action, fields) },
          relationships: { workflow: { data: { type: 'workflow', id: action.workflowId } } },
        }),
      );
    }
  }
  return { data, links: { next: null } };
}
