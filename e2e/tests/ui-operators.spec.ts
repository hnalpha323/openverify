/**
 * C24 specs 2 and 8, through the dashboard UI (C15, C21, C23):
 * - spec 2: an admin invites a user on `/users`, the email arrives in Mailpit, the invitee
 *   accepts on `/accept-invitation`, then signs in with the role they were given;
 * - spec 8: a developer switches the session to production in the header and the banner
 *   changes; a reviewer is offered no production, and the API refuses one.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { waitForMail } from '../src/mailpit.js';
import { readStackInfo } from '../src/stack-info.js';
import { dashboardRequest } from './support/platform.js';
import {
  environmentBanner,
  expectConsole,
  sessionTokenAs,
  signInAs,
  signInThroughUi,
  signOut,
} from './support/ui.js';

const INVITATION_LINK = /(https?:\/\/\S+\/accept-invitation#token=ovi_[A-Za-z0-9_-]{43})/;

/** The console navigation the operator's role allows (C21). */
const consoleNav = (page: Page) => page.getByRole('navigation', { name: 'Console' });

test('an admin invites a user, who accepts by email and signs in with the given role', async ({
  page,
  browser,
}) => {
  const stack = readStackInfo();
  const suffix = randomUUID().slice(0, 8);
  const email = `ui-invitee-${suffix}@example.test`;
  const invitee = { email, password: `e2e-${randomUUID()}`, name: `UI Invitee ${suffix}` };

  await signInAs(page, stack, 'admin');
  await consoleNav(page).getByRole('link', { name: 'Users' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  await page.getByRole('button', { name: 'Invite a user' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite a user' });
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('checkbox', { name: 'Reviewer' }).check();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();

  await expect(page.getByText(`Invitation sent to ${email}.`)).toBeVisible();
  await expect(dialog).toBeHidden();
  const invitedRow = page.getByRole('row').filter({ hasText: email });
  await expect(invitedRow).toContainText('Invited');
  await expect(invitedRow).toContainText('Reviewer');

  // The email carries the link with the token in its fragment; the dashboard never saw it.
  const mail = await waitForMail(stack.mailpitUrl, email, { timeoutMs: 30_000 });
  const link = INVITATION_LINK.exec(mail.text)?.[1];
  expect(link?.startsWith(`${stack.dashboardUrl}/accept-invitation#token=ovi_`)).toBe(true);

  // The invitee opens it in a browser of their own.
  const inviteeContext = await browser.newContext();
  try {
    const inviteePage = await inviteeContext.newPage();
    await inviteePage.goto(link ?? '');
    await expect(inviteePage.getByRole('heading', { name: 'Join OpenVerify' })).toBeVisible();
    await inviteePage.getByLabel('Your name').fill(invitee.name);
    // The token left the address bar as soon as the page read it.
    await expect(inviteePage).toHaveURL(`${stack.dashboardUrl}/accept-invitation`);
    await inviteePage.getByLabel('Password', { exact: true }).fill(invitee.password);
    await inviteePage.getByLabel('Repeat the password').fill(invitee.password);
    await inviteePage.getByRole('button', { name: 'Create my account' }).click();
    await expectConsole(inviteePage);
    await expect(inviteePage.getByRole('banner')).toContainText(invitee.name);

    // Signing in again later works with the password chosen, and the role is the reviewer's:
    // inquiries, but no user administration.
    await signOut(inviteePage);
    await signInThroughUi(inviteePage, stack, invitee);
    await expect(inviteePage.getByRole('banner')).toContainText(invitee.name);
    await expect(consoleNav(inviteePage).getByRole('link', { name: 'Inquiries' })).toBeVisible();
    await expect(consoleNav(inviteePage).getByRole('link', { name: 'Users' })).toHaveCount(0);
    await inviteePage.goto(`${stack.dashboardUrl}/users`);
    await expect(
      inviteePage.getByRole('heading', { level: 1, name: 'You do not have access' }),
    ).toBeVisible();
  } finally {
    await inviteeContext.close();
  }

  // The admin's list now shows them active, with the role they were given.
  await page.reload();
  const activeRow = page.getByRole('row').filter({ hasText: email });
  await expect(activeRow).toContainText(invitee.name);
  await expect(activeRow).toContainText('Active');
  await expect(activeRow).toContainText('Reviewer');
});

test('a developer switches to production in the header, and the banner changes', async ({
  page,
}) => {
  // The header learns the organization's environments from GET /dashboard/me `meta.environments`.
  const stack = readStackInfo();

  await signInAs(page, stack, 'developer');
  await expect(environmentBanner(page)).toContainText('Sandbox');
  const header = page.getByRole('banner');
  const toProduction = header.getByRole('button', { name: 'Switch to production' });
  await expect(toProduction).toBeVisible();
  await toProduction.click();

  await expect(environmentBanner(page)).toContainText('Production');
  await expect(header).toContainText('Environment: Production');
  await header.getByRole('button', { name: 'Switch to sandbox' }).click();
  await expect(environmentBanner(page)).toContainText('Sandbox');
});

test('a reviewer is offered no production, and the API refuses a switch to it', async ({
  page,
}) => {
  const stack = readStackInfo();

  await signInAs(page, stack, 'reviewer');
  const header = page.getByRole('banner');
  await expect(header).toContainText('Environment: Sandbox');
  await expect(header.getByRole('button', { name: /Switch to production/ })).toHaveCount(0);
  await expect(environmentBanner(page)).toContainText('Sandbox');

  // Hiding the option is UX only: the API refuses the switch itself (C15).
  const token = await sessionTokenAs(stack, 'reviewer');
  const refused = await dashboardRequest(stack, 'PUT', '/sessions/current/environment', {
    token,
    body: { 'environment-id': stack.environments.production },
  });
  expect(refused.status).toBe(403);
});
