/**
 * Workflow 9B Stage 1b, checkpoint (F): the columns `foundation-9b` adds for the 9A items S4-12
 * carried (the orchestrator's decisions before 9B, 2; contracts B44, B45), as the API reads them:
 *
 * - `inquiry_template_versions.flow_run_grants` is the record `run-workflow.ts`' `recordedGrantOf`
 *   reads: a `latest-published` target holding a scope starts its run once the template's publish
 *   recorded that grant, and a target wider than the record still starts nothing
 *   (`workflow_grant_widened`; C152.2, review P07). Storing `flowActionPublishGrants` at publish is
 *   `api-templates-finish`'s;
 * - the per-inquiry windows' bounds in the database are C11's, the contract's
 *   (`packages/db` cannot read contracts). Writing and applying them is `api-flow-expiry`'s.
 *
 * Every value is synthetic.
 */
import { MAX_EXPIRATION_SECONDS, MIN_EXPIRATION_SECONDS } from '@openverify/contracts';
import type { FlowRunGrantRecord } from '@openverify/core';
import * as dbExports from '@openverify/db';
import type { Db } from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { flowV2Schema, type FlowAction, type FlowV2 } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFlowActionInTx, type FlowActionDeps } from './flow-actions/run-action.js';
import { ulidIdGenerator } from './ports.js';
import { fixedClock } from './test-support/fakes.js';
import {
  chain,
  createEngineHarness,
  output,
  publish,
  type EngineHarness,
} from './workflows/engine/testing.js';

let harness: EngineHarness;
let deps: FlowActionDeps;

beforeAll(async () => {
  harness = await createEngineHarness([]);
  deps = {
    events: harness.events,
    clock: fixedClock(),
    db: harness.db,
    ids: ulidIdGenerator,
    workflowSteps: harness.steps,
  };
}, 120_000);

afterAll(async () => {
  await harness.close();
});

const STEP = 'run_check';

const flowRunning = (action: FlowAction): FlowV2 =>
  flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'flow-run', version: 1, name: 'Run a workflow' },
    entry: STEP,
    steps: [
      { id: STEP, type: 'action', action },
      { id: 'done', type: 'completion' },
      { id: 'stopped', type: 'failure' },
    ],
    edges: [
      { id: 'e1', from: STEP, port: 'next', to: 'done' },
      { id: 'e2', from: STEP, port: 'error', to: 'stopped' },
    ],
  });

/** A running workflow whose published version takes `trigger-flow` with `grant`, no egress. */
async function flowWorkflow(grant: { scopes: string[]; pii: boolean }) {
  const definition = chain([], {
    steps: [output({ decision: 'approve' })],
    outputs: [{ name: 'decision', pii: false }],
  });
  const published = await publish(harness, {
    ...definition,
    trigger: { type: 'trigger-flow', config: {} },
  } as never);
  await harness.database.client.query(
    `update workflow_versions set trigger_type = 'trigger-flow', "grant" = $2::jsonb, egress = '[]'::jsonb
      where id = $1`,
    [published.workflowVersionId, JSON.stringify(grant)],
  );
  return published;
}

/** An inquiry on a template whose flow runs the workflow's latest published version. */
async function inquiryRunning(workflowId: string) {
  const action: FlowAction = {
    kind: 'run_workflow',
    workflowId,
    version: 'latest-published',
    timeoutSeconds: 30,
  };
  const { inquiry } = await createTestInquiry(harness.db, harness.environmentId, {
    flow: flowRunning(action) as unknown as Record<string, unknown>,
  });
  return { ref: { environmentId: harness.environmentId, inquiryId: inquiry.id }, action };
}

/** Writes the records the template's publish would have stored (`api-templates-finish`'s). */
async function recordGrants(inquiryId: string, records: FlowRunGrantRecord[]) {
  await harness.database.client.query(
    `update inquiry_template_versions set flow_run_grants = $2::jsonb
      where id = (select inquiry_template_version_id from inquiries where id = $1)`,
    [inquiryId, JSON.stringify(records)],
  );
}

const enter = async (ref: { environmentId: string; inquiryId: string }, action: FlowAction) => {
  const outcome = await harness.db.transaction((tx) =>
    runFlowActionInTx(tx as Db, deps, ref, { stepId: STEP, entry: 1, action }),
  );
  await harness.events.dispatch(outcome.staged);
  await outcome.after?.();
  return outcome;
};

describe('flow_run_grants as run_workflow reads it (C152.2; 9A amendment 31, contracts B45)', () => {
  const recordFor = (
    workflowId: string,
    workflowVersionId: string,
    grant: { scopes: string[]; pii: boolean },
  ): FlowRunGrantRecord => ({
    stepId: STEP,
    workflowId,
    workflowVersionId,
    scopes: grant.scopes,
    pii: grant.pii,
    egress: [],
  });

  it('starts a latest-published target holding a scope once the publish recorded that grant', async () => {
    const grant = { scopes: ['inquiries:read'], pii: false };
    const { workflowId, workflowVersionId } = await flowWorkflow(grant);
    const { ref, action } = await inquiryRunning(workflowId);
    await recordGrants(ref.inquiryId, [recordFor(workflowId, workflowVersionId, grant)]);

    expect(await enter(ref, action)).toMatchObject({
      state: 'done',
      port: 'next',
      errorType: null,
    });
  });

  it('still starts nothing for a target wider than the recorded grant', async () => {
    const { workflowId, workflowVersionId } = await flowWorkflow({
      scopes: ['inquiries:read'],
      pii: true,
    });
    const { ref, action } = await inquiryRunning(workflowId);
    await recordGrants(ref.inquiryId, [
      recordFor(workflowId, workflowVersionId, { scopes: ['inquiries:read'], pii: false }),
    ]);

    expect(await enter(ref, action)).toMatchObject({
      state: 'done',
      port: 'error',
      errorType: 'workflow_grant_widened',
    });
  });
});

describe('the per-inquiry expiry windows’ bounds (C151.10; contracts B44)', () => {
  it('holds the database’s bounds equal to C11’s (packages/db cannot read contracts)', () => {
    expect(
      (dbExports as Readonly<Record<string, unknown>>).INQUIRY_EXPIRY_OVERRIDE_SECONDS,
    ).toEqual({ min: MIN_EXPIRATION_SECONDS, max: MAX_EXPIRATION_SECONDS });
  });
});
