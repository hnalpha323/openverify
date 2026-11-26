/**
 * `dashboard-reports`' spec helpers (Workflow 6B, C86): a console page signed in as a seeded role,
 * the server API with the seeded sandbox key, and the parts of the report pages a spec reads.
 * Every value is synthetic; the listed person is the sandbox list's fictional entry
 * (`SANDBOX_LISTS.listedPerson`), checked against the committed fixture by the spec.
 */
import type { OpenVerifyClient } from '@openverify/node';
import type { Browser, Locator, Page } from '@playwright/test';
import type { StackInfo } from '../../src/stack-info.js';
import { recordingClient } from './platform.js';
import { signInAs, type SeededRole } from './ui.js';

/** The server API with the seeded sandbox key (every scope, personal data shown). */
export function serverClient(stack: StackInfo): OpenVerifyClient {
  return recordingClient(stack.apiUrl, stack.apiKey).client;
}

/** Runs `body` on a fresh page signed in as `role` (a kept session), closing it afterwards. */
export async function asRole(
  browser: Browser,
  stack: StackInfo,
  role: SeededRole,
  body: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signInAs(page, stack, role);
    await body(page);
  } finally {
    await context.close();
  }
}

/** A region of the page (a section, named by its heading). */
export function region(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

/** The value of a `<dl>` term inside `scope`. */
export function termValue(scope: Locator, term: string): Locator {
  return scope.locator(`dt:text-is("${term}") + dd`);
}

/** The row of `table` whose row header is `name`. */
export function rowOf(table: Locator, name: string): Locator {
  return table.getByRole('row').filter({ has: table.page().getByRole('rowheader', { name }) });
}

/** The report id in the page URL, once the console opened a report. */
export function reportIdOf(page: Page): string {
  const id = /\/reports\/(rep_[0-9A-HJKMNP-TV-Z]{26})$/.exec(new URL(page.url()).pathname)?.[1];
  if (id === undefined) {
    throw new Error(`Not on a report page: ${page.url()}`);
  }
  return id;
}
