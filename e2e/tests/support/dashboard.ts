/** What an operator does in the dashboard (apps/dashboard). */
import { expect, type Page } from '@playwright/test';

export async function signIn(
  page: Page,
  dashboardUrl: string,
  admin: { email: string; password: string },
): Promise<void> {
  await page.goto(`${dashboardUrl}/login`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in to OpenVerify' }),
  ).toBeVisible();
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/inquiries$/);
}

/** The table row of one inquiry in the inquiries list. */
export function inquiryRow(page: Page, inquiryId: string) {
  return page.getByRole('row').filter({ has: page.getByRole('link', { name: inquiryId }) });
}

/** One check's row in a verification card's checks table. */
export function checkRow(page: Page, verificationLabel: string, checkName: string) {
  return page
    .getByRole('table', { name: `${verificationLabel} checks` })
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: checkName, exact: true }) });
}
