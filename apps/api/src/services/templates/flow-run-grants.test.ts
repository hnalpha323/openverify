/**
 * C152.2 (9A Stage 3 amendment 31; contracts B45, foundation-9b F3; Workflow 9B,
 * `api-templates-finish`): a template version's `flow_run_grants`, the grant and egress each
 * `run_workflow` step's target held when the version was published, which every entry is checked
 * against (`run-workflow.ts`, review P07):
 *
 * - a publish stores `flowActionPublishGrants`' records, resolved in the publish's transaction, so a
 *   `latest-published` target holding a scope starts its run, and a later, wider version of the
 *   target starts nothing (`workflow_grant_widened`) until the template is published again;
 * - a target with egress marks needs `egress:<step id>` acknowledged by the publishing user
 *   (`flowActionAcknowledgements`), and its egress steps are recorded with the grant;
 * - a flow-spec 2 template created in one call stores them too, and a copy carries its source's.
 *
 * Every value is synthetic.
 */
import { defaultInquiryTemplateAttributes, type AuditActor } from '@openverify/contracts';
import type { FlowRunGrantRecord } from '@openverify/core';
import { createRole, createUser, setUserRoles, type Db } from '@openverify/db';
import { seedWorkflowVersion, testId } from '@openverify/db/testing';
import type { FlowAction } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFlowActionInTx, type FlowActionDeps } from '../../flow-actions/run-action.js';
import { ulidIdGenerator } from '../../ports.js';
import { bearer, createInquiry, createTemplate, expectStatus } from '../../test-support/harness.js';
import {
  chain,
  createEngineHarnessOnDatabase,
  output,
  publish,
  type EngineHarness,
} from '../../workflows/engine/testing.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';

let api: InquiryTestApi;
let harness: EngineHarness;
let deps: FlowActionDeps;

beforeAll(async () => {
  api = await createInquiryTestApi();
  harness = createEngineHarnessOnDatabase(
    api.database.db,
    { environment: { id: api.environmentId }, organization: { id: api.organizationId } },
    [],
    api.database,
  );
  deps = {
    events: harness.events,
    clock: api.clock,
    db: api.database.db,
    ids: ulidIdGenerator,
    workflowSteps: harness.steps,
  };
});

afterAll(async () => {
  await api.close();
});

const STEP = 'run_check';
const defaults = defaultInquiryTemplateAttributes();
const governmentId = defaults.flow.steps.find((step) => step.type === 'government_id');
const consent = defaults.flow.steps.find((step) => step.type === 'consent');

interface Grant {
  scopes: string[];
  pii: boolean;
}

/** Sets a published workflow version's trigger, grant and egress, as Phase 8's publish stores them. */
async function setVersion(versionId: string, grant: Grant, egress: unknown[]) {
  await api.database.client.query(
    `update workflow_versions set trigger_type = 'trigger-flow', "grant" = $2::jsonb,
       egress = $3::jsonb where id = $1`,
    [versionId, JSON.stringify(grant), JSON.stringify(egress)],
  );
}

/** A running workflow whose published version takes `trigger-flow` with `grant` and `egress`. */
async function flowWorkflow(grant: Grant, egress: unknown[] = []) {
  const definition = chain([], {
    steps: [output({ decision: 'approve' })],
    outputs: [{ name: 'decision', pii: false }],
  });
  const published = await publish(harness, {
    ...definition,
    trigger: { type: 'trigger-flow', config: {} },
  } as never);
  await setVersion(published.workflowVersionId, grant, egress);
  return published;
}

const actionOf = (workflowId: string): FlowAction => ({
  kind: 'run_workflow',
  workflowId,
  version: 'latest-published',
  timeoutSeconds: 30,
});

/** Consent, a government ID, then the run, whose two ports both reach a completion. */
const flowRunning = (workflowId: string) => ({
  metadata: { specVersion: 2, id: 'flow-grants', version: 1, name: 'Run a workflow' },
  entry: 'consent',
  steps: [
    { ...consent, id: 'consent' },
    { ...governmentId, id: 'id_card', maxAttempts: 1, captureMethods: ['upload'] },
    { id: STEP, type: 'action', action: actionOf(workflowId) },
    { id: 'done', type: 'completion' },
    { id: 'done_other', type: 'completion' },
  ],
  edges: [
    { id: 'e1', from: 'consent', port: 'next', to: 'id_card' },
    { id: 'e2', from: 'id_card', port: 'next', to: STEP },
    { id: 'e3', from: STEP, port: 'next', to: 'done' },
    { id: 'e4', from: STEP, port: 'error', to: 'done_other' },
  ],
});

const verificationConfig = { 'government-id': defaults['verification-config']['government-id'] };

/** A user of the organization holding `permissions` through a role, with its session token. */
async function publisher(permissions: string[]): Promise<{ actor: AuditActor; token: string }> {
  const id = testId('usr');
  await createUser(api.database.db, {
    id,
    organizationId: api.organizationId,
    email: `${id}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$change-me$change-me',
  });
  const role = await createRole(api.database.db, api.organizationId, {
    id: testId('role'),
    name: `Publisher ${id}`,
    permissions,
  });
  await setUserRoles(api.database.db, api.organizationId, id, [role.id]);
  return {
    actor: { type: 'user', id },
    token: api.newUserToken(api.environmentId, { userId: id }),
  };
}

/** A draft of the running flow on a new template. */
async function draftRunning(
  workflowId: string,
): Promise<{ templateId: string; versionId: string }> {
  const templateId = await createTemplate(api);
  const created = await api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiry-template-versions',
    headers: bearer(api.token),
    payload: {
      data: {
        attributes: {
          'inquiry-template-id': templateId,
          flow: flowRunning(workflowId),
          'verification-config': verificationConfig,
        },
      },
    },
  });
  return { templateId, versionId: expectStatus(created, 201).data.id };
}

/** The acknowledgements validate's publish mode asks of the draft. */
async function acknowledgementsOf(versionId: string, token: string): Promise<string[]> {
  const validated = expectStatus(
    await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiry-template-versions/${versionId}/validate`,
      headers: bearer(token),
      payload: { meta: { mode: 'publish' } },
    }),
    200,
  );
  return (validated.data.attributes as { 'acknowledgements-required': string[] })[
    'acknowledgements-required'
  ];
}

const publishDraft = (versionId: string, token: string, acknowledgements: string[]) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiry-template-versions/${versionId}/publish`,
    headers: bearer(token),
    payload: { meta: { acknowledgements } },
  });

/** The records a version stored, read from its column. */
async function grantsOf(versionId: string): Promise<FlowRunGrantRecord[]> {
  const { rows } = await api.database.client.query<{ flow_run_grants: FlowRunGrantRecord[] }>(
    'select flow_run_grants from inquiry_template_versions where id = $1',
    [versionId],
  );
  return rows[0]?.flow_run_grants ?? [];
}

const grant: Grant = { scopes: ['inquiries:read'], pii: false };
const NEEDED = ['workflows:trigger', 'inquiries:read'];

/** Publishes the running flow as the given user, with every acknowledgement it asks. */
async function publishedRunning(workflowId: string) {
  const { templateId, versionId } = await draftRunning(workflowId);
  const { token } = await publisher(NEEDED);
  const response = await publishDraft(versionId, token, await acknowledgementsOf(versionId, token));
  expect(response.statusCode, response.body).toBe(200);
  return { templateId, versionId };
}

/** Enters the run step of a new inquiry on the template, as the engine does. */
async function enterRun(templateId: string, workflowId: string) {
  const inquiryId = await createInquiry(api, { templateId });
  const ref = { environmentId: api.environmentId, inquiryId };
  const outcome = await api.database.db.transaction((tx) =>
    runFlowActionInTx(tx as Db, deps, ref, {
      stepId: STEP,
      entry: 1,
      action: actionOf(workflowId),
    }),
  );
  await harness.events.dispatch(outcome.staged);
  await outcome.after?.();
  return outcome;
}

describe('a publish records each run_workflow target’s grant (C152.2; amendment 31)', () => {
  it('stores the latest published version’s grant, resolved in the publish', async () => {
    const { workflowId, workflowVersionId } = await flowWorkflow(grant);
    const { versionId } = await publishedRunning(workflowId);

    expect(await grantsOf(versionId)).toEqual([
      {
        stepId: STEP,
        workflowId,
        workflowVersionId,
        scopes: ['inquiries:read'],
        pii: false,
        egress: [],
      },
    ]);
  });

  it('holds a latest-published target to the grant its publish recorded (review P07)', async () => {
    const { workflowId } = await flowWorkflow(grant);
    const { templateId } = await publishedRunning(workflowId);

    expect(await enterRun(templateId, workflowId)).toMatchObject({
      state: 'done',
      port: 'next',
      errorType: null,
    });

    // A later version of the target asks more than the publish recorded.
    const wider = await seedWorkflowVersion(api.database.db, api.environmentId, {
      workflowId,
      versionNumber: 2,
      status: 'published',
      definition: chain([], { steps: [output({ decision: 'approve' })] }),
    });
    await setVersion(wider.id, { scopes: ['inquiries:read', 'accounts:write'], pii: false }, []);

    expect(await enterRun(templateId, workflowId)).toMatchObject({
      state: 'done',
      port: 'error',
      errorType: 'workflow_grant_widened',
    });
  });

  it('refuses the publish without the target’s egress acknowledgement, then records the egress', async () => {
    const egress = [{ 'step-id': 'send', paths: ['trigger.country'], destination: 'example.com' }];
    const { workflowId, workflowVersionId } = await flowWorkflow(grant, egress);
    const { versionId } = await draftRunning(workflowId);
    const { token } = await publisher(NEEDED);
    const required = await acknowledgementsOf(versionId, token);
    expect(required).toContain(`egress:${STEP}`);

    const refused = await publishDraft(
      versionId,
      token,
      required.filter((key) => key !== `egress:${STEP}`),
    );
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({
      code: 'publish_acknowledgement_missing',
      errors: [{ pointer: '/meta/acknowledgements', detail: `egress:${STEP}` }],
    });
    expect(await grantsOf(versionId)).toEqual([]);

    expectStatus(await publishDraft(versionId, token, required), 200);
    expect(await grantsOf(versionId)).toEqual([
      {
        stepId: STEP,
        workflowId,
        workflowVersionId,
        scopes: ['inquiries:read'],
        pii: false,
        egress: ['send'],
      },
    ]);
  });

  it('stores them for a flow-spec 2 template created in one call, and a copy keeps its source’s', async () => {
    const { workflowId, workflowVersionId } = await flowWorkflow(grant);
    const created = expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/inquiry-templates',
        headers: bearer(api.token),
        payload: {
          data: {
            attributes: {
              name: 'Created with a run',
              flow: flowRunning(workflowId),
              'verification-config': verificationConfig,
            },
          },
        },
      }),
      201,
    );
    const versionOf = (document: { data: { attributes: unknown } }) =>
      (document.data.attributes as { 'current-version': { id: string } })['current-version'].id;
    const expected = [
      {
        stepId: STEP,
        workflowId,
        workflowVersionId,
        scopes: ['inquiries:read'],
        pii: false,
        egress: [],
      },
    ];
    expect(await grantsOf(versionOf(created))).toEqual(expected);

    const copied = expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiry-templates/${created.data.id}/copy`,
        headers: bearer(api.token),
        payload: { meta: { name: 'A copy with a run' } },
      }),
      201,
    );
    expect(await grantsOf(versionOf(copied))).toEqual(expected);
  });
});
