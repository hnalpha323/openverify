/**
 * Workflow 8C review (C141.8): helpers of `ui-workflows.spec.ts`. A definition typed into the
 * console's draft editor, and the names the spec's objects carry. Workflow 8D: a completed inquiry
 * for the decision records, and an account with an account action, for axe on those pages. Every
 * value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import type { OpenVerifyClient } from '@openverify/node';
import { expect } from '@playwright/test';
import type { StackInfo } from '../../src/stack-info.js';
import { chainDefinition, runningWorkflow } from './workflows.js';

/** A short random suffix, so a spec's objects never meet another run's on a reused stack. */
export const uniqueSuffix = (): string => randomUUID().replaceAll('-', '').slice(0, 10);

/** The smallest publishable definition: the API trigger straight to the output (C113.1). */
export function apiTriggerDefinition(): Record<string, unknown> {
  return {
    'schema-version': 1,
    trigger: { type: 'trigger-api', config: {} },
    inputs: [],
    variables: [],
    steps: [{ id: 'output', type: 'output', name: 'Output', mappings: {} }],
    edges: [{ id: 'edge_0', from: 'trigger', 'from-port': 'next', to: 'output' }],
    outputs: [],
    layout: {},
  };
}

/** A canary typed as a secret value: never a real credential, and its last four are known. */
export const SECRET_CANARY = 'canary-not-a-real-secret-ui8c';

/**
 * An inquiry of the spec's own, completed through the sandbox's simulate actions, so the inquiry
 * page has a decision-records section to show (C142.4). Synthetic name, random reference.
 */
export async function completedInquiry(
  client: OpenVerifyClient,
  stack: StackInfo,
  suffix: string,
): Promise<string> {
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `e2e-ui-workflows-decisions-${suffix}`,
    fields: { name_first: 'Synthetic', name_last: 'Decided' },
  });
  await client.inquiries.performSimulateActions(inquiry.id, {
    actions: [{ type: 'start_inquiry' }, { type: 'complete_inquiry' }],
  });
  await expect
    .poll(async () => (await client.inquiries.retrieve(inquiry.id)).data.attributes.status, {
      timeout: 20_000,
    })
    .toBe('completed');
  return inquiry.id;
}

export interface AccountWithAction {
  readonly accountId: string;
  readonly actionId: string;
  readonly label: string;
  readonly workflowId: string;
}

/**
 * An account of a new account type with one account action (C118.7): a running `trigger-account`
 * workflow taking one optional input, bound to the type, so the account page lists it under
 * "Workflow actions" (C141.7). `endAccountAction` archives what keeps running.
 */
export async function accountWithAction(
  admin: OpenVerifyClient,
  suffix: string,
): Promise<AccountWithAction> {
  const { data: type } = await admin.accountTypes.create({
    name: `e2e-ui-workflows-type-${suffix}`,
    'fields-schema': {},
  });
  const workflowId = await runningWorkflow(
    admin,
    `e2e ui workflows account action ${suffix}`,
    chainDefinition({ type: 'trigger-account', config: {} }, [], {
      inputs: [{ name: 'reason', type: 'string', required: false }],
    }),
  );
  const label = `Synthetic re-check ${suffix}`;
  const { data: action } = await admin.accountActions.create({
    'workflow-id': workflowId,
    'account-type-id': type.id,
    label,
  });
  const { data: account } = await admin.accounts.create({
    'reference-id': `e2e-ui-workflows-account-${suffix}`,
    'account-type-id': type.id,
  });
  return { accountId: account.id, actionId: action.id, label, workflowId };
}

/** Archives the account action and its workflow (paused first); nothing else keeps running. */
export async function endAccountAction(
  admin: OpenVerifyClient,
  made: AccountWithAction | undefined,
): Promise<void> {
  if (made === undefined) {
    return;
  }
  await admin.accountActions.update(made.actionId, { status: 'archived' });
  await admin.workflows.pause(made.workflowId);
  await admin.workflows.archive(made.workflowId);
}
