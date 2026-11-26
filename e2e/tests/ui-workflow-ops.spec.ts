/**
 * Workflow 8D (console-ops): the workflow console's operations on the full stack. Budget: 90 s for
 * the file.
 *
 * - A developer starts manual runs from ids on a running workflow over accounts (one started, one
 *   refused by its code), and after a second version is published cancels the runs of older
 *   versions: the held run ends canceled (C118.5, C116.2).
 * - A developer test-runs a draft whose step posts to Slack, in the sandbox: the run is linked and
 *   the message it recorded is found by the secret's id and reads "Recorded (sandbox)" (C120.7,
 *   C126.4).
 * - A developer edits a secret's allowed hosts; no value is asked for or shown (C125.2).
 * - An admin saves a workflow setting and restores it (C143.7).
 * - An admin opens a webhook's edit form, which shows its workflow filter (C143.4).
 * Axe finds no WCAG A or AA violation on each page opened. Every object is made inside the spec
 * and ended in `finally`; the operators sign in through `signInAs`. Trust Device has no step here:
 * a device exists only for a flow session with device recognition on, which is off by default.
 */
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { recordingClient } from './support/platform.js';
import { signInAs } from './support/ui.js';
import { expectNoAxeViolations } from './support/ui-axe.js';
import {
  draftWorkflow,
  endWorkflow,
  heldManualDefinition,
  opsSuffix,
  publishNextVersion,
  sandboxOf,
  slackDefinition,
  syntheticAccount,
  syntheticSlackUrl,
} from './support/ui-workflow-ops.js';
import { adminClient, runningWorkflow, specKey, waitForRunEnd } from './support/workflows.js';

test.describe.configure({ mode: 'serial' });

test('manual runs from ids, then a cancel of the older version’s runs (C118.5, C116.2)', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const stack = readStackInfo();
  const admin = await adminClient(stack);
  const suffix = opsSuffix();
  let workflowId: string | undefined;
  try {
    const accountId = await syntheticAccount(admin, suffix);
    workflowId = await runningWorkflow(
      admin,
      `e2e ui workflow ops manual ${suffix}`,
      heldManualDefinition(),
    );
    await signInAs(page, stack, 'developer');
    await page.goto(`${stack.dashboardUrl}/workflows/${workflowId}`);
    const manual = page.getByRole('form', { name: 'Start manual runs' });
    await expect(manual).toBeVisible();
    await expectNoAxeViolations(page, '/workflows/[id] (operations)');
    await manual
      .getByRole('textbox', { name: /Object ids/ })
      .fill(`${accountId}\nacc_01MB00000000000000000E2E00`);
    await manual.getByRole('button', { name: 'Start the runs' }).click();
    await expect(page.getByText('1 run started; 1 refused.')).toBeVisible();
    const runLink = page.getByRole('region', { name: 'Manual run results' }).getByRole('link');
    const runId = (await runLink.textContent())?.trim() ?? '';
    expect(runId).toMatch(/^wfr_[0-9A-Z]{26}$/);

    await publishNextVersion(admin, workflowId, heldManualDefinition());
    await page.reload();
    await page.getByRole('button', { name: 'Cancel older runs' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel the runs of older versions?' });
    await expect(dialog).toContainText('Effects already made stay made');
    await dialog
      .getByRole('combobox', { name: 'Runs of versions before' })
      .selectOption({ label: 'Version 2' });
    await dialog.getByRole('button', { name: 'Cancel the runs' }).click();
    await expect(page.getByText('One run was cancelled.')).toBeVisible();
    expect((await waitForRunEnd(admin, runId)).attributes.status).toBe('canceled');
  } finally {
    await endWorkflow(admin, workflowId);
  }
});

test('the sandbox test-run panel links its run and finds the Slack message it recorded (C120.7, C126.4)', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const stack = readStackInfo();
  const admin = await adminClient(stack);
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const key = specKey('e2e_ops_slack');
  const { data: secret } = await client.workflowSecrets.create({
    key,
    'allowed-hosts': ['hooks.slack.com'],
    'allowed-placements': { headers: [], 'body-pointers': [] },
  });
  let workflowId: string | undefined;
  try {
    await client.workflowSecrets.putValue(key, sandboxOf(stack), syntheticSlackUrl());
    workflowId = await draftWorkflow(
      admin,
      `e2e ui workflow ops test run ${opsSuffix()}`,
      slackDefinition(key),
    );
    await signInAs(page, stack, 'developer');
    await page.goto(`${stack.dashboardUrl}/workflows/${workflowId}/test-runs`);
    const form = page.getByRole('form', { name: 'Start a test run' });
    await expect(form).toBeVisible();
    await expectNoAxeViolations(page, '/workflows/[id]/test-runs');
    await form.getByRole('radio', { name: 'A synthetic payload' }).check();
    await form.getByRole('textbox', { name: 'Payload (JSON)' }).fill('{}');
    await form.getByRole('button', { name: 'Start the test run' }).click();
    await page.waitForURL(/[?&]run=wfr_[0-9A-Z]{26}/);
    const runId = new URL(page.url()).searchParams.get('run') ?? '';
    expect((await waitForRunEnd(admin, runId)).attributes.status).toBe('completed');

    await page.reload();
    const result = page.getByRole('region', { name: 'Test run result' });
    await expect(result.getByRole('link', { name: runId })).toBeVisible();
    const search = page.getByRole('form', { name: 'Find recorded messages' });
    await search.getByRole('combobox', { name: 'Kind' }).selectOption('slack');
    await search.getByRole('textbox', { name: 'Recipient' }).fill(secret.id);
    await search.getByRole('button', { name: 'Find messages' }).click();
    const records = page.getByRole('table', { name: 'Recorded messages' });
    // The record names the step's run (`wfst_`), as the sandbox list stores it.
    await expect(records).toContainText(/wfst_[0-9A-Z]{26}/);
    await expect(records).toContainText('Recorded (sandbox)');
    await expectNoAxeViolations(page, '/workflows/[id]/test-runs (a run and its messages)');
  } finally {
    await endWorkflow(admin, workflowId);
    await client.workflowSecrets.delete(key);
  }
});

test('a secret’s allowed hosts are edited, and no value is asked for or shown (C125.2)', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const key = specKey('e2e_ops_hosts');
  await client.workflowSecrets.create({ key, 'allowed-hosts': ['hooks.example.com'] });
  try {
    await signInAs(page, stack, 'developer');
    await page.goto(`${stack.dashboardUrl}/secrets`);
    const row = page.getByRole('row', { name: new RegExp(key) });
    await row.getByRole('button', { name: `Edit ${key}` }).click();
    const dialog = page.getByRole('dialog', { name: `Edit ${key}` });
    await expect(dialog.getByLabel(/Value/)).toHaveCount(0);
    await expectNoAxeViolations(page, '/secrets (edit dialog)');
    await dialog
      .getByRole('textbox', { name: /Allowed hosts/ })
      .fill('hooks.example.com\nreceiver.example.com');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText('hooks.example.com, receiver.example.com');
  } finally {
    await client.workflowSecrets.delete(key);
  }
});

test('an admin saves a workflow setting and restores it (C143.7)', async ({ page }) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  await signInAs(page, stack, 'admin');
  await page.goto(`${stack.dashboardUrl}/settings`);
  const cap = page.getByRole('spinbutton', { name: 'Steps in flight at once' });
  await expect(cap).toBeVisible();
  const original = await cap.inputValue();
  await expectNoAxeViolations(page, '/settings (workflow settings)');
  const save = async (value: string) => {
    await cap.fill(value);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.').last()).toBeVisible();
  };
  // Workflow 11B (C251.2, amendment 17; integration-11b, rule 12): a cap above the install ceiling
  // (OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX, 50 by default, the setting's default too) is refused, so the
  // spec lowers the cap rather than raising it.
  const changed = String(Number(original) > 1 ? Number(original) - 1 : Number(original) + 1);
  try {
    await save(changed);
    await page.reload();
    await expect(cap).toHaveValue(changed);
  } finally {
    await page.reload();
    if ((await cap.inputValue()) !== original) {
      await save(original);
    }
  }
});

test('a webhook’s edit form shows its workflow filter (C143.4)', async ({ page }) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  const admin = await adminClient(stack);
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const { data: made } = await admin.workflows.create({
    name: `e2e ui workflow ops webhook ${opsSuffix()}`,
  });
  const workflowId = made.id;
  const { data: webhook } = await client.webhooks.create({
    url: receiver.url,
    'enabled-events': ['workflow-run.completed'],
    filters: { 'workflow-ids': [workflowId] },
  });
  try {
    await signInAs(page, stack, 'admin');
    await page.goto(`${stack.dashboardUrl}/webhooks/${webhook.id}/edit`);
    await expect(page.getByRole('textbox', { name: 'Workflow IDs' })).toHaveValue(workflowId);
    await expect(page.getByRole('textbox', { name: 'Case template IDs' })).toHaveValue('');
    await expectNoAxeViolations(page, '/webhooks/[id]/edit (Phase 8 filters)');
  } finally {
    await client.webhooks.archive(webhook.id);
    await receiver.close();
    await endWorkflow(admin, workflowId);
  }
});
