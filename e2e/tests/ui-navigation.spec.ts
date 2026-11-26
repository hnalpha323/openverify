/**
 * Every C23 page is reachable from the console navigation (Workflow 2C integration), full stack:
 * - an admin follows each navigation link and lands on a rendered page, never the error
 *   boundary, a not-found page or the forbidden panel; where the list has a row, its first row
 *   opens the detail page, which renders too; the header's Security link opens
 *   `/account/security`;
 * - a viewer's navigation leaves out the pages its role cannot read (API logs and audit logs,
 *   C15), and opening one directly shows the inline "You do not have access" panel (C21).
 *
 * An inquiry, a webhook and an API key are created first through the server API, so every list
 * with a detail page has a row even when this spec runs alone. The inquiry gets a verification
 * through the flow API, so its page links the verification page (C26, Workflow 2E); account types
 * link theirs too.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { flowApi, recordingClient } from './support/platform.js';
import { environmentBanner, signInAs } from './support/ui.js';

/** The C23 console pages, as the navigation names them, and whether they have detail pages. */
const PAGES = [
  { label: 'Inquiries', path: '/inquiries', detail: true },
  { label: 'Accounts', path: '/accounts', detail: true },
  { label: 'Account types', path: '/account-types', detail: true },
  { label: 'Templates', path: '/templates', detail: true },
  { label: 'Webhooks', path: '/webhooks', detail: true },
  { label: 'API keys', path: '/api-keys', detail: true },
  { label: 'API logs', path: '/api-logs', detail: true },
  { label: 'Events', path: '/events', detail: true },
  { label: 'Users', path: '/users', detail: false },
  { label: 'Roles', path: '/roles', detail: true },
  { label: 'Audit logs', path: '/audit-logs', detail: true },
  { label: 'Settings', path: '/settings', detail: false },
] as const;

const consoleNav = (page: Page) => page.getByRole('navigation', { name: 'Console' });

/** A console page that rendered: its heading and the banner, no error, no 404, no 403 panel. */
async function expectRenderedPage(page: Page, where: string) {
  await expect(page.getByRole('heading', { level: 1 }).first(), where).toBeVisible();
  await expect(environmentBanner(page), where).toBeVisible();
  await expect(page.getByText(/could not be (loaded|found)/i), where).toHaveCount(0);
  await expect(page.getByTestId('forbidden-panel'), where).toHaveCount(0);
}

test('an admin reaches every C23 page and its detail page from the console navigation', async ({
  page,
}) => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `ui-navigation-${randomUUID()}`,
  });
  // The end user consents and starts the government ID: the inquiry now has a verification.
  const flow = flowApi(
    stack.apiUrl,
    (await client.inquiries.resume(inquiry.id)).meta['session-token'],
  );
  const consent = (await flow.session()).flow.steps.find((step) => step.type === 'consent');
  await flow.consent(consent?.type === 'consent' ? consent.textKeys : []);
  const verificationId = await flow.createVerification('government-id');
  const receiver = await startWebhookReceiver();
  const { data: webhook } = await client.webhooks.create({
    url: receiver.url,
    'enabled-events': ['inquiry.approved'],
  });
  await client.webhooks.disable(webhook.id);
  await receiver.close();
  const { data: apiKey } = await client.apiKeys.create({
    name: `ui-navigation-${randomUUID()}`,
    scopes: ['inquiries:read'],
  });

  try {
    await signInAs(page, stack, 'admin');
    for (const { label, path, detail } of PAGES) {
      await consoleNav(page).getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}(\\?.*)?$`));
      await expectRenderedPage(page, label);
      if (!detail) {
        continue;
      }
      const first = page.locator(`main table a[href^="${path}/"]`).first();
      await expect(first, `${label}: a row links its detail page`).toBeVisible();
      await first.click();
      await expect(page).toHaveURL(new RegExp(`${path}/[^/?]+`));
      await expectRenderedPage(page, `${label} detail`);
    }

    // The verification page, from its inquiry's page (C26).
    await page.goto(`${stack.dashboardUrl}/inquiries/${inquiry.id}`);
    await expectRenderedPage(page, 'Inquiry with a verification');
    await page
      .getByRole('region', { name: 'Verifications' })
      .getByRole('link', { name: verificationId })
      .click();
    await expect(page).toHaveURL(new RegExp(`/verifications/${verificationId}$`));
    await expectRenderedPage(page, 'Verification');

    await page.getByRole('banner').getByRole('link', { name: 'Security' }).click();
    await expect(page).toHaveURL(/\/account\/security$/);
    await expectRenderedPage(page, 'Security');
  } finally {
    await client.apiKeys.expire(apiKey.id, { 'expires-in-seconds': 0 });
  }
});

test('a viewer is not offered the pages its role cannot read, and opening one says so', async ({
  page,
}) => {
  const stack = readStackInfo();

  await signInAs(page, stack, 'viewer');
  const nav = consoleNav(page);
  for (const { label } of PAGES) {
    const link = nav.getByRole('link', { name: label, exact: true });
    if (label === 'API logs' || label === 'Audit logs') {
      await expect(link, label).toHaveCount(0);
    } else {
      await expect(link, label).toBeVisible();
    }
  }

  for (const path of ['/api-logs', '/audit-logs']) {
    await page.goto(`${stack.dashboardUrl}${path}`);
    await expect(page.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    await expect(environmentBanner(page)).toBeVisible();
  }
});
