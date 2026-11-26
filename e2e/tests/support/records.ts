/**
 * Workflow 5C (`dashboard-records`, C66) spec helpers: a records verification (database, AAMVA,
 * business registry, business website) created, entered and submitted through the flow API as
 * the hosted flow does, against the sandbox providers the e2e stack binds for sandbox
 * environments (C63); the verification as the customer's key reads it; and the console's
 * evidence of it, read by accessible names. Every value a spec enters is synthetic.
 */
import { randomUUID } from 'node:crypto';
import type { VerificationCheck } from '@openverify/contracts';
import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { readStackInfo } from '../../src/stack-info.js';
import { phase5Template, startInquiry } from './phase5.js';
import { phase5bFlow } from './phase5b.js';
import { flowApi, giveFlowConsent, recordingClient, settledFlowVerification } from './platform.js';
import { signInAs, type SeededRole } from './ui.js';

type Template = Parameters<typeof phase5Template>;

export interface RecordsAttempt {
  /** The C50.1 API type the flow creates (`database`, `aamva`, …). */
  readonly type: string;
  readonly steps: Template[1];
  readonly config: Template[2];
  /** Words added to the reference id, such as a sandbox token (C59.2). */
  readonly token?: string;
  readonly values: Readonly<Record<string, unknown>>;
}

/** What the customer's key reads of a settled verification. */
export interface ServedVerification {
  readonly id: string;
  readonly inquiryId: string;
  readonly status: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly checks: Readonly<Record<string, VerificationCheck>>;
}

/** The verification `id` as the customer's key reads it. */
export async function servedVerification(id: string): Promise<ServedVerification> {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data } = await client.verifications.retrieve(id);
  return {
    id,
    inquiryId: data.relationships.inquiry.data.id,
    status: data.attributes.status,
    attributes: data.attributes,
    checks: Object.fromEntries(data.attributes.checks.map((check) => [check.name, check])),
  };
}

/**
 * A new inquiry on a new template of `attempt.steps`, its verification created, entered and
 * submitted through the flow API, and read once the worker decided it.
 */
export async function recordsVerification(attempt: RecordsAttempt): Promise<ServedVerification> {
  const stack = readStackInfo();
  const run = randomUUID();
  const name = `e2e-ui-records-${attempt.type}-${run}`;
  const { sessionToken } = await startInquiry(
    stack,
    phase5Template(name, attempt.steps, attempt.config),
    attempt.token === undefined ? name : `${name} ${attempt.token}`,
  );
  const flow = flowApi(stack.apiUrl, sessionToken);
  await giveFlowConsent(flow);
  const phase5b = phase5bFlow(stack, sessionToken);
  const id = await phase5b.create(attempt.type);
  await phase5b.enterInputs(id, attempt.values);
  await phase5b.submit(id);
  await settledFlowVerification(flow, id, 60_000);
  return servedVerification(id);
}

/** A seeded operator's own browser context, signed in, on the verification's console page. */
export async function consoleVerification(
  browser: Browser,
  role: SeededRole,
  verification: { readonly id: string },
): Promise<{ readonly page: Page; readonly close: () => Promise<void> }> {
  const stack = readStackInfo();
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, stack, role);
  await page.goto(`${stack.dashboardUrl}/verifications/${verification.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(verification.id);
  return { page, close: () => context.close() };
}

/** The evidence group of the verification titled `label` (C54.5). */
export const evidenceGroup = (page: Page, label: string): Locator =>
  page.getByRole('group', { name: `${label} evidence`, exact: true });

/** The value (`<dd>`) beside the term (`<dt>`) `name` inside `scope`. */
export const evidenceTerm = (scope: Locator, name: string): Locator =>
  scope.locator(`dt:text-is("${name}") + dd`);

/** The row of `table` whose row header is `name` (an inner locator is the page's, as Playwright needs). */
export const evidenceRow = (table: Locator, name: string): Locator =>
  table
    .getByRole('row')
    .filter({ has: table.page().getByRole('rowheader', { name, exact: true }) });
