/**
 * C86 in the console, full stack (Workflow 6B, `dashboard-report-config`): report templates and
 * the watchlist sources page. Budget: 90 s.
 * - A developer (`report-templates:write` and `:publish`) drafts a new version of a watchlist
 *   template the spec creates through the API. The API's 422 pointer shows at its place in the
 *   editor, in words; an empty source list saves but its publish is refused in words; leaving the
 *   list out pins every enabled source when the draft is saved, beside the resolved
 *   configuration, and the draft then publishes. What the console shows agrees with the API.
 * - A viewer reads the sources page as the API reports it: every source, the sandbox list
 *   labelled and never stale, the disabled UN list, the environment's own media runs against the
 *   GDELT budget with the API's citation, the API's matcher data, and the templates whose pinned
 *   lists differ, by name; the viewer sees the seeded template and its version read-only.
 * Each test makes its own data or reads what seed:dev made, and depends on no other spec. The
 * template the spec creates is archived in `finally`; nothing else is changed.
 */
import { randomUUID } from 'node:crypto';
import {
  dashboardWatchlistSourcesSchema,
  reportTemplateResourceSchema,
} from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { dashboardRequest } from './support/platform.js';
import {
  configEditor,
  configOf,
  expectSaved,
  operatorClient,
  resolvedValue,
  rowOf,
  saveDraftConfig,
  sessionTokenOf,
  signedInConfigStates,
  withConsolePage,
  type ConfigRole,
} from './support/ui-report-config.js';

/** Each role signs in once for the whole file (the suite shares the API's login limits). */
let states: Awaited<ReturnType<typeof signedInConfigStates>>;
const ROLES: readonly ConfigRole[] = ['developer', 'viewer'];

test.beforeAll(async ({ browser }) => {
  states = await signedInConfigStates(browser, readStackInfo(), ROLES);
});

test('a developer edits a draft as JSON beside its resolved configuration, meets the 422 pointer and an empty list refused in words, then publishes (C71, C72.4, C86)', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const stack = readStackInfo();
  const client = operatorClient(stack, states.developer);
  const name = `e2e ui report config ${randomUUID()}`;
  const { data: created } = await client.reportTemplates.create({
    name,
    'report-type': 'watchlist',
    config: { 'recurrence-interval-days': 30 },
  });
  try {
    await withConsolePage(browser, states.developer, async (page) => {
      await page.goto(`${stack.dashboardUrl}/report-templates?type=watchlist`);
      await expect(page.getByRole('heading', { level: 1, name: 'Report templates' })).toBeVisible();
      await page
        .getByRole('table', { name: 'Report templates' })
        .getByRole('link', { name })
        .click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      const type = page.getByRole('region', { name: 'Report type' });
      await expect(type).toContainText('Watchlist');
      await expect(type).toContainText('Beta');
      await expect(
        resolvedValue(
          page.getByRole('table', { name: 'Configuration of version 1' }),
          'Recurrence',
        ),
      ).toContainText('Every 30 days');

      // A new draft starts from what version 1 sets: its recurrence and its pinned lists.
      await page
        .getByRole('group', { name: 'Template actions' })
        .getByRole('button', { name: 'New draft' })
        .click();
      await expect(page.getByRole('heading', { level: 1, name: 'Version 2' })).toBeVisible();
      const drafted = JSON.parse(await configEditor(page).inputValue()) as Record<string, unknown>;
      expect(drafted['recurrence-interval-days']).toBe(30);
      expect(drafted['search-lists']).toEqual(
        configOf(created.attributes['current-version'].config)['search-lists'],
      );

      // The API's 422 pointer, shown at its place and named in words (C71.2).
      await saveDraftConfig(page, '{ "max-list-age-hours": 0 }');
      const problems = page.getByRole('list', { name: 'Problems in Configuration' });
      await expect(problems).toContainText('Maximum list age');
      await expect(problems).toContainText('/max-list-age-hours');
      await expect(configEditor(page)).toHaveAttribute('aria-invalid', 'true');

      // An empty list saves, and its publish is refused in words (V01).
      await saveDraftConfig(page, '{ "search-lists": [] }');
      await expectSaved(page);
      const resolved = page.getByRole('table', { name: 'Resolved configuration (saved)' });
      await expect(resolvedValue(resolved, 'Lists searched')).toContainText('None');
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Publish version 2?' });
      await dialog.getByRole('button', { name: 'Publish version' }).click();
      const refusal = dialog.getByRole('alert');
      await expect(refusal).toContainText('The draft selects no list');
      await expect(refusal).toContainText('Lists searched: ');
      await dialog.getByRole('button', { name: 'Cancel' }).click();

      // Leaving the list out pins every enabled source when the draft is saved (C71.2).
      await saveDraftConfig(page, '{ "recurrence-interval-days": 30, "pause-on-match": true }');
      await expect(resolvedValue(resolved, 'Pause on match')).toContainText('Yes');
      await expect(resolvedValue(resolved, 'Lists searched')).toContainText('ofac-sdn');

      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Publish version 2?' })
        .getByRole('button', { name: 'Publish version' })
        .click();
      await expect(page.getByText('Version 2 was published.')).toBeVisible();
      await expect(page.getByText('Published', { exact: true })).toBeVisible();
      await expect(page.getByRole('form', { name: 'Edit the draft configuration' })).toHaveCount(0);
    });

    // The console agrees with the API: version 2 is current, with what the console showed.
    const { data: template } = await client.reportTemplates.retrieve(created.id);
    const current = reportTemplateResourceSchema.parse(template).attributes['current-version'];
    expect(current['version-number']).toBe(2);
    expect(configOf(current.config)).toMatchObject({ 'pause-on-match': true });
    expect(configOf(current.config)['search-lists']).toContain('ofac-sdn');
  } finally {
    await client.reportTemplates.update(created.id, { status: 'archived' });
  }
});

test('a viewer reads the watchlist sources as the API reports them, and the seeded template read-only (C72.3, C76, C81.2, C86)', async ({
  browser,
}) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  const answer = await dashboardRequest(stack, 'GET', '/watchlist-sources', {
    token: sessionTokenOf(states.viewer),
  });
  expect(answer.status).toBe(200);
  const sources = dashboardWatchlistSourcesSchema.parse(answer.body);
  const sandbox = sources.sources.find((source) => source.id === 'openverify-sandbox');
  const un = sources.sources.find((source) => source.id === 'un-sc');
  if (sandbox === undefined || un === undefined) {
    throw new Error('The manifest lists no sandbox or UN source');
  }

  await withConsolePage(browser, states.viewer, async (page) => {
    await page.goto(`${stack.dashboardUrl}/inquiries`);
    await page.getByRole('link', { name: 'Watchlist sources' }).click();
    await expect(page).toHaveURL(/\/watchlist-sources$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Watchlist sources' })).toBeVisible();

    const table = page.getByRole('table', { name: 'Watchlist sources' });
    await expect(table.getByRole('row')).toHaveCount(sources.sources.length + 1);
    const sandboxRow = rowOf(table, /openverify-sandbox(?!-pep)/);
    await expect(sandboxRow).toContainText('Sandbox list');
    await expect(sandboxRow).toContainText(
      sandbox['last-checked-at'] === null ? 'Never checked' : 'Sandbox list, never stale',
    );
    await expect(sandboxRow).not.toContainText('Stale');
    await expect(rowOf(table, /un-sc/)).toContainText(un.enabled ? 'Enabled' : 'Disabled');

    // Owner decision 18: this environment's own runs beside the install budget, and the
    // install's flag in words; owner decision 17: the citation the API serves.
    const media = page.getByRole('region', { name: 'Adverse media budget' });
    await expect(media).toContainText(
      `${new Intl.NumberFormat('en').format(sources.media['environment-scheduled-runs-per-day'])} scheduled adverse-media runs a day in this environment`,
    );
    await expect(media).toContainText(
      new Intl.NumberFormat('en').format(sources.media['install-budget-per-day']),
    );
    await expect(media.getByText('The install is above 80% of the budget')).toHaveCount(
      sources.media['install-above-warn-share'] ? 1 : 0,
    );
    await expect(media).toContainText(sources.media.attribution);

    // Owner decision 17: the API's own matcher data, never read as a re-key.
    const summary = page.getByRole('region', { name: 'Summary' });
    await expect(summary).toContainText(
      sources.matcher['keys-version'] ?? 'The API has no variant groups',
    );

    const templates = page.getByRole('region', { name: 'Templates to review' });
    if (sources['template-warnings'].length === 0) {
      await expect(templates).toContainText('Every template pins exactly the enabled sources');
    } else {
      const warnings = templates.getByRole('table', {
        name: 'Templates whose pinned lists differ from the enabled sources',
      });
      await expect(warnings.getByRole('link')).toHaveCount(sources['template-warnings'].length);
      // Owner decision 17: each warned template by its name, linked to its page.
      for (const warning of sources['template-warnings']) {
        await expect(
          warnings.getByRole('link', { name: warning.name, exact: true }).first(),
        ).toHaveAttribute('href', `/report-templates/${warning['report-template-id']}`);
      }
    }
    await expect(page.getByRole('region', { name: 'Attribution' })).toContainText(
      sandbox.attribution,
    );

    // The seeded template, read-only for a viewer.
    await page.goto(`${stack.dashboardUrl}/report-templates?type=watchlist&status=active`);
    await page
      .getByRole('table', { name: 'Report templates' })
      .getByRole('link', { name: 'Default watchlist' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Default watchlist' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Template actions' })).toHaveCount(0);
    await page.getByRole('region', { name: 'Current version' }).getByRole('link').click();
    await expect(page.getByRole('table', { name: 'Resolved configuration' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Edit the draft configuration' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
  });
});
