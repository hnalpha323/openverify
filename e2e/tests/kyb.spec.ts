/**
 * C61, C65.5 (Workflow 5B): business registry and business website verification, full stack,
 * against the sandbox providers the e2e stack binds for sandbox environments (C63). The last four
 * characters of the registration number pick the sandbox register's answer (C61.6), and the
 * reserved names `*.example` resolve with no DNS query in a sandbox environment (C61.3).
 * - A business entered in the hosted flow's form with an ordinary number: the register echoes it,
 *   active and authoritative, and the verification passes.
 * - Ending `0000`: the register holds another business, `low_confidence_match`: failed. Ending
 *   `8888`: the business is dissolved, `business_inactive`: failed.
 * - Ending `7777` on a step that collects associated persons: the person entered is not on the
 *   register, an advisory failure, and the verification passes.
 * - `old.example`, entered in the hosted flow: it resolves and was registered 20 years ago.
 *   `new.example`: 3 days old, an advisory `domain_recently_registered`, and it passes.
 * Every business, person and number is synthetic.
 */
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_BUSINESS_WEBSITE_CHECKS,
  DEFAULT_DATABASE_BUSINESS_CHECKS,
} from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { collectConsoleErrors, giveConsent } from './support/flow.js';
import { phase5Template, startInquiry, typeConfig } from './support/phase5.js';
import { phase5bFlow } from './support/phase5b.js';
import {
  flowApi,
  giveFlowConsent,
  recordingClient,
  settledFlowVerification,
} from './support/platform.js';

type Steps = Parameters<typeof phase5Template>[1];

const BUSINESS = 'Quillon Lantern Works Ltd';
const businessSteps = (collectAssociatedPersons: boolean): Steps => [
  { id: 'business', type: 'database_business', collectAssociatedPersons },
];
const BUSINESS_CONFIG = { 'database-business': typeConfig(DEFAULT_DATABASE_BUSINESS_CHECKS) };
const WEBSITE_STEPS: Steps = [{ id: 'website', type: 'business_website' }];
const WEBSITE_CONFIG = { 'business-website': typeConfig(DEFAULT_BUSINESS_WEBSITE_CHECKS) };

async function newInquiry(
  name: string,
  steps: Steps,
  config: Parameters<typeof phase5Template>[2],
) {
  const stack = readStackInfo();
  const run = randomUUID();
  return startInquiry(
    stack,
    phase5Template(`e2e-${name}-${run}`, steps, config),
    `e2e-${name}-${run}`,
  );
}

/** A verification of `type` entered and submitted through the flow API; its settled flow view. */
async function enteredAttempt(
  sessionToken: string,
  type: 'database-business' | 'business-website',
  values: Readonly<Record<string, unknown>>,
) {
  const stack = readStackInfo();
  const flow = flowApi(stack.apiUrl, sessionToken);
  await giveFlowConsent(flow);
  const phase5b = phase5bFlow(stack, sessionToken);
  const verificationId = await phase5b.create(type);
  await phase5b.enterInputs(verificationId, values);
  await phase5b.submit(verificationId);
  return { verificationId, settled: await settledFlowVerification(flow, verificationId, 60_000) };
}

async function serverVerification(verificationId: string) {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data } = await client.verifications.retrieve(verificationId);
  return {
    status: data.attributes.status,
    checks: Object.fromEntries(data.attributes.checks.map((check) => [check.name, check])),
    attributes: data.attributes as Record<string, unknown>,
  };
}

async function onlyVerification(inquiryId: string) {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const document = await client.inquiries.retrieve(inquiryId, { include: 'verifications' });
  return {
    inquiry: document.data.attributes.status,
    verification: await serverVerification(document.included?.[0]?.id ?? ''),
  };
}

test('a business entered in the hosted flow is found active on the sandbox register, and passes (C61.2, C61.7, C64.1)', async ({
  page,
}) => {
  const { inquiryId, flowUrl } = await newInquiry('kyb', businessSteps(false), BUSINESS_CONFIG);
  const errors = collectConsoleErrors(page);
  await page.goto(flowUrl);
  await giveConsent(page);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tell us about your business' }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Business name' }).fill(BUSINESS);
  await page.getByRole('combobox', { name: 'Country of registration' }).selectOption('GB');
  await page.getByRole('textbox', { name: 'Registration number' }).fill('01234567');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Verification submitted' })).toBeVisible(
    { timeout: 60_000 },
  );
  expect(errors).toEqual([]);

  await expect.poll(async () => (await onlyVerification(inquiryId)).inquiry).toBe('completed');
  const { status, checks, attributes } = (await onlyVerification(inquiryId)).verification;
  expect(status).toBe('passed');
  expect(checks.database_business_identity_comparison).toMatchObject({
    status: 'passed',
    requirement: 'required',
    metadata: { source: 'sandbox', authoritative: true },
  });
  expect(checks.database_business_active_business_detection).toMatchObject({ status: 'passed' });
  expect(attributes).toMatchObject({
    'business-name': BUSINESS,
    'registration-number': '01234567',
    'registry-source': 'sandbox',
    'registry-record-id': '01234567',
    'registry-status': 'active',
  });
  // C51.4: no check copies the entered or the registered name.
  expect(JSON.stringify(checks)).not.toContain('Quillon');
});

test.describe('the sandbox register’s endings (C61.6)', () => {
  test('0000 holds another business: low_confidence_match fails the identity', async () => {
    const { sessionToken } = await newInquiry('kyb-0000', businessSteps(false), BUSINESS_CONFIG);
    const { verificationId, settled } = await enteredAttempt(sessionToken, 'database-business', {
      'business-name': BUSINESS,
      'country-code': 'GB',
      'registration-number': '12340000',
    });
    expect(settled.attributes.status).toBe('failed');
    expect(
      (await serverVerification(verificationId)).checks.database_business_identity_comparison,
    ).toMatchObject({ status: 'failed', reasons: ['low_confidence_match'] });
  });

  test('8888 is dissolved: business_inactive fails the active check', async () => {
    const { sessionToken } = await newInquiry('kyb-8888', businessSteps(false), BUSINESS_CONFIG);
    const { verificationId, settled } = await enteredAttempt(sessionToken, 'database-business', {
      'business-name': BUSINESS,
      'country-code': 'GB',
      'registration-number': '12348888',
    });
    expect(settled.attributes.status).toBe('failed');
    const { checks } = await serverVerification(verificationId);
    expect(checks.database_business_active_business_detection).toMatchObject({
      status: 'failed',
      reasons: ['business_inactive'],
    });
    expect(checks.database_business_identity_comparison).toMatchObject({ status: 'passed' });
  });

  test('7777 does not list the person entered: an advisory failure, and the business passes', async () => {
    const { sessionToken } = await newInquiry('kyb-7777', businessSteps(true), BUSINESS_CONFIG);
    const { verificationId, settled } = await enteredAttempt(sessionToken, 'database-business', {
      'business-name': BUSINESS,
      'country-code': 'GB',
      'registration-number': '12347777',
      'associated-persons': [
        { 'name-first': 'Ada', 'name-last': 'Placeholder', birthdate: '1980-04' },
      ],
    });
    expect(settled.attributes.status).toBe('passed');
    const { checks } = await serverVerification(verificationId);
    expect(checks.database_business_associated_persons_comparison).toMatchObject({
      status: 'failed',
      requirement: 'not_required',
      reasons: ['associated_person_not_on_register'],
    });
    expect(JSON.stringify(checks)).not.toContain('Placeholder');
  });
});

test('a website entered in the hosted flow resolves and was registered 20 years ago, and passes (C61.3, C61.4, C64.1)', async ({
  page,
}) => {
  const { inquiryId, flowUrl } = await newInquiry('kyb-website', WEBSITE_STEPS, WEBSITE_CONFIG);
  const errors = collectConsoleErrors(page);
  await page.goto(flowUrl);
  await giveConsent(page);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Enter your business website' }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Website address' }).fill('https://old.example/');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Verification submitted' })).toBeVisible(
    { timeout: 60_000 },
  );
  expect(errors).toEqual([]);

  await expect.poll(async () => (await onlyVerification(inquiryId)).inquiry).toBe('completed');
  const { status, checks, attributes } = (await onlyVerification(inquiryId)).verification;
  expect(status).toBe('passed');
  expect(checks.business_website_resolution_detection).toMatchObject({
    status: 'passed',
    requirement: 'required',
  });
  const age = checks.business_website_domain_age_detection;
  expect(age).toMatchObject({ status: 'passed', requirement: 'not_required' });
  expect(Number(age?.metadata['age-days'])).toBeGreaterThan(7_000);
  expect(attributes).toMatchObject({
    'website-url': 'https://old.example/',
    'website-domain': 'old.example',
  });
  expect(String(attributes['domain-registered-at'])).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
});

test('a domain registered 3 days ago fails the advisory domain age check, and the website passes (C61.4)', async () => {
  const { sessionToken } = await newInquiry('kyb-new-domain', WEBSITE_STEPS, WEBSITE_CONFIG);
  const { verificationId, settled } = await enteredAttempt(sessionToken, 'business-website', {
    'website-url': 'https://new.example/',
  });
  expect(settled.attributes.status).toBe('passed');
  const { checks } = await serverVerification(verificationId);
  expect(checks.business_website_domain_age_detection).toMatchObject({
    status: 'failed',
    requirement: 'not_required',
    reasons: ['domain_recently_registered'],
    metadata: { 'age-days': 3 },
  });
  expect(checks.business_website_resolution_detection).toMatchObject({ status: 'passed' });
});
