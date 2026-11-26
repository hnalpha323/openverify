/**
 * C108 signals in the console, full stack (Workflow 7C, `dashboard-signals`). Budget: 90 s.
 *
 * An inquiry on a database template whose version screens one IP address list of this run (named
 * in its `list-config`, `screen-at-completion: false`, so no other spec's inquiry meets it). Its
 * end user opens the flow from a sandbox address of `203.0.113.0/24` (a fictional city point,
 * C93.6) through the stack's trusted proxy, consents and enters a fictional person; the list holds
 * that address. Once the signals and the list screening ran:
 * - a developer (`inquiry-sessions:read`, `lists:write`, no `pii:view`) reads the inquiry: the
 *   session card with its address hidden, the collection tiers, the network facts with their
 *   tiers and the DB-IP line; the signals by layer; the screening and the match with its value
 *   hidden; then dismisses the match with a required reason. The account page shows its signals
 *   and the dismissed match;
 * - a viewer (`settings:read`, no `settings:privacy`) reads the collection tiers read-only on the
 *   settings page, and the network sources page with its sandbox source.
 * Nothing changes a setting; the list is archived in `finally`.
 *
 * A second test (K7A-8, budget 90 s): a desktop session issues a handoff, which no principal does,
 * and an admin reads its `handoff.issued` entry on the audit log: the system as its actor, no actor
 * id and no link to entries by that actor. It sets the environment's display name, as
 * `handoff.spec.ts` does, to the same value. Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { collectConsoleErrors, giveConsent } from './support/flow.js';
import { recordingClient } from './support/platform.js';
import { signInAs } from './support/ui.js';
import {
  databaseTemplate,
  enterDatabaseRecord,
  handoffTemplate,
  nameTheOrganization,
  pageFrom,
  sandboxCityAddress,
  waitForScreening,
} from './support/ui-signals.js';

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test('a developer reads an inquiry’s sessions, signals and list screening in words without personal data, dismisses its match, and a viewer reads the collection tiers and the network sources (C90-C99, C108)', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const run = randomUUID().slice(0, 8);
  const address = sandboxCityAddress();
  const { data: list } = await client.lists.create('ip-addresses', {
    name: `e2e-ui-signals-${run}`,
    'screen-at-completion': false,
  });
  try {
    await client.listItems.create('ip-addresses', { 'list-id': list.id, value: address });
    const templateId = await databaseTemplate(client, `e2e-ui-signals-${run}`, {
      screen: [list.id],
      'on-list-match': 'none',
    });
    const { data: inquiry } = await client.inquiries.create({
      'inquiry-template-id': templateId,
      'reference-id': `e2e-ui-signals-${run} sandbox-database-nickname`,
    });

    // The end user, from the sandbox address: consent, the database step, completion.
    const resumed = await client.inquiries.resume(inquiry.id);
    const flow = await pageFrom(browser, stack.apiUrl, address);
    const errors = collectConsoleErrors(flow);
    await flow.goto(resumed.meta['flow-url']);
    await giveConsent(flow);
    await enterDatabaseRecord(flow);
    await expect(
      flow.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible({ timeout: 45_000 });
    expect(errors).toEqual([]);
    await flow.context().close();

    expect(await waitForScreening(client, inquiry.id, 40_000)).toBe('completed');
    const { data: served } = await client.inquiries.retrieve(inquiry.id);
    const accountId = served.relationships.account?.data?.id ?? '';
    expect(accountId).toMatch(/^acc_/u);

    // A developer: no pii:view, so every personal value reads Hidden.
    const developer = await (await browser.newContext()).newPage();
    await signInAs(developer, stack, 'developer');
    await developer.goto(`${stack.dashboardUrl}/inquiries/${inquiry.id}`);

    const sessions = region(developer, 'Sessions');
    const card = sessions.getByRole('article').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Session integrity');
    const network = card.getByRole('group', { name: 'Network' });
    await expect(network).toContainText('(ZZ), approximate');
    await expect(network).toContainText('Tier R');
    await expect(sessions).not.toContainText(address);
    await expect(sessions.getByRole('link', { name: 'IP geolocation by DB-IP' })).toHaveAttribute(
      'href',
      'https://db-ip.com',
    );

    const signals = region(developer, 'Signals');
    await expect(signals.getByRole('table', { name: 'Network signals' })).toBeVisible();
    await expect(signals).not.toContainText('Not computed yet');
    await expect(signals).not.toContainText(/\b(human|safe)\b/iu);

    const matches = region(developer, 'List matches');
    await expect(matches).toContainText('Screened: 1 open match');
    const row = matches.getByRole('row').filter({ hasText: list.id });
    await expect(row).toContainText('Session IP address');
    await expect(row).toContainText('R (an exact comparison)');
    await expect(row).toContainText('Hidden');
    await expect(row).not.toContainText(address);

    // C99.3: a dismissal needs its reason; the refusal shows on the field.
    await row.getByRole('button', { name: /^Dismiss list match/u }).click();
    const dialog = developer.getByRole('dialog', { name: 'Dismiss this list match?' });
    const reason = dialog.getByRole('textbox', { name: /Reason/u });
    await expect(reason).toBeFocused();
    await dialog.getByRole('button', { name: 'Dismiss' }).click();
    await expect(reason).toHaveAttribute('aria-invalid', 'true');
    await reason.fill(`Synthetic review ${run}: a shared office network`);
    await dialog.getByRole('button', { name: 'Dismiss' }).click();
    await expect(
      developer.getByRole('status').filter({ hasText: 'The list match was dismissed.' }),
    ).toBeVisible();
    await expect(matches.getByRole('row').filter({ hasText: list.id })).toContainText('Dismissed');

    await developer.goto(`${stack.dashboardUrl}/accounts/${accountId}`);
    await expect(
      region(developer, 'Signals').getByRole('table', { name: 'Signals of the latest inquiries' }),
    ).toBeVisible();
    await expect(
      region(developer, 'List matches').getByRole('row').filter({ hasText: list.id }),
    ).toContainText('Dismissed');
    await developer.context().close();

    // A viewer: the settings read-only, the network sources page.
    const viewer = await (await browser.newContext()).newPage();
    await signInAs(viewer, stack, 'viewer');
    await viewer.goto(`${stack.dashboardUrl}/settings`);
    const settings = region(viewer, 'Signals in Sandbox');
    await expect(settings).toContainText('Session integrity');
    await expect(viewer.getByRole('combobox', { name: 'Session integrity' })).toHaveCount(0);
    await viewer.goto(`${stack.dashboardUrl}/network-sources`);
    const sources = viewer.getByRole('table', { name: 'Network sources' });
    const sandbox = sources.getByRole('row').filter({ hasText: 'openverify-sandbox-network' });
    await expect(sandbox).toContainText('Sandbox');
    await expect(sandbox).toContainText('Never stale (sandbox data)');
    await viewer.context().close();
  } finally {
    await client.lists.archive(list.id);
  }
});

test('the audit log shows the system’s handoff entry with no actor id and no link to entries by its actor (K7A-8, C15, C96)', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const run = randomUUID().slice(0, 8);
  await nameTheOrganization(stack);
  const templateId = await handoffTemplate(client, `e2e-ui-signals-handoff-${run}`);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': templateId,
    'reference-id': `e2e-ui-signals-handoff-${run}`,
  });
  const resumed = await client.inquiries.resume(inquiry.id);

  const flow = await (await browser.newContext()).newPage();
  await flow.goto(resumed.meta['flow-url']);
  await giveConsent(flow);
  await expect(
    flow.getByRole('heading', { level: 1, name: 'Continue on your phone' }),
  ).toBeVisible();
  await flow.context().close();

  const admin = await (await browser.newContext()).newPage();
  await signInAs(admin, stack, 'admin');
  await admin.goto(`${stack.dashboardUrl}/audit-logs?action=handoff.issued`);
  const row = admin
    .getByRole('table', { name: 'Audit log entries' })
    .getByRole('row')
    .filter({ hasText: 'handoff.issued' })
    .first();
  await expect(row).toContainText('System');
  await expect(row).not.toContainText(/\b(usr|key)_/u);

  await row.getByRole('link').first().click();
  await expect(admin.getByRole('heading', { level: 1, name: 'handoff.issued' })).toBeVisible();
  const details = region(admin, 'Details');
  await expect(details).toContainText('System');
  await expect(details).not.toContainText(/\b(usr|key)_/u);
  const related = admin.getByRole('navigation', { name: 'Related entries' });
  await expect(related.getByRole('link', { name: 'Entries about this resource' })).toBeVisible();
  await expect(related.getByRole('link', { name: 'Entries by this actor' })).toHaveCount(0);
  await admin.context().close();
});
