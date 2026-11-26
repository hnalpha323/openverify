/**
 * C141.8 (Workflow 8C review): the workflow console on the full stack. Budget: 90 s for the file.
 *
 * A developer creates a workflow, moves through its outline by keyboard alone, types a definition
 * that the outline follows, checks and saves it, publishes it and activates it; a run the API
 * starts is reran from its run page. The secrets page creates a key, sets its value (only the last
 * four come back) and deletes it. The draft editor loads under an injected nonce script and style
 * CSP with no violation. Axe finds no WCAG 2.0 to 2.2 A or AA violation on /workflows, a workflow,
 * its draft, a run, /secrets, an inquiry's decision records and an account's workflow actions
 * (Workflow 8D, C141.8). Every object is created inside the spec; the operator signs in through
 * `signInAs`.
 */
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { recordingClient } from './support/platform.js';
import { sessionTokenAs, signInAs } from './support/ui.js';
import { expectNoAxeViolations } from './support/ui-axe.js';
import { recordCspViolations } from './support/ui-graph.js';
import {
  SECRET_CANARY,
  accountWithAction,
  apiTriggerDefinition,
  completedInquiry,
  endAccountAction,
  uniqueSuffix,
  type AccountWithAction,
} from './support/ui-workflows.js';
import { adminClient, waitForRunEnd } from './support/workflows.js';

test.describe.configure({ mode: 'serial' });

let workflowId: string | undefined;

test('a developer creates, outlines by keyboard, checks, saves, publishes and activates a workflow, then reruns its run (C141.2 to C141.6)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const stack = readStackInfo();
  await signInAs(page, stack, 'developer');
  await page.goto(`${stack.dashboardUrl}/workflows`);

  const create = page.getByRole('form', { name: 'Create a workflow' });
  await expect(create).toBeVisible();
  await expectNoAxeViolations(page, '/workflows');
  await create
    .getByRole('textbox', { name: 'Name' })
    .fill(`Synthetic UI workflow ${uniqueSuffix()}`);
  await create.getByRole('button', { name: 'Create workflow' }).click();
  await page.waitForURL(/\/workflows\/wfl_[0-9A-Z]{26}\/draft$/);
  workflowId = /\/workflows\/(wfl_[0-9A-Z]{26})\/draft$/.exec(page.url())?.[1];
  expect(workflowId).toBeDefined();

  // The outline by keyboard alone: one tab stop, the arrows inside it.
  const tree = page.getByRole('tree', { name: 'Outline of the definition' });
  await expect(tree.getByRole('treeitem', { name: 'Trigger: No trigger yet' })).toBeVisible();
  await expectNoAxeViolations(page, '/workflows/[id]/draft');

  // The definition is typed; the outline follows it before anything is saved.
  await page
    .getByRole('textbox', { name: /Definition/ })
    .fill(JSON.stringify(apiTriggerDefinition(), null, 2));
  const trigger = tree.getByRole('treeitem', { name: 'Trigger: The API' });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(tree.getByRole('treeitem', { name: 'Output: Output' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('No problems found.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('The draft was saved. No problems found.')).toBeVisible();

  // Publish with its dialog, then activate.
  await page.goto(`${stack.dashboardUrl}/workflows/${workflowId ?? ''}`);
  await expect(page.getByRole('button', { name: 'Publish the draft' })).toBeVisible();
  await expectNoAxeViolations(page, '/workflows/[id]');
  await page.getByRole('button', { name: 'Publish the draft' }).click();
  const publish = page.getByRole('dialog', { name: 'Publish the draft' });
  await publish.getByRole('textbox', { name: 'Change note' }).fill('Synthetic first version');
  await publish.getByRole('button', { name: 'Publish' }).click();
  await expect(publish).toBeHidden();
  await expect(page.getByText('The draft was published.')).toBeVisible();
  await page.getByRole('button', { name: 'Activate' }).click();
  const activate = page.getByRole('dialog', { name: 'Activate this workflow?' });
  await activate.getByRole('button', { name: 'Activate' }).click();
  await expect(activate).toBeHidden();
  await expect(page.locator('dt:text-is("Status") + dd')).toHaveText('Running');

  // A run the API starts, reran from its page; the rerun opens the new run.
  const admin = await adminClient(stack);
  const { data: started } = await admin.workflows.trigger(workflowId ?? '', {});
  await waitForRunEnd(admin, started.id);
  await page.goto(`${stack.dashboardUrl}/workflows/runs/${started.id}`);
  const controls = page.getByRole('group', { name: 'Run actions' });
  await expect(controls).toBeVisible();
  await expectNoAxeViolations(page, '/workflows/runs/[id]');
  await controls.getByRole('button', { name: 'Rerun' }).click();
  await page
    .getByRole('dialog', { name: 'Rerun this run?' })
    .getByRole('button', { name: 'Rerun' })
    .click();
  await page.waitForURL(
    (url) =>
      /\/workflows\/runs\/wfr_[0-9A-Z]{26}$/.test(url.pathname) &&
      !url.pathname.endsWith(started.id),
  );
});

test('the secrets page creates a key, sets its value showing only the last four, and deletes it (C125, C141.7)', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  const key = `ui_secret_${uniqueSuffix()}`;
  await signInAs(page, stack, 'developer');
  await page.goto(`${stack.dashboardUrl}/secrets`);

  const create = page.getByRole('form', { name: 'Create a secret' });
  await expect(create).toBeVisible();
  await expectNoAxeViolations(page, '/secrets');
  await create.getByRole('textbox', { name: /Key/ }).fill(key);
  await create.getByRole('textbox', { name: /Allowed hosts/ }).fill('hooks.example.com');
  await create.getByRole('button', { name: 'Create secret' }).click();
  const row = page.getByRole('row', { name: new RegExp(key) });
  await expect(row).toContainText('No value in this environment');

  await row.getByRole('button', { name: `Set the value of ${key}` }).click();
  const dialog = page.getByRole('dialog', { name: `Set the value of ${key}` });
  await dialog.getByLabel(/Value/).fill(SECRET_CANARY);
  await dialog.getByRole('button', { name: 'Save value' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText(`Ends in ${SECRET_CANARY.slice(-4)} (version 1)`);
  await expect(page.getByText(SECRET_CANARY)).toHaveCount(0);

  await row.getByRole('button', { name: `Delete ${key}` }).click();
  await page
    .getByRole('dialog', { name: `Delete ${key}?` })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByRole('row', { name: new RegExp(key) })).toHaveCount(0);
});

test('the draft editor loads under the console’s real nonce CSP header with no violation (C141.8, C170.3)', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  await signInAs(page, stack, 'developer');
  const violations = await recordCspViolations(page);
  const url = `${stack.dashboardUrl}/workflows/${workflowId ?? ''}/draft`;
  // C170.3 (Workflow 9C): the console sends its own nonce policy since [9c-checkpoint:csp], so the
  // Phase 8 injected policy gives way to the real header.
  const document = page.waitForResponse(url);
  await page.goto(url);
  const policy = (await document).headers()['content-security-policy'] ?? '';
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toMatch(/style-src 'self' 'nonce-/);
  const trigger = page.getByRole('treeitem', { name: 'Trigger: The API' });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('treeitem', { name: 'Output: Output' })).toBeFocused();
  expect(await violations()).toEqual([]);
});

test('an inquiry’s decision records and an account’s workflow actions pass axe (C141.8, C142.4, C142.6)', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const stack = readStackInfo();
  const suffix = uniqueSuffix();
  const { client: admin } = recordingClient(stack.apiUrl, await sessionTokenAs(stack, 'admin'));
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  let made: AccountWithAction | undefined;
  try {
    const [inquiryId, account] = await Promise.all([
      completedInquiry(client, stack, suffix),
      accountWithAction(admin, suffix),
    ]);
    made = account;
    await signInAs(page, stack, 'developer');

    await page.goto(`${stack.dashboardUrl}/inquiries/${inquiryId}`);
    await expect(page.getByRole('region', { name: 'Decision records', exact: true })).toBeVisible();
    await expectNoAxeViolations(page, '/inquiries/[id] (decision records)');

    await page.goto(`${stack.dashboardUrl}/accounts/${account.accountId}`);
    const actions = page.getByRole('region', { name: 'Workflow actions', exact: true });
    await expect(actions).toContainText(account.label);
    await expectNoAxeViolations(page, '/accounts/[id] (workflow actions)');
  } finally {
    await endAccountAction(admin, made);
  }
});
