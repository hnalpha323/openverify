/**
 * `dashboard-report-config`'s spec helpers (Workflow 6B, C86): the seeded roles signed in once for
 * the file, a page with a kept session, the server API as the signed-in operator, and the parts
 * of the report template and watchlist sources pages a spec reads. Every value is synthetic.
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
import { signInAs } from './ui.js';

/** The seeded roles this spec reads the console as: one writes and publishes, one reads. */
export type ConfigRole = 'developer' | 'viewer';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * The dashboard's session cookie (`apps/dashboard/src/lib/session-cookie.ts`): the e2e stack serves
 * a production build, whose session cookie is Secure and so named with the `__Host-` prefix (KP11-78).
 */
const SESSION_COOKIE = '__Host-openverify_session';

/**
 * Signs each role in once and keeps its session: every sign-in attempt counts against the API's
 * login limits (C4), which the whole full-stack suite shares.
 */
export async function signedInConfigStates(
  browser: Browser,
  stack: StackInfo,
  roles: readonly ConfigRole[],
): Promise<Record<ConfigRole, StorageState>> {
  const states: Partial<Record<ConfigRole, StorageState>> = {};
  for (const role of roles) {
    const context = await browser.newContext();
    try {
      await signInAs(await context.newPage(), stack, role);
      states[role] = await context.storageState();
    } finally {
      await context.close();
    }
  }
  return states as Record<ConfigRole, StorageState>;
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

/** The `ovu_` session token of a kept session, which the dashboard and server APIs accept. */
export function sessionTokenOf(state: StorageState): string {
  const cookie = state.cookies.find((entry) => entry.name === SESSION_COOKIE);
  if (cookie === undefined) {
    throw new Error('The kept session has no session cookie');
  }
  return cookie.value;
}

/** The server API as the signed-in operator, in the environment their session is in. */
export function operatorClient(stack: StackInfo, state: StorageState): OpenVerifyClient {
  return recordingClient(stack.apiUrl, sessionTokenOf(state)).client;
}

/**
 * The row of `table` whose row header matches `name`. The inner locator starts at the page: a
 * `has` locator is matched inside each row, so one built from the table would never match.
 */
export function rowOf(table: Locator, name: string | RegExp): Locator {
  return table.getByRole('row').filter({ has: table.page().getByRole('rowheader', { name }) });
}

/** A template configuration as the API serves it (typed per report type), as a record. */
export function configOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A template configuration is an object');
  }
  return value as Record<string, unknown>;
}

/** The draft editor's JSON text area. */
export function configEditor(page: Page): Locator {
  return page
    .getByRole('form', { name: 'Edit the draft configuration' })
    .getByRole('textbox', { name: 'Configuration' });
}

/** Types `json` into the draft editor and saves it. */
export async function saveDraftConfig(page: Page, json: string): Promise<void> {
  await configEditor(page).fill(json);
  await page
    .getByRole('form', { name: 'Edit the draft configuration' })
    .getByRole('button', { name: 'Save draft' })
    .click();
}

/**
 * Waits for a toast that confirms the draft was saved. Success toasts time out, so an earlier one
 * may still show: a spec checks what the save changed in the resolved configuration as well.
 */
export async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByText('Saved the draft.').first()).toBeVisible();
}

/** The value cell of one setting in a resolved configuration table. */
export function resolvedValue(table: Locator, setting: string): Locator {
  return rowOf(table, new RegExp(`^${setting}`))
    .getByRole('cell')
    .first();
}
