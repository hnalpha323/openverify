/**
 * C24 specs 4 and 5: integrations through the dashboard (C14, C12, C23).
 *
 * 4. A developer creates a webhook pointing at the e2e receiver, edits it, rotates its secret, and sends it
 *    a test event: the receiver gets it, signed with both secrets during the overlap, and the
 *    delivery shows in the webhook's deliveries list.
 * 5. A developer creates an API key: the token is shown once and works against the server API
 *    (`@openverify/node`) within its scopes; expired in the UI, the token is refused.
 *
 * C27 (Workflow 2E): a key created with an expiry at a date and time, in one call (C25.5), shows
 * that expiry and answers 401 once it passed; a key that sees personal data masked is labelled
 * (C25.6).
 */
import { randomUUID } from 'node:crypto';
import {
  OPENVERIFY_SIGNATURE_HEADER,
  OpenVerifyApiError,
  createClient,
  verifyWebhookSignature,
} from '@openverify/node';
import { expect, test, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { recordingClient } from './support/platform.js';
import { signInAs } from './support/ui.js';

/** The last segment of the page's path: the id of the resource it shows. */
function idInUrl(page: Page): string {
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

/** The status an API call answered with: 200 when it succeeded. */
async function statusOf(call: Promise<unknown>): Promise<number> {
  try {
    await call;
    return 200;
  } catch (error) {
    if (error instanceof OpenVerifyApiError) {
      return error.status;
    }
    throw error;
  }
}

test('a developer creates a webhook, rotates its secret and sends it a test event it receives', async ({
  page,
}) => {
  const stack = readStackInfo();
  const receiver = await startWebhookReceiver();
  let webhookId: string | undefined;
  try {
    await signInAs(page, stack, 'developer');
    await page.goto(`${stack.dashboardUrl}/webhooks`);
    await page.getByRole('link', { name: 'New webhook' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'New webhook' })).toBeVisible();

    // C169.5 (Workflow 9C): a new webhook needs a name.
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Synthetic receiver');
    await page.getByRole('textbox', { name: 'Endpoint URL' }).fill(receiver.url);
    await page.getByRole('checkbox', { name: 'inquiry.approved' }).check();
    await page.getByRole('button', { name: 'Create webhook' }).click();

    // The signing secret is shown once, then the webhook's page opens without it.
    const created = page.getByRole('dialog', { name: 'Webhook created' });
    const firstSecret = await created.getByRole('textbox', { name: 'Signing secret' }).inputValue();
    expect(firstSecret).toMatch(/^wbhsec_[A-Za-z0-9_-]{43}$/);
    await created.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/\/webhooks\/wbh_[0-9A-Z]{26}$/);
    webhookId = idInUrl(page);
    const configuration = page.getByRole('region', { name: 'Configuration' });
    await expect(configuration).toContainText('Enabled');
    await expect(configuration).toContainText(`…${firstSecret.slice(-4)}`);
    expect(await page.content()).not.toContain(firstSecret);

    // Edit: subscribe to a second event; saving opens the webhook again.
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Edit webhook' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'inquiry.declined' }).check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`/webhooks/${webhookId}$`));
    await expect(configuration).toContainText('inquiry.declined');

    // Rotate, keeping the first secret valid for an hour.
    await page.getByRole('button', { name: 'Rotate secret' }).click();
    const rotate = page.getByRole('dialog', { name: 'Rotate the signing secret?' });
    await rotate.getByRole('spinbutton', { name: 'Overlap in seconds' }).fill('3600');
    await rotate.getByRole('button', { name: 'Rotate' }).click();
    const rotated = page.getByRole('dialog', { name: 'New signing secret' });
    const newSecret = await rotated.getByRole('textbox', { name: 'Signing secret' }).inputValue();
    expect(newSecret).toMatch(/^wbhsec_[A-Za-z0-9_-]{43}$/);
    expect(newSecret).not.toBe(firstSecret);
    await expect(rotated).toContainText('The previous secret also signs deliveries until');
    await rotated.getByRole('button', { name: 'Done' }).click();
    await expect(rotated).toBeHidden();
    await expect(configuration).toContainText(`…${newSecret.slice(-4)}`);
    expect(await page.content()).not.toContain(newSecret);

    // Send a test event.
    await page.getByLabel('Event', { exact: true }).selectOption('inquiry.approved');
    await page.getByRole('button', { name: 'Send test event' }).click();
    const sent = page.getByRole('status').filter({ hasText: /^Test event/ });
    await expect(sent).toContainText('sent. Its delivery appears in the list below.');
    const eventId = /evt_[0-9A-Z]{26}/.exec((await sent.textContent()) ?? '')?.[0];
    expect(eventId).toBeDefined();

    // The receiver gets it, signed with the new secret and, during the overlap, the old one.
    const request = await receiver.waitFor(
      (candidate) => candidate.headers['openverify-event-id'] === eventId,
      { timeoutMs: 60_000, description: `simulated event ${String(eventId)}` },
    );
    for (const secret of [newSecret, firstSecret]) {
      expect(
        verifyWebhookSignature({
          body: request.body,
          header: request.headers[OPENVERIFY_SIGNATURE_HEADER],
          secrets: secret,
        }).timestamp,
      ).toBeGreaterThan(0);
    }
    const event = (JSON.parse(request.body) as { data: { attributes: Record<string, unknown> } })
      .data;
    expect(event.attributes).toMatchObject({ name: 'inquiry.approved', simulated: true });

    // The delivery shows in the webhook's deliveries list, and its attempt on its own page.
    const deliveries = page.getByRole('table', { name: 'Deliveries' });
    await expect
      .poll(
        async () => {
          await page.reload();
          return (await deliveries.textContent()) ?? '';
        },
        { timeout: 60_000, intervals: [1_000] },
      )
      .toContain('Succeeded');
    await expect(deliveries).toContainText('inquiry.approved');
    await deliveries.getByRole('link', { name: /^whd_/ }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: /^Delivery whd_/ })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Attempts' })).toContainText('200');
    await expect(page.getByRole('link', { name: eventId ?? '' })).toHaveAttribute(
      'href',
      `/events/${eventId ?? ''}`,
    );
  } finally {
    if (webhookId !== undefined) {
      // Later events must not keep retrying against a receiver that is gone.
      await recordingClient(stack.apiUrl, stack.apiKey).client.webhooks.disable(webhookId);
    }
    await receiver.close();
  }
});

test('a developer creates an API key whose token is shown once and works, then expires it', async ({
  page,
}) => {
  const stack = readStackInfo();
  await signInAs(page, stack, 'developer');
  await page.goto(`${stack.dashboardUrl}/api-keys`);
  await page.getByRole('link', { name: 'Create API key' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New API key' })).toBeVisible();
  // A developer has no pii:view, so the key will not see personal data (Workflow 2B F001).
  await expect(page.getByText('This key will not see personal data')).toBeVisible();
  // Only the scopes the developer holds are offered.
  const scopes = page.getByRole('group', { name: 'Scopes' });
  await expect(scopes.getByRole('checkbox', { name: 'audit-logs:read' })).toHaveCount(0);

  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill(`UI key ${randomUUID().slice(0, 8)}`);
  await scopes.getByRole('checkbox', { name: 'inquiries:read' }).check();
  await page.getByRole('button', { name: 'Create API key' }).click();

  // The token is shown once; the key's page then shows only its prefix.
  const dialog = page.getByRole('dialog', { name: 'API key created' });
  const token = await dialog.getByRole('textbox', { name: 'Token' }).inputValue();
  expect(token).toMatch(/^ov_sbx_[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/api-keys\/key_[0-9A-Z]{26}$/);
  const details = page.getByRole('region', { name: 'Details' });
  await expect(details).toContainText(`${token.slice(0, 11)}…`);
  await expect(details).toContainText('Active');
  expect(page.url()).not.toContain(token);
  expect(await page.content()).not.toContain(token);

  // The token works against the server API, within its scopes.
  const client = createClient({ apiKey: token, baseUrl: stack.apiUrl, maxRetries: 0 });
  expect(await statusOf(client.inquiries.list({ page: { size: 1 } }))).toBe(200);
  expect(await statusOf(client.webhooks.list())).toBe(403);

  // Expired now in the UI, the token is refused.
  await page.getByRole('button', { name: 'Expire' }).click();
  const expire = page.getByRole('dialog', { name: 'Expire this API key?' });
  await expire.getByRole('combobox', { name: 'When' }).selectOption({ label: 'Now' });
  await expire.getByRole('button', { name: 'Expire key' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'The API key expiry is set.' }),
  ).toBeVisible();
  await expect(details).toContainText('Expired');
  await expect
    .poll(() => statusOf(client.inquiries.list({ page: { size: 1 } })), { timeout: 10_000 })
    .toBe(401);
});

/**
 * A time as the dashboard's `datetime-local` fields keep it in UTC: `2026-10-20T12:00:30`, and
 * `2026-10-20T12:01` on a whole minute. Chromium drops zero seconds, and Playwright's `fill`
 * refuses a value the field would not keep ("Malformed value").
 */
const utcFieldValue = (at: Date) => at.toISOString().slice(0, 19).replace(/:00$/, '');

test('a developer creates an API key with an expiry, sees it and the masked label, and the token answers 401 once it passed (C25.5, C25.6)', async ({
  page,
}) => {
  const stack = readStackInfo();
  await signInAs(page, stack, 'developer');
  await page.goto(`${stack.dashboardUrl}/api-keys/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'New API key' })).toBeVisible();

  const name = `UI expiring key ${randomUUID().slice(0, 8)}`;
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page
    .getByRole('group', { name: 'Scopes' })
    .getByRole('checkbox', { name: 'inquiries:read' })
    .check();
  // Long enough for the steps before the wait, short enough not to wait long.
  const expiresAt = new Date(Date.now() + 30_000);
  await page
    .getByRole('combobox', { name: 'Expires' })
    .selectOption({ label: 'At a date and time (UTC)' });
  await page.getByLabel('Expires at (UTC)').fill(utcFieldValue(expiresAt));
  await page.getByRole('button', { name: 'Create API key' }).click();

  // One call made the key with its expiry: the dialog says when.
  const dialog = page.getByRole('dialog', { name: 'API key created' });
  const token = await dialog.getByRole('textbox', { name: 'Token' }).inputValue();
  expect(token).toMatch(/^ov_sbx_[A-Za-z0-9_-]{43}$/);
  await expect(dialog).toContainText(/It expires on .+ UTC\./);
  const client = createClient({ apiKey: token, baseUrl: stack.apiUrl, maxRetries: 0 });
  expect(await statusOf(client.inquiries.list({ page: { size: 1 } }))).toBe(200);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/api-keys\/key_[0-9A-Z]{26}$/);

  // The key's page shows the expiry, to the second of what was chosen, and that a key made by a
  // role without pii:view sees personal data masked (Workflow 2B F001).
  const details = page.getByRole('region', { name: 'Details' });
  await expect(details).toContainText('Expires');
  const shown = await details.locator('time').first().getAttribute('datetime');
  expect(Math.abs(Date.parse(shown ?? '') - expiresAt.getTime())).toBeLessThan(2_000);
  await expect(details).toContainText('Masked: this key reads field values');

  // The list labels it too.
  await page.goto(`${stack.dashboardUrl}/api-keys`);
  const row = page
    .getByRole('table', { name: 'API keys' })
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name }) });
  await expect(row).toContainText('Masked');

  // Once the expiry passed, the token is refused; waiting no longer than needed.
  await expect
    .poll(() => statusOf(client.inquiries.list({ page: { size: 1 } })), {
      timeout: Math.max(0, expiresAt.getTime() - Date.now()) + 15_000,
      intervals: [1_000],
    })
    .toBe(401);
  await page.reload();
  await expect(row).toContainText('Expired');
});
