/**
 * Helpers of `ui-signals.spec.ts` (Workflow 7C, `dashboard-signals`): a template with one database
 * step whose version screens one named list, a session opened from a sandbox address through the
 * stack's trusted proxy (F34), the database step entered with a fictional person, and the waits for
 * the inquiry's signals and list screening, and a template whose first step is a device handoff.
 * Every value is synthetic.
 */
import { randomInt } from 'node:crypto';
import { DEFAULT_DATABASE_CHECKS, type ListConfig } from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import { expect, type Browser, type Page } from '@playwright/test';
import type { StackInfo } from '../../src/stack-info.js';
import { presentAddress } from './network.js';
import { phase5Template, typeConfig } from './phase5.js';
import { dashboardRequest } from './platform.js';
import { sessionTokenAs } from './ui.js';

type Steps = Parameters<typeof phase5Template>[1];

const DATABASE_STEPS: Steps = [
  {
    id: 'records',
    type: 'database',
    fields: [
      'name_first',
      'name_last',
      'birthdate',
      'address_street_1',
      'address_city',
      'address_postal_code',
      'address_country_code',
    ],
  },
];

/**
 * C107.7, F30: a template with a `device_handoff` step needs the environment's display name to
 * publish. The same name `handoff.spec.ts` sets, so the two specs change nothing for each other.
 */
export async function nameTheOrganization(stack: StackInfo): Promise<void> {
  const answer = await dashboardRequest(stack, 'PATCH', '/settings', {
    token: await sessionTokenAs(stack, 'admin'),
    body: { 'organization-display-name': 'Example Verification Ltd' },
  });
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
}

/** A published template: consent, a QR handoff, then the database step. */
export async function handoffTemplate(client: OpenVerifyClient, name: string): Promise<string> {
  const { data: template } = await client.inquiryTemplates.create(
    phase5Template(
      name,
      [{ id: 'handoff', type: 'device_handoff', methods: ['qr'] }, ...DATABASE_STEPS],
      { database: typeConfig(DEFAULT_DATABASE_CHECKS) },
    ),
  );
  return template.id;
}

/** A random address of `203.0.113.0/24`, the sandbox range with a fictional city point (C93.6). */
export function sandboxCityAddress(): string {
  return `203.0.113.${String(1 + randomInt(254))}`;
}

/** A published database template whose version collects the default signals and screens `listConfig`. */
export async function databaseTemplate(
  client: OpenVerifyClient,
  name: string,
  listConfig: ListConfig,
): Promise<string> {
  const attributes = phase5Template(name, DATABASE_STEPS, {
    database: typeConfig(DEFAULT_DATABASE_CHECKS),
  });
  const { data: template } = await client.inquiryTemplates.create(attributes);
  const { data: draft } = await client.inquiryTemplateVersions.create({
    'inquiry-template-id': template.id,
    flow: attributes.flow,
    'verification-config': attributes['verification-config'],
    'signal-config': { collect: 'default' },
    'list-config': listConfig,
  });
  await client.inquiryTemplateVersions.publish(draft.id);
  return template.id;
}

/** A page in its own context whose API requests come from `address` (through the trusted proxy). */
export async function pageFrom(browser: Browser, apiUrl: string, address: string): Promise<Page> {
  const context = await browser.newContext();
  await presentAddress(context, apiUrl, address);
  return context.newPage();
}

/** The fictional person of the database spec, entered in the hosted flow's form. */
export async function enterDatabaseRecord(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Enter your details' })).toBeVisible();
  await page.getByRole('textbox', { name: 'First name' }).fill('Bob');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Quillon');
  await page.getByLabel('Date of birth', { exact: true }).fill('1984-07-09');
  const address = page.getByRole('group', { name: 'Address' });
  await address.getByRole('textbox', { name: 'Address line 1' }).fill('12 Example Street');
  await address.getByRole('textbox', { name: 'Town or city' }).fill('Exampleton');
  await address.getByRole('textbox', { name: 'Postal code' }).fill('00000');
  await address.getByRole('combobox', { name: 'Country' }).selectOption('US');
  await page.getByRole('button', { name: 'Continue' }).click();
}

/**
 * Waits until the inquiry's signals are computed and its list screening ended (C90.5, C99.4), and
 * returns the screening's status.
 */
export async function waitForScreening(
  client: OpenVerifyClient,
  inquiryId: string,
  timeout: number,
): Promise<string | null> {
  let status: string | null = null;
  await expect
    .poll(
      async () => {
        const { data } = await client.inquiries.retrieve(inquiryId);
        const details = data.attributes['signal-details'];
        const entry = details?.['inquiry/list_match_count'] as
          { readonly 'list-screening'?: { readonly status: string } } | undefined;
        status = entry?.['list-screening']?.status ?? null;
        return details?.['computed-at'] !== null && status !== null && status !== 'pending';
      },
      { timeout, intervals: [500, 1000] },
    )
    .toBe(true);
  return status;
}
