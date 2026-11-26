/**
 * C24 spec 1: multi-factor sign-in through the dashboard (C22). The seeded admin signs in with a
 * TOTP code; a new operator adds a security key on the account security page and signs in with
 * Chromium's virtual authenticator; another adds an authenticator app from its QR code and secret.
 *
 * C27 (Workflow 2E): a wrong code keeps the operator on `/login/mfa` (`mfa_code_invalid`), and an
 * `mfa-token` spent in another browser returns them to `/login` (`mfa_token_invalid`, C25.1).
 */
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { totpCode } from '../src/totp.js';
import {
  addVirtualAuthenticator,
  createOperator,
  enterTotpCode,
  environmentBanner,
  expectConsole,
  freshTotpCode,
  signInThroughUi,
  signOut,
  submitLogin,
  submitTotpCode,
} from './support/ui.js';

/** A code that is none of the codes the API accepts now (the previous, current and next step). */
function wrongCodeFor(secret: string): string {
  const now = Date.now();
  const accepted = [-30_000, 0, 30_000].map((offset) => totpCode(secret, new Date(now + offset)));
  return ['000000', '111111', '222222', '333333'].find((code) => !accepted.includes(code)) ?? '';
}

test('an admin enrolled in TOTP signs in through the dashboard with a code', async ({ page }) => {
  const stack = readStackInfo();
  const { mfaAdmin } = stack;

  await submitLogin(page, stack, mfaAdmin);

  await expect(page).toHaveURL(/\/login\/mfa$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Confirm it is you' })).toBeVisible();
  // The mfa-token lives in an httpOnly, SameSite=Strict cookie scoped to /login: never in the
  // URL or the page, and no session cookie exists yet.
  expect(page.url()).not.toContain('ovm_');
  expect(await page.content()).not.toContain('ovm_');
  const pending = await page.context().cookies();
  expect(pending.find((cookie) => cookie.name === 'openverify_mfa')).toMatchObject({
    httpOnly: true,
    sameSite: 'Strict',
    path: '/login',
  });
  expect(pending.some((cookie) => cookie.name === '__Host-openverify_session')).toBe(false);

  // A wrong code is refused; the API counts the attempts (C25.1).
  await page.getByLabel('Authentication code').fill(wrongCodeFor(mfaAdmin.totpSecret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(
    page.getByText('That code is not valid. After five wrong attempts you need to sign in again.'),
  ).toBeVisible();

  await enterTotpCode(page, mfaAdmin.totpSecret);

  await expect(page).toHaveURL(/\/inquiries$/);
  await expect(environmentBanner(page)).toContainText('Sandbox');
  await expect(page.getByRole('banner')).toContainText('Dev MFA admin');
  const signedIn = await page.context().cookies();
  // KP11-78: a production build's session cookie is Secure, host-only and on `/` (`__Host-`).
  expect(signedIn.find((cookie) => cookie.name === '__Host-openverify_session')).toMatchObject({
    httpOnly: true,
    secure: true,
    path: '/',
  });
  expect(signedIn.some((cookie) => cookie.name === 'openverify_mfa')).toBe(false);
});

test('a wrong code keeps the operator on /login/mfa, and an mfa-token spent elsewhere returns them to sign in (C25.1)', async ({
  page,
  browser,
}) => {
  const stack = readStackInfo();
  const { mfaAdmin } = stack;
  await submitLogin(page, stack, mfaAdmin);
  await expect(page).toHaveURL(/\/login\/mfa$/);

  // mfa_code_invalid: refused, and the operator stays to try again.
  expect(await submitTotpCode(page, wrongCodeFor(mfaAdmin.totpSecret))).toBe('refused');
  await expect(page).toHaveURL(/\/login\/mfa$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Confirm it is you' })).toBeVisible();

  // The same challenge, completed in another browser: the token was usable after the wrong code,
  // and is spent now.
  const elsewhere = await browser.newContext();
  try {
    await elsewhere.addCookies(await page.context().cookies());
    const other = await elsewhere.newPage();
    await other.goto(`${stack.dashboardUrl}/login/mfa`);
    await expect(other.getByRole('heading', { level: 1, name: 'Confirm it is you' })).toBeVisible();
    await enterTotpCode(other, mfaAdmin.totpSecret);
  } finally {
    await elsewhere.close();
  }

  // mfa_token_invalid: back to sign in, with a message, and the challenge cookie gone.
  await page.getByLabel('Authentication code').fill(wrongCodeFor(mfaAdmin.totpSecret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/login\?reason=mfa-invalid$/);
  await expect(page.getByText('That sign-in is no longer valid. Sign in again.')).toBeVisible();
  expect((await page.context().cookies()).some((cookie) => cookie.name === 'openverify_mfa')).toBe(
    false,
  );
});

test('an operator adds a security key on the security page and signs in with it', async ({
  page,
}) => {
  const stack = readStackInfo();
  const operator = await createOperator(stack, 'viewer');
  const authenticator = await addVirtualAuthenticator(page);

  await signInThroughUi(page, stack, operator);
  await page.getByRole('link', { name: 'Security' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Account security' })).toBeVisible();
  await expect(page.getByText('No second factor yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Add a security key' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a security key' });
  await dialog.getByLabel('Name (optional)').fill('E2E key');
  await dialog.getByRole('button', { name: 'Continue' }).click();

  // The first factor comes with 10 recovery codes, shown once.
  const codes = page.getByRole('dialog', { name: 'Save your recovery codes' });
  await expect(
    codes.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem'),
  ).toHaveCount(10);
  await codes.getByRole('button', { name: 'Done' }).click();
  await expect(codes).toBeHidden();
  const factors = page.getByRole('table', { name: 'Second factors' });
  await expect(factors.getByRole('rowheader', { name: 'E2E key' })).toBeVisible();
  await expect(factors).toContainText('Security key');
  expect(await authenticator.credentialCount()).toBe(1);

  await signOut(page);
  await submitLogin(page, stack, operator);
  await expect(page).toHaveURL(/\/login\/mfa$/);
  // Only the factor types this user has are offered.
  await expect(page.getByLabel('Authentication code')).toHaveCount(0);
  await page.getByRole('button', { name: 'Use a security key' }).click();

  await expectConsole(page);
  await expect(page.getByRole('banner')).toContainText(operator.name);
});

test('an operator adds an authenticator app from its QR code and secret, then signs in with it', async ({
  page,
}) => {
  const stack = readStackInfo();
  const operator = await createOperator(stack, 'reviewer');

  await signInThroughUi(page, stack, operator);
  await page.getByRole('link', { name: 'Security' }).click();
  await page.getByRole('button', { name: 'Add an authenticator app' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add an authenticator app' });
  await dialog.getByLabel('Name (optional)').fill('E2E phone');
  await dialog.getByRole('button', { name: 'Continue' }).click();

  await expect(
    dialog.getByRole('img', { name: 'QR code for your authenticator app' }),
  ).toBeVisible();
  const secret = await dialog.getByLabel('Secret key').inputValue();
  expect(secret).toMatch(/^[A-Z2-7]{16,128}$/);
  expect(page.url()).not.toContain(secret);
  await dialog.getByLabel('Authentication code').fill(await freshTotpCode(secret));
  await dialog.getByRole('button', { name: 'Activate' }).click();

  const codes = page.getByRole('dialog', { name: 'Save your recovery codes' });
  await expect(
    codes.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem'),
  ).toHaveCount(10);
  await codes.getByRole('button', { name: 'Done' }).click();
  const factors = page.getByRole('table', { name: 'Second factors' });
  await expect(factors.getByRole('rowheader', { name: 'E2E phone' })).toBeVisible();
  await expect(factors).toContainText('Active');
  // The secret was shown once: it is gone from the page.
  expect(await page.content()).not.toContain(secret);

  await signOut(page);
  await submitLogin(page, stack, operator);
  await expect(page).toHaveURL(/\/login\/mfa$/);
  await enterTotpCode(page, secret);
  await expect(page.getByRole('banner')).toContainText(operator.name);
});
