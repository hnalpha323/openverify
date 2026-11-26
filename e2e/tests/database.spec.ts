/**
 * C52.3, C58, C59, C65.5 (Workflow 5A): database and AAMVA verification, full stack, against the
 * sandbox providers the e2e stack binds for sandbox environments (C63). A magic token in the
 * inquiry's reference id picks the sandbox database record (C59.2); the last four characters of
 * the entered license number pick the AAMVA answer (C59.4).
 * - `sandbox-database-nickname`, entered in the hosted flow's database form: the record holds the
 *   formal given name of the nickname typed, a partial name match (C58.3), and the default
 *   identity group (name, birthdate and address partial) is met: passed.
 * - `sandbox-database-name-mismatch`: every group is unmet, `low_confidence_match`: failed.
 * - `sandbox-database-no-birthdate`: a thin file leaves the group undecidable,
 *   `insufficient_data`: review, never a fraud failure (C58.1).
 * - A silent AAMVA step after a government ID that is no US license (the synthetic Utopia card):
 *   the server skips the attempt in the ID's decision transaction and the inquiry completes
 *   (C59.6).
 * - The AAMVA form with a number ending `0002`: the issuer's record differs on the postal code,
 *   `record_mismatch`: failed.
 * Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_AAMVA_CHECKS,
  DEFAULT_DATABASE_CHECKS,
  defaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { collectConsoleErrors, giveConsent } from './support/flow.js';
import { phase5Flow, phase5Template, startInquiry, typeConfig } from './support/phase5.js';
import {
  flowApi,
  giveFlowConsent,
  recordingClient,
  settledFlowVerification,
  submitGovernmentId,
} from './support/platform.js';

type Steps = Parameters<typeof phase5Template>[1];

/** A database step collecting a name, a birth date and a street address. */
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
const DATABASE_CONFIG = { database: typeConfig(DEFAULT_DATABASE_CHECKS) };

/** An invented person at an invented address. */
const PERSON = {
  'name-first': 'Robert',
  'name-last': 'Quillon',
  birthdate: '1984-07-09',
  'address-street-1': '12 Example Street',
  'address-city': 'Exampleton',
  'address-postal-code': '00000',
  'address-country-code': 'US',
};

/** A database attempt entered and submitted through the flow API; its settled flow view. */
async function databaseAttempt(token: string) {
  const stack = readStackInfo();
  const run = randomUUID();
  const { inquiryId, sessionToken } = await startInquiry(
    stack,
    phase5Template(`e2e-database-${run}`, DATABASE_STEPS, DATABASE_CONFIG),
    `e2e-database-${run} ${token}`,
  );
  const flow = flowApi(stack.apiUrl, sessionToken);
  await giveFlowConsent(flow);
  const phase5 = phase5Flow(stack, sessionToken);
  const verificationId = await phase5.create('database');
  await phase5.enterInputs(verificationId, PERSON);
  await phase5.submit(verificationId);
  await settledFlowVerification(flow, verificationId, 60_000);
  return { inquiryId, verificationId };
}

/** The verification and its checks as the customer's key reads them. */
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

async function inquiryStatus(inquiryId: string): Promise<string> {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  return (await client.inquiries.retrieve(inquiryId)).data.attributes.status;
}

test('a nickname entered in the hosted flow matches the record’s formal name, and the database verification passes (C58.3, C59, C64.1)', async ({
  page,
}) => {
  const stack = readStackInfo();
  const run = randomUUID();
  const { inquiryId, flowUrl } = await startInquiry(
    stack,
    phase5Template(`e2e-database-${run}`, DATABASE_STEPS, DATABASE_CONFIG),
    `e2e-database-${run} sandbox-database-nickname`,
  );
  const errors = collectConsoleErrors(page);
  await page.goto(flowUrl);
  await giveConsent(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Enter your details' })).toBeVisible();
  await page.getByRole('textbox', { name: 'First name' }).fill('Bob');
  await page.getByRole('textbox', { name: 'Last name' }).fill(PERSON['name-last']);
  await page.getByLabel('Date of birth', { exact: true }).fill(PERSON.birthdate);
  const address = page.getByRole('group', { name: 'Address' });
  await address.getByRole('textbox', { name: 'Address line 1' }).fill(PERSON['address-street-1']);
  await address.getByRole('textbox', { name: 'Town or city' }).fill(PERSON['address-city']);
  await address.getByRole('textbox', { name: 'Postal code' }).fill(PERSON['address-postal-code']);
  await address.getByRole('combobox', { name: 'Country' }).selectOption('US');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Verification submitted' })).toBeVisible(
    { timeout: 60_000 },
  );
  expect(errors).toEqual([]);

  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const document = await client.inquiries.retrieve(inquiryId, { include: 'verifications' });
  expect(document.data.attributes.status).toBe('completed');
  const [verification] = document.included ?? [];
  const { status, checks, attributes } = await serverVerification(verification?.id ?? '');
  expect(status).toBe('passed');
  expect(checks.database_identity_comparison).toMatchObject({
    status: 'passed',
    requirement: 'required',
    metadata: {
      authoritative: false,
      fields: { name: { level: 'partial', methods: expect.arrayContaining(['nickname']) } },
      groups: [{ outcome: 'met' }],
    },
  });
  // C52.8: the entered values, as the key reads them; C51.4: no check copies one.
  expect(attributes).toMatchObject({ 'name-first': 'Bob', 'name-last': PERSON['name-last'] });
  expect(JSON.stringify(checks)).not.toContain('Bob');
});

test('a record whose name differs fails low_confidence_match (C59.3)', async () => {
  const { inquiryId, verificationId } = await databaseAttempt('sandbox-database-name-mismatch');

  const { status, checks } = await serverVerification(verificationId);
  expect(status).toBe('failed');
  expect(checks.database_identity_comparison).toMatchObject({
    status: 'failed',
    reasons: ['low_confidence_match'],
    metadata: { groups: [{ outcome: 'unmet' }] },
  });
  await expect.poll(() => inquiryStatus(inquiryId)).toBe('failed');
});

test('a record without a birth date leaves the identity undecided, insufficient_data, and goes to review (C58.1, C59.3)', async () => {
  const { inquiryId, verificationId } = await databaseAttempt('sandbox-database-no-birthdate');

  const { status, checks } = await serverVerification(verificationId);
  expect(status).toBe('needs_review');
  expect(checks.database_identity_comparison).toMatchObject({
    status: 'not_applicable',
    reasons: ['insufficient_data'],
    metadata: { groups: [{ outcome: 'undecidable' }] },
  });
  await expect.poll(() => inquiryStatus(inquiryId)).toBe('needs_review');
});

test('a silent AAMVA step after a government ID that is no US license is skipped, and the inquiry completes (C59.6)', async () => {
  const stack = readStackInfo();
  const run = randomUUID();
  const defaults = defaultInquiryTemplateAttributes();
  const governmentIdStep = defaults.flow.steps.find((step) => step.type === 'government_id');
  const governmentIdConfig = defaults['verification-config']['government-id'];
  if (governmentIdStep === undefined || governmentIdConfig === undefined) {
    throw new Error('The default template has no government ID step');
  }
  const { inquiryId, sessionToken } = await startInquiry(
    stack,
    phase5Template(
      `e2e-silent-aamva-${run}`,
      [governmentIdStep, { id: 'aamva', type: 'aamva', source: 'government_id' }],
      { 'government-id': governmentIdConfig, aamva: typeConfig(DEFAULT_AAMVA_CHECKS) },
    ),
    `e2e-silent-aamva-${run}`,
  );
  const flow = flowApi(stack.apiUrl, sessionToken);
  await giveFlowConsent(flow);
  const governmentId = await submitGovernmentId(flow, {
    front: FIXTURES.idFront,
    back: FIXTURES.idBack,
  });
  expect((await settledFlowVerification(flow, governmentId)).attributes.status).toBe('passed');

  await expect.poll(() => inquiryStatus(inquiryId), { timeout: 30_000 }).toBe('completed');
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const document = await client.inquiries.retrieve(inquiryId, { include: 'verifications' });
  expect(
    (document.included ?? []).flatMap((included) =>
      included.type === 'decision' ? [] : [[included.type, included.attributes.status]],
    ),
  ).toEqual([
    ['verification/government-id', 'passed'],
    ['verification/aamva', 'skipped'],
  ]);
});

test('the AAMVA form with a number ending 0002 fails record_mismatch on the postal code (C59.4, C59.5)', async () => {
  const stack = readStackInfo();
  const run = randomUUID();
  const { inquiryId, sessionToken } = await startInquiry(
    stack,
    phase5Template(`e2e-aamva-form-${run}`, [{ id: 'licence', type: 'aamva', source: 'form' }], {
      aamva: typeConfig(DEFAULT_AAMVA_CHECKS),
    }),
    `e2e-aamva-form-${run}`,
  );
  const flow = flowApi(stack.apiUrl, sessionToken);
  await giveFlowConsent(flow);
  const phase5 = phase5Flow(stack, sessionToken);
  const verificationId = await phase5.create('aamva');
  await phase5.enterInputs(verificationId, {
    'name-first': 'Avery',
    'name-last': 'Example',
    birthdate: '1990-04-12',
    'identification-number': 'D1230002',
    'issuing-authority': 'CA',
    'address-postal-code': '90001',
  });
  await phase5.submit(verificationId);
  expect((await settledFlowVerification(flow, verificationId, 60_000)).attributes.status).toBe(
    'failed',
  );

  const { checks, attributes } = await serverVerification(verificationId);
  expect(checks.aamva_identity_comparison).toMatchObject({
    status: 'failed',
    requirement: 'required',
    reasons: ['record_mismatch'],
  });
  expect(attributes).toMatchObject({ source: 'form', 'identification-number': 'D1230002' });
  expect(JSON.stringify(checks)).not.toContain('D1230002');
  await expect.poll(() => inquiryStatus(inquiryId)).toBe('failed');
});
