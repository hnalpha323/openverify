/**
 * C120.7: a test run, in sandbox environments only, on the draft or a published version.
 *
 * - Its grant is derived as publish would, and the caller must hold it (P36).
 * - An irreversible or adverse step runs only with its acknowledgement, otherwise it is simulated:
 *   no effect and no decision record (decision 77).
 * - An HTTPS step must be overridden, or it errors `test_run_egress_disabled`. A real call needs a
 *   user with `pii:view`, the host in `allow-hosts`, and `egress:<step id>`; a message always goes to
 *   the recording provider (H15, H17, V18).
 * - The run is marked, and the events it causes carry its id, so they trigger nothing unless the
 *   request opts in.
 * - K8-12: a synthetic payload is held to the trigger's view, partial (see {@link payloadProblem}).
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import type { WorkflowObjectType } from '@openverify/core';
import {
  getWorkflow,
  getWorkflowRunVersion,
  listWorkflowVersions,
  type WorkflowRunRow,
} from '@openverify/db';
import {
  checkDefinition,
  checkValue,
  isJsonRecord,
  readDefinition,
  triggerRootType,
  type JsonRecord,
  type JsonValue,
  type ValueProblem,
} from '@openverify/workflow-engine';
import type { z } from 'zod';
import type { createWorkflowTestRunBodySchema } from '@openverify/contracts';
import { canViewPii } from '../../auth/pii.js';
import { NotFoundError, WorkflowProblemError } from '../../errors.js';
import type { WorkflowActing } from '../acting.js';
import { loadCheckContext } from '../definitions/context.js';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';
import { deriveGrant } from '../publish/grant.js';
import { childGrants } from '../publish/publish.js';
import type { EngineDeps } from '../engine/deps.js';
import { startWorkflowRunInTx, wakeStartedRun } from '../engine/start-run.js';
import { readTriggerFields } from '../triggers/inputs.js';
import { triggerDocumentOf, triggerViewOf } from '../triggers/objects.js';
import { assertHoldsGrant } from './control.js';

type TestRunBody = z.infer<typeof createWorkflowTestRunBodySchema>;

async function versionOf(
  deps: EngineDeps,
  environmentId: string,
  workflowId: string,
  requested: string | undefined,
) {
  const workflow = await getWorkflow(deps.db, environmentId, workflowId);
  if (workflow === null) {
    throw new NotFoundError('Workflow not found.');
  }
  const id = requested ?? workflow.draftVersionId ?? workflow.latestPublishedVersionId ?? undefined;
  const version =
    id === undefined
      ? await newestVersion(deps, environmentId, workflowId)
      : await getWorkflowRunVersion(deps.db, environmentId, id);
  if (version?.workflowId !== workflowId) {
    throw new NotFoundError('Workflow version not found.');
  }
  return { workflow, version };
}

async function newestVersion(deps: EngineDeps, environmentId: string, workflowId: string) {
  const page = await listWorkflowVersions(deps.db, environmentId, workflowId, { size: 1 });
  const [row] = page.items;
  return row === undefined ? null : getWorkflowRunVersion(deps.db, environmentId, row.id);
}

const OBJECT_TYPES: Readonly<Record<string, WorkflowObjectType>> = {
  inq: 'inquiry',
  acc: 'account',
  rep: 'report',
  txn: 'transaction',
};

const PAYLOAD_POINTER = '/data/attributes/trigger-payload';

/** Whether the member a JSON Pointer names is absent from `value` (RFC 6901 tokens). */
function absentAt(value: JsonValue, pointer: string): boolean {
  let here: JsonValue | undefined = value;
  for (const raw of pointer.split('/').slice(1)) {
    const token = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(here)) {
      here = here[Number(token)];
    } else if (isJsonRecord(here ?? null) && Object.hasOwn(here as JsonRecord, token)) {
      here = (here as JsonRecord)[token];
    } else {
      return true;
    }
  }
  return here === undefined;
}

/**
 * K8-12 (C119, default): a synthetic payload may be partial. What it leaves out reads as `null` in
 * the run; what it carries must fit the trigger's view, and an explicit `null` where the view holds
 * none is refused. The problem holds a pointer and a code, never a value (C143.5).
 */
function payloadProblem(definition: WorkflowDefinition, payload: JsonRecord): ValueProblem | null {
  const view = triggerRootType(definition);
  if (view === null) {
    return null;
  }
  const [problem] = checkValue(view, payload).filter(
    ({ code, pointer }) => code !== 'value_missing' || !absentAt(payload, pointer),
  );
  return problem ?? null;
}

/** What a test run starts from: an object as a run reads it, or a synthetic payload (C120.7). */
async function seedOf(
  deps: EngineDeps,
  environmentId: string,
  definition: WorkflowDefinition,
  attributes: TestRunBody['data']['attributes'],
): Promise<{ trigger: JsonValue; inputs: JsonRecord }> {
  const objectId = attributes['object-id'];
  if (objectId !== undefined) {
    const objectType = OBJECT_TYPES[objectId.slice(0, objectId.indexOf('_'))];
    const document =
      objectType === undefined
        ? null
        : await triggerDocumentOf(deps.db, environmentId, objectType, objectId);
    if (document === null) {
      throw new NotFoundError('Trigger object not found.');
    }
    return {
      trigger: await triggerViewOf(deps.db, environmentId, definition, document),
      inputs: {},
    };
  }
  const payload = attributes['trigger-payload'];
  if (!isJsonRecord(payload ?? null)) {
    throw new WorkflowProblemError(
      'trigger_input_invalid',
      'A synthetic trigger payload is a JSON object.',
      { members: { source: { pointer: PAYLOAD_POINTER } } },
    );
  }
  const record = payload as JsonRecord;
  if (definition.trigger?.type === 'trigger-api') {
    return { trigger: {}, inputs: readTriggerFields(definition.inputs, record, deps.ids).inputs };
  }
  const problem = payloadProblem(definition, record);
  if (problem !== null) {
    throw new WorkflowProblemError(
      'trigger_input_invalid',
      'A synthetic trigger payload holds only what the trigger’s view holds, each of its type.',
      { members: { source: { pointer: `${PAYLOAD_POINTER}${problem.pointer}` } } },
    );
  }
  return { trigger: record, inputs: {} };
}

export async function startTestRun(
  deps: EngineDeps,
  acting: WorkflowActing,
  workflowId: string,
  body: TestRunBody,
): Promise<WorkflowRunRow> {
  const { environmentId } = acting.ctx;
  if (acting.environmentKind !== 'sandbox') {
    throw new WorkflowProblemError(
      'test_runs_sandbox_only',
      'Test runs are for sandbox environments.',
    );
  }
  const { attributes } = body.data;
  const { workflow, version } = await versionOf(
    deps,
    environmentId,
    workflowId,
    attributes['workflow-version-id'],
  );
  const definition: WorkflowDefinition = readDefinition(version.definition);
  const { context, moduleGrants } = await loadCheckContext(
    deps.db,
    environmentId,
    definition,
    workflow.kind,
    'publish',
  );
  const check = checkDefinition(definition, context);
  const grant = deriveGrant(definition, {
    registry: WORKFLOW_ACTIONS,
    egress: check.egress.length > 0,
    nested: [...moduleGrants, ...(await childGrants(deps.db, environmentId, definition)).grants],
  });
  assertHoldsGrant(acting, grant);
  const objectId = attributes['object-id'];
  const seed = await seedOf(deps, environmentId, definition, attributes);
  const started = await deps.db.transaction((tx) =>
    startWorkflowRunInTx(tx, deps, {
      environmentId,
      workflowId,
      workflowVersionId: version.id,
      triggerType: definition.trigger?.type ?? 'trigger-direct',
      creator: acting.actor,
      trigger: seed.trigger,
      inputs: seed.inputs,
      subjectIds: objectId === undefined ? [] : [objectId],
      causedByPrincipal: acting.actor.id,
      grant,
      test: {
        overrides: attributes.overrides ?? {},
        allowHosts: attributes['allow-hosts'] ?? [],
        acknowledgements: body.meta?.acknowledgements ?? [],
        allowTriggers: attributes['allow-triggers'] === true,
        endStep: attributes['end-step'] ?? null,
        startStep: attributes['start-step'] ?? null,
        egressAllowed: acting.principal.kind === 'user' && canViewPii(acting.principal),
      },
    }),
  );
  await wakeStartedRun(deps, started);
  return started.run;
}
