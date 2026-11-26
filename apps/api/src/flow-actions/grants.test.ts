/**
 * C152.2 (Workflow 9A, `api-flow-actions`; review F17): what a template's `run_workflow` steps ask of
 * the publish:
 * - each target is a workflow of the template's environment whose published version (the pinned
 *   one, or the latest) takes `trigger-flow`;
 * - the publisher holds `workflows:trigger`, every scope of the target version's grant, and
 *   `pii:view` when the grant has PII (an API key by its scopes, a user by its roles; a revoked key
 *   holds nothing);
 * - a target with egress marks needs `egress:<step id>` acknowledged;
 * - the publish stores each step's target grant and egress, which every entry is checked against.
 *
 * Every value is synthetic.
 */
import { createHash } from 'node:crypto';
import { createApiKey, createRole, createUser, setUserRoles } from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { flowV2Schema, type FlowAction, type AnyFlow } from '@openverify/flow-spec';
import type { AuditActor } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  chain,
  createEngineHarness,
  createEngineHarnessOn,
  output,
  publish,
  type EngineHarness,
} from '../workflows/engine/testing.js';
import {
  flowActionAcknowledgements,
  flowActionGrantProblems,
  flowActionPublishGrants,
} from './grants.js';

let harness: EngineHarness;

beforeAll(async () => {
  harness = await createEngineHarness([]);
}, 120_000);

afterAll(async () => {
  await harness.close();
});

/** A running workflow whose published version takes `trigger-flow`, with its grant and egress. */
async function flowWorkflow(
  options: {
    grant?: { scopes: string[]; pii: boolean };
    egress?: unknown[];
    trigger?: string;
    on?: EngineHarness;
  } = {},
) {
  const on = options.on ?? harness;
  const definition = chain([], {
    steps: [output({ decision: 'approve' })],
    outputs: [{ name: 'decision', pii: false }],
  });
  const published = await publish(on, definition);
  await on.database.client.query(
    `update workflow_versions set trigger_type = $4, "grant" = $2::jsonb, egress = $3::jsonb
      where id = $1`,
    [
      published.workflowVersionId,
      JSON.stringify(options.grant ?? { scopes: [], pii: false }),
      JSON.stringify(options.egress ?? []),
      options.trigger ?? 'trigger-flow',
    ],
  );
  return published;
}

const runStep = (id: string, action: Partial<Extract<FlowAction, { kind: 'run_workflow' }>>) => ({
  id,
  type: 'action',
  action: { kind: 'run_workflow', version: 'latest-published', ...action },
});

/** A v2 flow: a consent screen at index 0, then the given action steps, then the terminals. */
function flowWith(...steps: ReturnType<typeof runStep>[]): AnyFlow {
  const ids = steps.map(({ id }) => id);
  return flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'flow-grants', version: 1, name: 'Grants' },
    entry: ids[0],
    steps: [...steps, { id: 'done', type: 'completion' }, { id: 'stopped', type: 'failure' }],
    edges: ids.flatMap((id, index) => [
      { id: `${id}-next`, from: id, port: 'next', to: ids[index + 1] ?? 'done' },
      { id: `${id}-error`, from: id, port: 'error', to: 'stopped' },
    ]),
  });
}

async function keyHolding(scopes: string[], revoked = false): Promise<AuditActor> {
  const id = testId('key');
  await createApiKey(harness.db, harness.environmentId, {
    id,
    name: 'Publisher',
    prefix: 'ov_test',
    secretHash: createHash('sha256').update(id).digest('hex'),
    scopes,
  });
  if (revoked) {
    await harness.database.client.query(`update api_keys set revoked_at = now() where id = $1`, [
      id,
    ]);
  }
  return { type: 'api-key', id };
}

async function userHolding(permissions: string[]): Promise<AuditActor> {
  const id = testId('usr');
  await createUser(harness.db, {
    id,
    organizationId: harness.organizationId,
    email: `${id}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$change-me$change-me',
  });
  const role = await createRole(harness.db, harness.organizationId, {
    id: testId('role'),
    name: `Publisher ${id}`,
    permissions,
  });
  await setUserRoles(harness.db, harness.organizationId, id, [role.id]);
  return { type: 'user', id };
}

const problemsOf = (flow: AnyFlow, publisher: AuditActor) =>
  flowActionGrantProblems({
    db: harness.db,
    environmentId: harness.environmentId,
    flow,
    publisher,
  });

describe('the publisher holds every run_workflow target’s grant (C152.2; F17)', () => {
  it('finds nothing for a v1 flow, or a publisher holding the trigger and the grant', async () => {
    const { workflowId } = await flowWorkflow({
      grant: { scopes: ['accounts:write'], pii: false },
    });
    const holder = await keyHolding(['workflows:trigger', 'accounts:write']);
    expect(await problemsOf(flowWith(runStep('run_a', { workflowId })), holder)).toEqual([]);
    const v1 = {
      metadata: { specVersion: 1, id: 'v1', version: 1, name: 'v1' },
      steps: [{ id: 'done', type: 'completion' }],
      transitions: [],
    } as unknown as AnyFlow;
    expect(await problemsOf(v1, await keyHolding([]))).toEqual([]);
  });

  it('refuses a publisher without workflows:trigger, a grant scope or pii:view, at the step', async () => {
    const plain = await flowWorkflow({ grant: { scopes: ['accounts:write'], pii: false } });
    const personal = await flowWorkflow({ grant: { scopes: [], pii: true } });
    const flow = flowWith(
      runStep('run_a', { workflowId: plain.workflowId }),
      runStep('run_b', { workflowId: personal.workflowId }),
    );
    const problems = await problemsOf(flow, await keyHolding(['inquiries:read']));
    expect(problems).toEqual([
      {
        code: 'workflow_grant_missing',
        pointer: '/flow/steps/0/action/workflowId',
        detail: expect.stringContaining('workflows:trigger, accounts:write') as unknown,
      },
      {
        code: 'workflow_grant_missing',
        pointer: '/flow/steps/1/action/workflowId',
        detail: expect.stringContaining('workflows:trigger, pii:view') as unknown,
      },
    ]);
  });

  it('reads a user’s permissions from its roles, and a revoked key as holding nothing', async () => {
    const { workflowId } = await flowWorkflow({ grant: { scopes: ['accounts:write'], pii: true } });
    const flow = flowWith(runStep('run_a', { workflowId }));
    const user = await userHolding(['workflows:trigger', 'accounts:write', 'pii:view']);
    expect(await problemsOf(flow, user)).toEqual([]);
    const revoked = await keyHolding(['workflows:trigger', 'accounts:write', 'pii:view'], true);
    expect(await problemsOf(flow, revoked)).toMatchObject([{ code: 'workflow_grant_missing' }]);
    expect(await problemsOf(flow, { type: 'workflow-run', id: testId('wfr') })).toMatchObject([
      { code: 'workflow_grant_missing' },
    ]);
  });

  it('refuses a workflow of another environment, one with no flow version, and a foreign pin', async () => {
    const other = await createEngineHarnessOn(harness);
    const elsewhere = await flowWorkflow({ on: other });
    const api = await flowWorkflow({ trigger: 'trigger-api' });
    const mine = await flowWorkflow();
    const theirs = await flowWorkflow();
    const flow = flowWith(
      runStep('run_a', { workflowId: elsewhere.workflowId }),
      runStep('run_b', { workflowId: api.workflowId }),
      runStep('run_c', { workflowId: mine.workflowId, version: theirs.workflowVersionId }),
    );
    const problems = await problemsOf(flow, await keyHolding(['workflows:trigger']));
    expect(problems.map(({ code, pointer }) => ({ code, pointer }))).toEqual([
      { code: 'workflow_unknown', pointer: '/flow/steps/0/action/workflowId' },
      { code: 'workflow_trigger_invalid', pointer: '/flow/steps/1/action/workflowId' },
      { code: 'workflow_unpublished', pointer: '/flow/steps/2/action/version' },
    ]);
  });
});

describe('what a publish stores and acknowledges for each run_workflow step (C152.2)', () => {
  it('records each step’s resolved version, its grant and its egress steps', async () => {
    const egress = [{ 'step-id': 'send', paths: ['trigger.country'], destination: 'example.com' }];
    const first = await flowWorkflow({ grant: { scopes: ['accounts:write'], pii: true }, egress });
    const second = await flowWorkflow();
    const flow = flowWith(
      runStep('run_a', { workflowId: first.workflowId }),
      runStep('run_b', { workflowId: second.workflowId, version: second.workflowVersionId }),
    );
    const context = { db: harness.db, environmentId: harness.environmentId, flow };
    expect(await flowActionPublishGrants(context)).toEqual([
      {
        stepId: 'run_a',
        workflowId: first.workflowId,
        workflowVersionId: first.workflowVersionId,
        scopes: ['accounts:write'],
        pii: true,
        egress: ['send'],
      },
      {
        stepId: 'run_b',
        workflowId: second.workflowId,
        workflowVersionId: second.workflowVersionId,
        scopes: [],
        pii: false,
        egress: [],
      },
    ]);
    expect(await flowActionAcknowledgements(context)).toEqual(['egress:run_a']);
  });

  it('stores nothing and asks nothing for a v1 flow or a target that cannot run', async () => {
    const v1 = {
      metadata: { specVersion: 1, id: 'v1', version: 1, name: 'v1' },
      steps: [{ id: 'done', type: 'completion' }],
      transitions: [],
    } as unknown as AnyFlow;
    const context = { db: harness.db, environmentId: harness.environmentId };
    expect(await flowActionPublishGrants({ ...context, flow: v1 })).toEqual([]);
    const flow = flowWith(runStep('run_a', { workflowId: testId('wfl') }));
    expect(await flowActionPublishGrants({ ...context, flow })).toEqual([]);
    expect(await flowActionAcknowledgements({ ...context, flow })).toEqual([]);
  });
});
