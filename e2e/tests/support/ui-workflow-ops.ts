/**
 * Workflow 8D (console-ops): helpers of `ui-workflow-ops.spec.ts`. Each object a spec makes carries
 * a random suffix, so it never meets another run's on a reused stack. Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import type { OpenVerifyClient } from '@openverify/node';
import type { StackInfo } from '../../src/stack-info.js';
import { actionStep, chainDefinition } from './workflows.js';

type Definition = Parameters<OpenVerifyClient['workflows']['saveDraft']>[1]['definition'];

/** A short random suffix. */
export const opsSuffix = (): string => randomUUID().replaceAll('-', '').slice(0, 10);

/** A Slack incoming-webhook URL of the right shape, which the sandbox provider never posts to. */
export const syntheticSlackUrl = (): string =>
  `https://hooks.slack.com/services/T0SYNTHETIC/B0SYNTHETIC/${randomUUID().replaceAll('-', '')}`;

/**
 * C118.5, C116.2: a manual-run workflow over accounts whose one step waits an hour, so a run it
 * starts stays unfinished until something cancels it.
 */
export function heldManualDefinition(): Definition {
  return chainDefinition({ type: 'trigger-direct', config: { 'object-type': 'account' } }, [
    { id: 'hold', type: 'wait', name: 'Hold for an hour', mode: 'time', seconds: 3600 },
  ]);
}

/** C126.3: an API-triggered draft whose one step posts to Slack through the secret `key`. */
export function slackDefinition(key: string): Definition {
  return chainDefinition({ type: 'trigger-api', config: {} }, [
    actionStep('notify', 'send_slack_message', {
      'webhook-secret': `{{secrets.${key}}}`,
      text: 'A synthetic test run reached this step.',
    }),
  ]);
}

/** A workflow with its draft, never published; the caller archives it. */
export async function draftWorkflow(
  admin: OpenVerifyClient,
  name: string,
  definition: Definition,
): Promise<string> {
  const { data: workflow } = await admin.workflows.create({ name });
  await admin.workflows.saveDraft(workflow.id, { definition, 'lock-version': 1 });
  return workflow.id;
}

/** Publishes `definition` as the workflow's next version (8A amendment 51: lock version 0). */
export async function publishNextVersion(
  admin: OpenVerifyClient,
  workflowId: string,
  definition: Definition,
): Promise<void> {
  await admin.workflows.saveDraft(workflowId, { definition, 'lock-version': 0 });
  await admin.workflows.publish(workflowId, { description: 'Synthetic second version.' });
}

/** An account of a new account type of its own. */
export async function syntheticAccount(admin: OpenVerifyClient, suffix: string): Promise<string> {
  const { data: type } = await admin.accountTypes.create({
    name: `e2e-ui-workflow-ops-type-${suffix}`,
    'fields-schema': {},
  });
  const { data: account } = await admin.accounts.create({
    'reference-id': `e2e-ui-workflow-ops-account-${suffix}`,
    'account-type-id': type.id,
  });
  return account.id;
}

/** Pauses (when running) and archives a workflow; a missing one is left as it is. */
export async function endWorkflow(admin: OpenVerifyClient, workflowId: string | undefined) {
  if (workflowId === undefined) {
    return;
  }
  const { data } = await admin.workflows.retrieve(workflowId);
  if (data.attributes.status === 'running') {
    await admin.workflows.pause(workflowId);
  }
  if (data.attributes.status !== 'archived') {
    await admin.workflows.archive(workflowId);
  }
}

/** The sandbox environment of the stack, where test runs run. */
export const sandboxOf = (stack: StackInfo): string => stack.environments.sandbox;
