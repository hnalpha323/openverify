/**
 * Workflow 8A spec helpers (C146.3): a workflow from a definition, published by a user (C121.2: an
 * API key gets 403) and activated, and a run followed to its end. Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import type { OpenVerifyClient } from '@openverify/node';
import { expect } from '@playwright/test';
import type { StackInfo } from '../../src/stack-info.js';
import { recordingClient, signInToApi } from './platform.js';

type Definition = Parameters<OpenVerifyClient['workflows']['saveDraft']>[1]['definition'];
type WorkflowRun = Awaited<ReturnType<OpenVerifyClient['workflowRuns']['retrieve']>>['data'];

/** The seeded admin's client, which may publish; an API key may not. */
export async function adminClient(stack: StackInfo): Promise<OpenVerifyClient> {
  const token = await signInToApi(stack, stack.operators.admin);
  return recordingClient(stack.apiUrl, token).client;
}

export const specKey = (prefix: string): string =>
  `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

/** `next` edges along `ids`, then the output node. */
export function chainDefinition(
  trigger: unknown,
  steps: readonly Record<string, unknown>[],
  more: Record<string, unknown> = {},
): Definition {
  const ids = ['trigger', ...steps.map(({ id }) => String(id)), 'output'];
  return {
    'schema-version': 1,
    trigger,
    inputs: [],
    variables: [],
    steps: [...steps, { id: 'output', type: 'output', name: 'Output', mappings: {} }],
    edges: ids.slice(1).map((to, index) => ({
      id: `edge_${String(index)}`,
      from: ids[index],
      'from-port': 'next',
      to,
    })),
    outputs: [],
    layout: {},
    ...more,
  } as unknown as Definition;
}

export function actionStep(id: string, key: string, config: Record<string, unknown>) {
  return { id, type: 'action', name: id, 'action-key': key, 'action-version': 1, config };
}

/** A running workflow on `definition`: created, drafted, published and activated by `admin`. */
export async function runningWorkflow(
  admin: OpenVerifyClient,
  name: string,
  definition: Definition,
  acknowledgements: readonly string[] = [],
): Promise<string> {
  const { data: workflow } = await admin.workflows.create({ name });
  await admin.workflows.saveDraft(workflow.id, { definition, 'lock-version': 1 });
  await admin.workflows.publish(workflow.id, {
    description: 'Synthetic e2e version.',
    acknowledgements: acknowledgements.map((key) => ({ key })),
  } as never);
  await admin.workflows.activate(workflow.id);
  return workflow.id;
}

/** Waits for the run to end, in `timeoutMs`: a route-started run's first step is enqueued at once. */
export async function waitForRunEnd(
  client: OpenVerifyClient,
  runId: string,
  timeoutMs = 60_000,
): Promise<WorkflowRun> {
  await expect
    .poll(async () => (await client.workflowRuns.retrieve(runId)).data.attributes.status, {
      timeout: timeoutMs,
      intervals: [250, 500, 1_000],
    })
    .not.toBe('in_progress');
  return (await client.workflowRuns.retrieve(runId)).data;
}

/** Waits for the run a filter finds, for an event-triggered one. */
export async function waitForRunOf(
  client: OpenVerifyClient,
  workflowId: string,
  timeoutMs = 60_000,
): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const { data } = await client.workflowRuns.list({ filter: { 'workflow-id': workflowId } });
        id = data[0]?.id;
        return id;
      },
      { timeout: timeoutMs, intervals: [250, 500, 1_000] },
    )
    .toBeDefined();
  return id ?? '';
}
