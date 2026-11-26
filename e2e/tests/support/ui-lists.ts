/**
 * `dashboard-lists-transactions`' spec helpers (Workflow 7C, C108): the seeded roles signed in once
 * for a file (through `signInAs`, so the run's kept sessions and the API's login limits are
 * shared), a page with a kept session, the server API as the signed-in operator, and the row of a
 * console table. `ui-transactions.ts` reuses them. Every value is synthetic.
 */
import type { OpenVerifyClient } from '@openverify/node';
import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import type { StackInfo } from '../../src/stack-info.js';
import { recordingClient } from './platform.js';
import { sessionTokenAs, signInAs, type SeededRole } from './ui.js';

export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * Signs each role in once (`signInAs`) and keeps its browser state for the file: every sign-in
 * attempt counts against the API's login limits (C4), which the whole suite shares.
 */
export async function signedInStates<Role extends SeededRole>(
  browser: Browser,
  stack: StackInfo,
  roles: readonly Role[],
): Promise<Record<Role, StorageState>> {
  const states: Partial<Record<Role, StorageState>> = {};
  for (const role of roles) {
    const context = await browser.newContext();
    try {
      await signInAs(await context.newPage(), stack, role);
      states[role] = await context.storageState();
    } finally {
      await context.close();
    }
  }
  return states as Record<Role, StorageState>;
}

/** Runs `body` on a page signed in with a kept session, closing its context afterwards. */
export async function withConsolePage(
  browser: Browser,
  state: StorageState,
  body: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({ storageState: state });
  try {
    await body(await context.newPage());
  } finally {
    await context.close();
  }
}

/** The server API as a seeded operator, in the environment of their kept session. */
export async function clientAs(stack: StackInfo, role: SeededRole): Promise<OpenVerifyClient> {
  return recordingClient(stack.apiUrl, await sessionTokenAs(stack, role)).client;
}

/**
 * The row of `table` whose row header matches `name`. The inner locator starts at the page: a
 * `has` locator is matched inside each row, so one built from the table would never match.
 */
export function rowOf(table: Locator, name: string | RegExp): Locator {
  return table.getByRole('row').filter({ has: table.page().getByRole('rowheader', { name }) });
}

/** Waits for a success toast with `message`; earlier toasts may still show. */
export async function expectToast(page: Page, message: string): Promise<void> {
  await expect(page.getByText(message).first()).toBeVisible();
}

/**
 * Reloads `page` until `ready` holds, at most `timeoutMs`: a job's result (an import) shows only
 * on a later render, and the console does not poll.
 */
export async function reloadUntil(
  page: Page,
  ready: () => Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await ready())) {
    if (Date.now() > deadline) {
      throw new Error('The page did not reach the expected state in time');
    }
    await page.waitForTimeout(1_000);
    await page.reload();
  }
}
