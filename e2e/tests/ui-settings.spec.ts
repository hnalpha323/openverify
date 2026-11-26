/**
 * Workflow 9C, `dashboard-settings` (C167 to C169, C174.6), full stack. Budget: 90 s.
 *
 * - A role granted only in the sandbox reaches the sandbox and not production; the role editor of an
 *   operator without `pii:view` offers it disabled, with the reason.
 * - An admin rotates a key in one dialog and is shown when the old token stops; configures a
 *   webhook's failure alert; opens "my sessions"; is refused an embed origin on a shared-hosting
 *   suffix, in words, at the field.
 * - The audit explorer's address search is offered only with `pii:view`; the users list and the
 *   audit explorer send an auditor without `pii:view` no address and no factor details.
 *
 * Every page opened is checked with axe and meets no CSP violation. Data is made inside the spec
 * through the API; nothing is read from a list's first page; what is changed is put back.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { expectAccessible } from './support/accessible.js';
import { dashboardRequest } from './support/platform.js';
import { expectStatus, operatorWithRole, serverRequest } from './support/platform-9b.js';
import { signInAs } from './support/ui.js';
import { recordPolicyViolations, serverHtml, useSessionToken } from './support/ui-settings.js';

async function open(page: Page, url: string, where: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectAccessible(page, { where });
}

test('a role granted only in the sandbox cannot act in production, and the role editor offers only what may be granted (C167.2, C167.4)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const stack = readStackInfo();
  const sandboxOnly = await operatorWithRole(
    stack,
    ['inquiries:read'],
    [stack.environments.sandbox],
  );
  const token = await sandboxOnly.signIn();
  const toProduction = await dashboardRequest(stack, 'PUT', '/sessions/current/environment', {
    token,
    body: { 'environment-id': stack.environments.production },
  });
  expect(toProduction.status).toBe(403);
  expect(JSON.stringify(toProduction.body)).toContain('no_environment_role');

  const editor = await operatorWithRole(
    stack,
    ['roles:read', 'roles:write', 'inquiries:read'],
    null,
  );
  const violations = await recordPolicyViolations(page);
  await useSessionToken(page, stack.dashboardUrl, await editor.signIn());
  await open(page, `${stack.dashboardUrl}/roles/new`, '/roles/new');
  const pii = page.getByRole('checkbox', { name: /^View personal data/u });
  await expect(pii).toBeDisabled();
  await expect(pii).toHaveAccessibleDescription(/You do not hold it in Sandbox or Production/u);
  await expect(page.getByRole('checkbox', { name: 'View inquiries' })).toBeEnabled();
  expect(await violations()).toEqual([]);
});

test('an admin rotates a key in one dialog, configures a failure alert, sees their sessions and is refused a shared-hosting origin (C169, C168.4, C158.1)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const violations = await recordPolicyViolations(page);
  const key = expectStatus(
    await serverRequest(stack, stack.apiKey, 'POST', '/api-keys', {
      data: {
        type: 'api-key',
        attributes: {
          name: `e2e ui rotation ${randomUUID().slice(0, 8)}`,
          scopes: ['inquiries:read'],
        },
      },
    }),
    201,
    'the key',
  ).body as { data: { id: string } };
  const receiver = await startWebhookReceiver();
  const webhook = expectStatus(
    await serverRequest(stack, stack.apiKey, 'POST', '/webhooks', {
      data: {
        type: 'webhook',
        attributes: {
          url: receiver.url,
          'enabled-events': ['inquiry.created'],
          name: `e2e ui alert ${randomUUID().slice(0, 8)}`,
        },
      },
    }),
    201,
    'the webhook',
  ).body as { data: { id: string } };
  // Disabled at once: this spec configures it and never receives events.
  expectStatus(
    await serverRequest(stack, stack.apiKey, 'POST', `/webhooks/${webhook.data.id}/disable`, {}),
    200,
    'disabling the webhook',
  );
  let rotatedId: string | null = null;
  try {
    await signInAs(page, stack, 'admin');

    await open(page, `${stack.dashboardUrl}/api-keys/${key.data.id}`, '/api-keys/[id]');
    await page.getByRole('button', { name: 'Rotate' }).click();
    const question = page.getByRole('dialog', { name: 'Rotate this API key?' });
    await question
      .getByRole('combobox', { name: 'The old token keeps working' })
      .selectOption({ label: 'For 1 hour' });
    await question.getByRole('button', { name: 'Rotate key' }).click();
    const reveal = page.getByRole('dialog', { name: 'API key rotated' });
    await expect(reveal).toContainText('The old token keeps working until');
    await expectAccessible(page, { where: '/api-keys/[id] rotated' });
    await reveal.getByRole('button', { name: 'Done' }).click();
    await expect(page).not.toHaveURL(new RegExp(key.data.id, 'u'));
    rotatedId = new URL(page.url()).pathname.split('/').at(-1) ?? null;

    await open(
      page,
      `${stack.dashboardUrl}/webhooks/${webhook.data.id}/edit`,
      '/webhooks/[id]/edit',
    );
    const alert = page.getByRole('group', { name: 'Failure alert' });
    await alert.getByRole('checkbox', { name: 'Alert when first attempts fail' }).check();
    await alert.getByRole('spinbutton', { name: 'Failed first attempts' }).fill('3');
    await alert.getByRole('spinbutton', { name: 'Within (minutes)' }).fill('15');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('region', { name: 'Configuration' })).toContainText(
      'On: after 3 failed first attempts within 15 minutes',
    );
    await expectAccessible(page, { where: '/webhooks/[id]' });

    await open(page, `${stack.dashboardUrl}/account/sessions`, '/account/sessions');
    await expect(page.getByRole('table', { name: 'Your sessions' })).toContainText('This session');

    await open(page, `${stack.dashboardUrl}/settings`, '/settings');
    await page.getByRole('textbox', { name: 'Allowed embed origins' }).fill('https://*.vercel.app');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('A wildcard may not cover a shared-hosting suffix.')).toBeVisible();
    await expectAccessible(page, { where: '/settings refused origin' });

    await open(page, `${stack.dashboardUrl}/notifications`, '/notifications');
    await open(page, `${stack.dashboardUrl}/webhooks/deliveries`, '/webhooks/deliveries');
    expect(await violations()).toEqual([]);
  } finally {
    await serverRequest(stack, stack.apiKey, 'POST', `/api-keys/${key.data.id}/expire`, {
      meta: { 'expires-in-seconds': 0 },
    });
    if (rotatedId?.startsWith('key_') === true) {
      await serverRequest(stack, stack.apiKey, 'POST', `/api-keys/${rotatedId}/expire`, {
        meta: { 'expires-in-seconds': 0 },
      });
    }
    await serverRequest(stack, stack.apiKey, 'POST', `/webhooks/${webhook.data.id}/archive`, {});
    await receiver.close();
  }
});

test('the audit explorer searches by address only with pii:view, and pages send no address or factor without it (C168.5, C168.6)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const stack = readStackInfo();
  const violations = await recordPolicyViolations(page);

  await signInAs(page, stack, 'admin');
  await open(page, `${stack.dashboardUrl}/audit-logs`, '/audit-logs');
  await expect(
    page.getByRole('search', { name: 'Find entries from one IP address' }),
  ).toBeVisible();
  await open(page, `${stack.dashboardUrl}/users`, '/users');

  // An auditor without pii:view (the seeded viewer reads no audit log).
  const auditor = await operatorWithRole(stack, ['audit-logs:read', 'users:read'], null);
  await page.context().clearCookies();
  await useSessionToken(page, stack.dashboardUrl, await auditor.signIn());
  await open(page, `${stack.dashboardUrl}/audit-logs?ip=127.0.0.1`, '/audit-logs without pii:view');
  await expect(page.getByRole('search', { name: 'Find entries from one IP address' })).toHaveCount(
    0,
  );
  await expect(
    page.getByText(
      'Finding entries by IP address needs pii:view, because an address can identify a person.',
    ),
  ).toBeVisible();
  const audit = await serverHtml(page, `${stack.dashboardUrl}/audit-logs`);
  expect(audit).not.toMatch(/ip-address\\?":\\?"\d/u);
  expect(audit).not.toContain('127.0.0.1');
  const users = await serverHtml(page, `${stack.dashboardUrl}/users`);
  expect(users).not.toContain('mfa-factors');
  expect(users).not.toContain('last-sign-in-at');
  expect(await violations()).toEqual([]);
});
