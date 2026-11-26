/**
 * C141.8 (Workflow 8D, console-editor): the workflow editor on the full stack. Budget: 90 s for the
 * file.
 *
 * A developer creates a workflow and authors it through the outline by keyboard alone: the API
 * trigger, a conditional with two routes and a wait on one of them. The canvas follows the outline,
 * undo and redo take a step back and forth, the draft is saved and then published through the
 * workflow page's own dialog. A second draft shows its change against the live version as a list
 * and as a canvas badge, and a refused value as an error badge on its step. The editor and its
 * canvas load under an injected nonce script and style CSP with no violation. A fourth workflow is
 * authored through a step form typed by the catalogue's config schema and a route condition that
 * reads a value that can be unknown, with its on-null chosen; once published and run, its run page
 * draws the path taken over the read-only canvas and as a list. Axe runs on each page the spec
 * opens. Every object is created inside the spec; the operator signs in through `signInAs`.
 */
import { expect, test, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { signInAs } from './support/ui.js';
import { adminClient, waitForRunEnd } from './support/workflows.js';
import { expectNoAxeViolations } from './support/ui-axe.js';
import { recordCspViolations } from './support/ui-graph.js';
import {
  addFromPalette,
  canvasNode,
  definitionOf,
  editorWorkflowName,
  outlineItem,
  pickFromMenu,
} from './support/ui-workflow-editor.js';

test.describe.configure({ mode: 'serial' });

let workflowId: string | undefined;

const draftUrl = (dashboardUrl: string) => `${dashboardUrl}/workflows/${workflowId ?? ''}/draft`;

/** The polite status of the editor's own edits. */
const editorStatus = (page: Page) => page.getByRole('status', { name: 'Editor status' });

test('a developer authors a trigger, a conditional with two routes and a wait through the outline by keyboard, with the canvas in sync, undo and redo, then saves and publishes (C141.2 to C141.5)', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const stack = readStackInfo();
  await signInAs(page, stack, 'developer');
  await page.goto(`${stack.dashboardUrl}/workflows`);
  const create = page.getByRole('form', { name: 'Create a workflow' });
  await create.getByRole('textbox', { name: 'Name' }).fill(editorWorkflowName());
  await create.getByRole('button', { name: 'Create workflow' }).click();
  await page.waitForURL(/\/workflows\/wfl_[0-9A-Z]{26}\/draft$/);
  workflowId = /\/workflows\/(wfl_[0-9A-Z]{26})\/draft$/.exec(page.url())?.[1];
  expect(workflowId).toBeDefined();
  await expect(outlineItem(page, 'Trigger: No trigger yet')).toBeVisible();
  await expectNoAxeViolations(page, '/workflows/<id>/draft, empty');

  // The trigger: Enter opens the item's menu, the dialog's radios move with the arrows.
  await pickFromMenu(page, 'Trigger: No trigger yet', 'Set the trigger…');
  const trigger = page.getByRole('dialog', { name: 'Set the trigger' });
  await expect(trigger.getByRole('radio', { name: 'An event' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(trigger.getByRole('radio', { name: 'The API' })).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(trigger.getByRole('button', { name: 'Set trigger' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(outlineItem(page, 'Trigger: The API')).toBeFocused();
  await expect(editorStatus(page)).toHaveText('Set the trigger to The API.');

  // A conditional after the trigger, a second route, and a wait on the first route.
  await pickFromMenu(page, 'Trigger: The API', 'Add a step after…');
  await addFromPalette(page, 'Conditional', 'Conditional');
  await expect(outlineItem(page, 'Conditional: Conditional')).toBeFocused();
  await pickFromMenu(page, 'Conditional: Conditional', 'Add a branch');
  await expect(outlineItem(page, 'Route 2')).toBeFocused();
  await pickFromMenu(page, 'Route 1', 'Add a step here…');
  await addFromPalette(page, 'Wait for a time', 'Wait for a time');
  await expect(outlineItem(page, 'Wait: Wait for a time')).toBeFocused();

  // The canvas draws the same document, and a node chosen there is the outline's selection.
  const canvas = page.getByRole('region', { name: 'Canvas' });
  await expect(canvas.getByText('2 steps, 3 branches, 0 errors.', { exact: false })).toBeVisible();
  await expect(canvasNode(page, 'wait')).toHaveAttribute('aria-label', 'Wait: Wait for a time');
  await expect(canvasNode(page, 'conditional')).toHaveAttribute(
    'aria-label',
    'Conditional: Conditional',
  );
  await canvasNode(page, 'conditional').click();
  await expect(
    page.getByRole('region', { name: 'Step settings' }).getByRole('textbox', { name: 'Name' }),
  ).toHaveValue('Conditional');
  await expect(outlineItem(page, 'Conditional: Conditional')).toHaveAttribute('tabindex', '0');

  // Undo and redo with the keys, inside the editor.
  await outlineItem(page, 'Wait: Wait for a time').focus();
  await page.keyboard.press('Control+z');
  await expect(outlineItem(page, 'Wait: Wait for a time')).toHaveCount(0);
  await expect(canvasNode(page, 'wait')).toHaveCount(0);
  await expect(editorStatus(page)).toHaveText('Undid the last change.');
  await outlineItem(page, 'Conditional: Conditional').focus();
  await page.keyboard.press('Control+Shift+z');
  await expect(outlineItem(page, 'Wait: Wait for a time')).toBeVisible();
  await expect(canvasNode(page, 'wait')).toBeVisible();

  // Tidy up writes positions only in the layout member, as one undoable command.
  await page.getByRole('button', { name: 'Tidy up' }).click();
  expect(Object.keys((await definitionOf(page)).layout).sort()).toEqual([
    'conditional',
    'output',
    'trigger',
    'wait',
  ]);

  await expect(page.getByText(/^Unsaved changes/)).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/^The draft was saved\./)).toBeVisible();
  await expect(page.getByText(/^Unsaved changes/)).toHaveCount(0);
  await expectNoAxeViolations(page, '/workflows/<id>/draft, authored');

  // Published through the workflow page's own dialog.
  await page.goto(`${stack.dashboardUrl}/workflows/${workflowId ?? ''}`);
  await page.getByRole('button', { name: 'Publish the draft' }).click();
  const publish = page.getByRole('dialog', { name: 'Publish the draft' });
  await publish
    .getByRole('textbox', { name: 'Change note' })
    .fill('Synthetic version from the outline');
  await publish.getByRole('button', { name: 'Publish' }).click();
  await expect(publish).toBeHidden();
  await expect(page.getByText('The draft was published.')).toBeVisible();
  await expectNoAxeViolations(page, '/workflows/<id>');
});

test('a second draft shows its change as a list and a canvas badge, and a refused value as an error badge (C141.4, C141.5)', async ({
  page,
}) => {
  test.setTimeout(25_000);
  const stack = readStackInfo();
  await signInAs(page, stack, 'developer');
  await page.goto(draftUrl(stack.dashboardUrl));
  await expect(page.getByText(/No draft yet: this starts from the live version/)).toBeVisible();

  await pickFromMenu(page, 'Trigger: The API', 'Add a step after…');
  await addFromPalette(page, 'Wait for a time', 'Wait for a time');
  await expect(outlineItem(page, 'Wait: Wait for a time 2')).toBeFocused();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/^The draft was saved\./)).toBeVisible();

  await page.reload();
  const changes = page.getByRole('region', { name: 'Changes against the live version' });
  await expect(changes.getByText('Added step wait_2')).toBeVisible();
  await expect(canvasNode(page, 'wait_2')).toContainText('Added');
  await expectNoAxeViolations(page, '/workflows/<id>/draft, with changes');

  // A value the check refuses: its step carries the error in the outline and on the canvas.
  const definition = await definitionOf(page);
  const refused = {
    ...definition,
    steps: definition.steps.map((step) => (step.id === 'wait_2' ? { ...step, seconds: 0 } : step)),
  };
  await page.getByRole('textbox', { name: /Definition/ }).fill(JSON.stringify(refused, null, 2));
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByRole('region', { name: 'Errors' })).toBeVisible();
  const counted = /^Wait: Wait for a time 2, \d+ errors?$/;
  await expect(page.getByRole('treeitem', { name: counted })).toBeVisible();
  await expect(canvasNode(page, 'wait_2')).toHaveAttribute('aria-label', counted);
  await expect(canvasNode(page, 'wait_2')).toContainText(/\d+ errors?/);
});

test('the editor and its canvas load under the console’s real nonce CSP header with no violation (C141.1, C141.8, C170.3)', async ({
  page,
}) => {
  test.setTimeout(20_000);
  const stack = readStackInfo();
  await signInAs(page, stack, 'developer');
  const violations = await recordCspViolations(page);
  const url = draftUrl(stack.dashboardUrl);
  // C170.3 (Workflow 9C): the console sends its own nonce policy since [9c-checkpoint:csp], so the
  // Phase 8 injected policy gives way to the real header.
  const document = page.waitForResponse(url);
  await page.goto(url);
  const policy = (await document).headers()['content-security-policy'] ?? '';
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toMatch(/style-src 'self' 'nonce-/);
  await expect(canvasNode(page, 'conditional')).toBeVisible();
  await expect(page.locator('a[href^="https://reactflow.dev"]')).toHaveText('React Flow');
  await page.getByRole('button', { name: 'Tidy up' }).click();
  await pickFromMenu(page, 'Conditional: Conditional', 'Add a branch');
  await expect(outlineItem(page, 'Route 3')).toBeFocused();
  expect(await violations()).toEqual([]);
});

test('a step form, a route condition with its on-null, and the run’s path over the read-only canvas (C114.6, C141.4, C141.6)', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  await signInAs(page, stack, 'developer');
  await page.goto(`${stack.dashboardUrl}/workflows`);
  const create = page.getByRole('form', { name: 'Create a workflow' });
  await create.getByRole('textbox', { name: 'Name' }).fill(editorWorkflowName());
  await create.getByRole('button', { name: 'Create workflow' }).click();
  await page.waitForURL(/\/workflows\/wfl_[0-9A-Z]{26}\/draft$/);
  const id = /\/workflows\/(wfl_[0-9A-Z]{26})\/draft$/.exec(page.url())?.[1] ?? '';

  await pickFromMenu(page, 'Trigger: No trigger yet', 'Set the trigger…');
  const trigger = page.getByRole('dialog', { name: 'Set the trigger' });
  await trigger.getByRole('radio', { name: 'The API' }).check();
  await trigger.getByRole('button', { name: 'Set trigger' }).click();

  // The step form: each config member typed by the catalogue's schema.
  await pickFromMenu(page, 'Trigger: The API', 'Add a step after…');
  await addFromPalette(page, 'Calculate', 'Calculate');
  const settings = page.getByRole('region', { name: 'Step settings' });
  await settings.getByRole('combobox', { name: 'operator (required)' }).selectOption('add');
  await settings.getByRole('textbox', { name: 'operands (required)' }).fill('[1, 2]');
  await expect(editorStatus(page)).toHaveText('Changed operands of Calculate.');

  // A route that reads a value that can be unknown says what then, with no default (C114.6).
  await pickFromMenu(page, 'Action calculate: Calculate', 'Add a step after…');
  await addFromPalette(page, 'Conditional', 'Conditional');
  const route = page.getByRole('region', { name: 'Condition of the route Route 1' });
  await route.getByRole('button', { name: 'Add a comparison' }).click();
  await route
    .getByRole('combobox', { name: 'Path of comparison 1 of group 1' })
    .selectOption('steps.calculate.output.value');
  await route
    .getByRole('combobox', { name: 'Comparison of comparison 1 of group 1' })
    .selectOption('more');
  const onNull = route.getByRole('combobox', { name: 'When a value it reads is unknown (null)' });
  await expect(onNull).toHaveValue('');
  await onNull.selectOption('skip-route');
  const conditional = (await definitionOf(page)).steps.find((step) => step.type === 'conditional');
  expect(conditional?.routes).toEqual([
    {
      key: 'route-1',
      label: 'Route 1',
      condition: { '>': [{ var: 'steps.calculate.output.value' }, 0] },
      'on-null': 'skip-route',
    },
  ]);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/^The draft was saved\./)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Errors' })).toHaveCount(0);
  await expectNoAxeViolations(page, '/workflows/<id>/draft, step form and condition');

  // Published and run, its run page draws the path taken.
  const admin = await adminClient(stack);
  await admin.workflows.publish(id, { description: 'Synthetic editor version.' });
  await admin.workflows.activate(id);
  const { data: started } = await admin.workflows.trigger(id, {});
  await waitForRunEnd(admin, started.id);
  await page.goto(`${stack.dashboardUrl}/workflows/runs/${started.id}`);
  const path = page.getByRole('region', { name: 'Path taken' });
  await expect(
    path.getByRole('list', { name: 'Path taken as a list' }).getByRole('listitem').nth(1),
  ).toHaveText('Action calculate: Calculate: ✓ Succeeded');
  await expect(canvasNode(page, 'calculate')).toContainText('Succeeded');
  await expect(canvasNode(page, 'calculate')).toHaveAttribute(
    'aria-label',
    'Action calculate: Calculate, Succeeded',
  );
  await expectNoAxeViolations(page, '/workflows/runs/<id>, path taken');
});
