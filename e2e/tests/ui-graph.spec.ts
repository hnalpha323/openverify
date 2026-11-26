/**
 * C108's graph explorer in the console, full stack (Workflow 7C, `dashboard-graph`). Budget: 90 s
 * for each test.
 * - A reviewer (graph:read and graph:write, accounts:write, lists:write, pii:view) works by
 *   keyboard alone (WCAG 2.1.1): runs a published template from its page, reads the result on the
 *   table view (the default), sees focus on every control it reaches (2.4.7), unmasks a value with
 *   Enter (the audited C102.6 route), selects every account, previews and applies add-tag after a
 *   confirmation (C103), opens the canvas with its text alternative and shape legend (1.1.1,
 *   1.4.1) and zooms by button (2.5.7), and downloads the CSV export as the API wrote it.
 *   Cytoscape.js and fCoSE reach the browser only on that key press.
 * - A developer opens a 2,000-node result (the node limit) under the console's real nonce CSP
 *   (C170.3, Workflow 9C: `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src` with the
 *   nonce, `worker-src 'none'`, `object-src 'none'`), switches to the canvas, and no
 *   violation is reported. The 2,000 nodes come from the stack's API: about 720 accounts made in
 *   the test with shared account fields, indexed in the same transaction as `POST /accounts`.
 * Every value is synthetic and carries the run's id, so the specs sharing the stack never meet;
 * each template the spec publishes is archived in `finally`, and no setting is changed.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import {
  accountFieldTemplate,
  completedQuery,
  createAccounts,
  fieldsOf,
  graphClient,
  holdsGraphLibrary,
  largeGraphPlan,
  publishedTemplate,
  recordCspViolations,
  recordScripts,
  signedInGraphStates,
  withConsolePage,
  type GraphRole,
} from './support/ui-graph.js';

let states: Awaited<ReturnType<typeof signedInGraphStates>>;
const ROLES: readonly GraphRole[] = ['reviewer', 'developer'];

test.beforeAll(async ({ browser }) => {
  states = await signedInGraphStates(browser, readStackInfo(), ROLES);
});

/** Moves focus to `control` and presses `key`, as a keyboard user does: no pointer at all. */
async function press(control: Locator, key = 'Enter') {
  await control.focus();
  await control.press(key);
}

/** Whether the focused element shows a visible focus indicator (WCAG 2.4.7). */
async function focusIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) {
      return false;
    }
    const style = getComputedStyle(active);
    return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
  });
}

test('a reviewer runs a template, reads, unmasks, tags and exports a result by keyboard alone, with the canvas a key press away (C102-C103, C108)', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const client = graphClient(stack);
  const run = randomUUID().slice(0, 8);
  const phoneBase = randomInt(1000);
  const [first = '', second = '', third = ''] = await createAccounts(client, run, [
    fieldsOf(run, { email: 1, name: 1 }, phoneBase),
    fieldsOf(run, { email: 1, address: 1 }, phoneBase),
    fieldsOf(run, { address: 1 }, phoneBase),
  ]);
  const templateId = await publishedTemplate(
    client,
    `e2e ui graph ${run}`,
    accountFieldTemplate(4, 100),
  );
  try {
    await withConsolePage(browser, states.reviewer, async (page) => {
      const scripts = recordScripts(page);

      // Run the template from its page.
      await page.goto(`${stack.dashboardUrl}/graph/templates/${templateId}`);
      const runForm = page.getByRole('form', { name: 'Run a query' });
      await runForm.getByRole('textbox', { name: 'account_id' }).focus();
      await page.keyboard.type(first);
      await press(runForm.getByRole('checkbox', { name: /Wait for the result/ }), 'Space');
      await press(runForm.getByRole('button', { name: 'Run query' }));
      await expect(page).toHaveURL(/\/graph\/grphq_[0-9A-HJKMNP-TV-Z]{26}$/u);

      // The table view is the default, and lists the result.
      await expect(page.getByRole('button', { name: 'Table view' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const accounts = page.getByRole('table', { name: 'Accounts in this result' });
      for (const id of [first, second, third]) {
        await expect(accounts.getByRole('rowheader', { name: id })).toBeVisible();
      }
      const values = page.getByRole('table', { name: 'Shared values' });
      await expect(
        values.getByRole('rowheader', { name: 'Email address (unconfirmed)' }),
      ).toBeVisible();
      await expect(values.getByRole('rowheader', { name: 'Address', exact: true })).toBeVisible();
      expect(await page.content()).not.toContain(`g${run}-1@graph-ui.test`);

      // Focus is visible on the controls a keyboard reaches.
      const selectAll = page.getByRole('checkbox', { name: 'Select every account in this result' });
      await selectAll.focus();
      expect(await focusIsVisible(page)).toBe(true);
      await page.getByRole('button', { name: 'Canvas view' }).focus();
      expect(await focusIsVisible(page)).toBe(true);

      // The audited unmask, on Enter.
      await press(
        values.getByRole('button', { name: /^Show the value of Email address \(unconfirmed\)/ }),
      );
      await expect(values.getByText(`g${run}-1@graph-ui.test`)).toBeVisible();
      await expect(values.getByText('Shown and recorded in the audit log.')).toBeVisible();

      // Bulk add-tag: select every account, preview, confirm.
      const tag = `ui-graph-${run}`;
      await press(selectAll, 'Space');
      await page.getByRole('textbox', { name: 'Tag' }).focus();
      await page.keyboard.type(tag);
      await press(page.getByRole('button', { name: 'Preview' }));
      await expect(
        page.getByText(
          '3 of the 3 selected accounts are in the stored result and would be acted on.',
        ),
      ).toBeVisible();
      await press(page.getByRole('button', { name: 'Apply…' }));
      const dialog = page.getByRole('dialog', { name: 'Add a tag to 3 accounts?' });
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Apply' })).toBeFocused();
      await page.keyboard.press('Enter');
      const outcomes = page.getByRole('table', { name: 'Outcome of each account' });
      await expect(outcomes.getByText('Done')).toHaveCount(3);
      for (const id of [first, second, third]) {
        expect((await client.accounts.retrieve(id)).data.attributes.tags).toContain(tag);
      }

      // Cytoscape.js and fCoSE are fetched only once the canvas is asked for (C108).
      expect((await scripts()).filter(holdsGraphLibrary)).toEqual([]);

      // The canvas, a key press away, with its text alternative, its legend and button zoom.
      await press(page.getByRole('button', { name: 'Canvas view' }));
      await expect(
        page.getByRole('img', {
          name: 'Graph of 3 accounts and 2 shared values. The table view lists the same result.',
        }),
      ).toBeVisible();
      await expect(
        page
          .getByRole('img', { name: /^Graph of/ })
          .locator('canvas')
          .first(),
      ).toBeAttached();
      expect((await scripts()).filter(holdsGraphLibrary)).toHaveLength(2);
      await expect(page.getByRole('list', { name: 'Legend' }).getByRole('listitem')).toHaveText([
        'Account: circle',
        'Email address (unconfirmed): rounded diamond',
        'Address: pentagon',
      ]);
      await press(page.getByRole('button', { name: 'Zoom in' }));
      await press(page.getByRole('button', { name: 'Fit the graph' }));

      // The export: the selection is kept across views; preview, then download.
      const action = page.getByRole('combobox', { name: 'Action' });
      // Create case (C140.6) follows the export for a reviewer who may open cases.
      await press(action, 'End');
      await expect(action).toHaveValue('create-case');
      await press(action, 'ArrowUp');
      await expect(action).toHaveValue('export');
      await press(page.getByRole('button', { name: 'Preview' }));
      await press(page.getByRole('button', { name: 'Download…' }));
      const exportDialog = page.getByRole('dialog', { name: 'Export 3 accounts as CSV?' });
      await expect(exportDialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await page.keyboard.press('Tab');
      const download = page.waitForEvent('download');
      await page.keyboard.press('Enter');
      const csv = await readFile(await (await download).path(), 'utf8');
      // The API's writer quotes every cell (C100.6), and the console passes its bytes on.
      expect(csv.split(/\r?\n/u)[0]).toBe(
        '"account-id","reference-id","status","tags","hop-distance","linking-kinds"',
      );
      for (const id of [first, second, third]) {
        expect(csv).toContain(id);
      }
    });
  } finally {
    await client.graphQueryTemplates.archive(templateId);
  }
});

test('a 2,000-node result opens on the canvas under the console real nonce CSP with no violation (C108, F33, C170.3)', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const client = graphClient(stack);
  const run = randomUUID().slice(0, 8);
  const phoneBase = randomInt(1000);
  const plan = largeGraphPlan(525);
  const ids = await createAccounts(
    client,
    run,
    plan.map((each) => fieldsOf(run, each, phoneBase)),
    16,
  );
  const templateId = await publishedTemplate(
    client,
    `e2e ui graph csp ${run}`,
    accountFieldTemplate(6, 2000),
  );
  try {
    const query = await completedQuery(client, templateId, ids[0] ?? '', 40_000);
    expect(query.attributes.nodes).toHaveLength(2000);
    expect(query.attributes['node-limit-reached']).toBe(true);

    await withConsolePage(browser, states.developer, async (page) => {
      const violations = await recordCspViolations(page);
      const url = `${stack.dashboardUrl}/graph/${query.id}`;
      const document = page.waitForResponse(url);
      await page.goto(url);
      expect((await document).headers()['content-security-policy']).toContain("'strict-dynamic'");
      await expect(page.getByRole('table', { name: 'Accounts in this result' })).toBeVisible();
      await press(page.getByRole('button', { name: 'Canvas view' }));
      const canvas = page.getByRole('img', {
        name: /^Graph of \d+ accounts and \d+ shared values/u,
      });
      await expect(canvas).toBeVisible();
      await expect(canvas.locator('canvas').first()).toBeAttached({ timeout: 30_000 });
      await expect(page.getByText('Loading the canvas…')).toHaveCount(0, { timeout: 30_000 });
      const [, accounts, values] =
        /^Graph of (\d+) accounts and (\d+) shared values/u.exec(
          (await canvas.getAttribute('aria-label')) ?? '',
        ) ?? [];
      expect(Number(accounts) + Number(values)).toBe(2000);
      await press(page.getByRole('button', { name: 'Fit the graph' }));
      expect(await violations()).toEqual([]);
    });
  } finally {
    await client.graphQueryTemplates.archive(templateId);
  }
});
