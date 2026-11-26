/**
 * C66 in the console, full stack (Workflow 5C, `dashboard-records`): the evidence of the database,
 * AAMVA, business registry and business website verifications, read by a reviewer (who holds
 * `pii:view`) and a viewer (who does not). Each test creates its own inquiry on its own template,
 * enters synthetic values through the flow API as the hosted flow does, and lets the worker decide
 * them against the sandbox providers the e2e stack binds (C63):
 * - database, `sandbox-database-nickname`: each entered value beside its level, methods and
 *   flags, the group met, the sandbox source not authoritative (C58, C59);
 * - the AAMVA form, a number ending `0002`: the postal code differs on the issuer's record
 *   (C59.4);
 * - a business register, ending `7777` with a person entered, and `8888`: the register, its
 *   authority, record id and status with how it was read, and the person not on the register,
 *   an advisory failure (C61.2, C61.6, C61.7);
 * - `new.example`: a reserved name resolved by the sandbox rule, registered three days ago, an
 *   advisory domain age failure (C61.3, C61.4).
 * What the console says is compared with what the API recorded, read with the customer's key,
 * never with a copy of the console's own logic. Nothing here changes a setting.
 */
import {
  DEFAULT_AAMVA_CHECKS,
  DEFAULT_BUSINESS_WEBSITE_CHECKS,
  DEFAULT_DATABASE_BUSINESS_CHECKS,
  DEFAULT_DATABASE_CHECKS,
} from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { typeConfig } from './support/phase5.js';
import {
  consoleVerification,
  evidenceGroup,
  evidenceRow,
  evidenceTerm,
  recordsVerification,
  type ServedVerification,
} from './support/records.js';
import { signInAs } from './support/ui.js';

/** A match level as the console words it (C58.1). */
const LEVEL_WORDS: Readonly<Record<string, string>> = {
  full: 'Full match',
  partial: 'Partial match',
  none: 'No match',
  missing: 'Missing',
};

/** A match group's outcome as the console words it (C58.1). */
const OUTCOME_WORDS: Readonly<Record<string, string>> = {
  met: 'Met',
  unmet: 'Unmet',
  undecidable: 'Undecidable',
};

/** An invented person at an invented address, who types a nickname. */
const PERSON = {
  'name-first': 'Bob',
  'name-last': 'Quillanby',
  birthdate: '1984-07-09',
  'address-street-1': '12 Example Street',
  'address-city': 'Exampleton',
  'address-postal-code': '00000',
  'address-country-code': 'US',
};

/** A recorded value of a result's metadata, by path. */
function recorded(verification: ServedVerification, check: string, ...path: string[]): unknown {
  let value: unknown = verification.checks[check]?.metadata;
  for (const key of path) {
    value =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  return value;
}

const words = (table: Readonly<Record<string, string>>, value: unknown) =>
  table[String(value)] ?? String(value);

test('a reviewer reads a database verification beside each field’s level and the group, and a viewer sees the values hidden and the levels (C58, C59, C66)', async ({
  browser,
}) => {
  const verification = await recordsVerification({
    type: 'database',
    steps: [
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
    ],
    config: { database: typeConfig(DEFAULT_DATABASE_CHECKS) },
    token: 'sandbox-database-nickname',
    values: PERSON,
  });
  expect(verification.status).toBe('passed');
  const identity = 'database_identity_comparison';
  expect(recorded(verification, identity, 'authoritative')).toBe(false);
  expect(recorded(verification, identity, 'fields', 'name', 'level')).toBe('partial');
  expect(recorded(verification, identity, 'fields', 'name', 'methods')).toContain('nickname');

  const reviewer = await consoleVerification(browser, 'reviewer', verification);
  try {
    const evidence = evidenceGroup(reviewer.page, 'Database');
    await expect(evidence).toContainText('What a pass means');
    await expect(evidenceTerm(evidence, 'Source')).toContainText('sandbox');
    await expect(evidenceTerm(evidence, 'Source')).toContainText('Sandbox provider');
    await expect(evidenceTerm(evidence, 'Authoritative')).toHaveText(
      /^NoA miss from this source goes to review/,
    );
    const fields = evidence.getByRole('table', {
      name: 'Database values against the record',
      exact: true,
    });
    const name = evidenceRow(fields, 'Name');
    await expect(evidenceTerm(name, 'Name first')).toHaveText(PERSON['name-first']);
    await expect(evidenceTerm(name, 'Name last')).toHaveText(PERSON['name-last']);
    await expect(name).toContainText('Partial match');
    await expect(name).toContainText('Nickname');
    for (const [field, row] of [
      ['birthdate', 'Birth date'],
      ['address', 'Address'],
    ] as const) {
      await expect(evidenceRow(fields, row)).toContainText(
        words(LEVEL_WORDS, recorded(verification, identity, 'fields', field, 'level')),
      );
    }
    const groups = evidence.getByRole('table', { name: 'Database match groups', exact: true });
    await expect(evidenceRow(groups, 'Group 1')).toContainText(
      words(
        OUTCOME_WORDS,
        (recorded(verification, identity, 'groups') as { outcome: string }[])[0]?.outcome,
      ),
    );
    await expect(evidenceRow(groups, 'Group 1')).toContainText('Name: at least partial');

    // The inquiry's card shows the same evidence.
    const stack = readStackInfo();
    await reviewer.page.goto(`${stack.dashboardUrl}/inquiries/${verification.inquiryId}`);
    const card = reviewer.page.getByRole('region', { name: 'Database', exact: true });
    await expect(
      evidenceTerm(
        evidenceRow(
          evidenceGroup(reviewer.page, 'Database').getByRole('table', {
            name: 'Database values against the record',
            exact: true,
          }),
          'Name',
        ),
        'Name first',
      ),
    ).toHaveText(PERSON['name-first']);
    await expect(card.getByRole('group', { name: 'Database evidence', exact: true })).toBeVisible();
  } finally {
    await reviewer.close();
  }

  const viewer = await consoleVerification(browser, 'viewer', verification);
  try {
    const evidence = evidenceGroup(viewer.page, 'Database');
    const name = evidenceRow(
      evidence.getByRole('table', { name: 'Database values against the record', exact: true }),
      'Name',
    );
    await expect(
      evidenceTerm(name, 'Name first').getByText('Hidden', { exact: true }),
    ).toBeVisible();
    await expect(name).toContainText('Partial match');
    await expect(viewer.page.getByRole('main')).not.toContainText(PERSON['name-last']);
    await expect(viewer.page.getByRole('main')).not.toContainText(PERSON['address-street-1']);
  } finally {
    await viewer.close();
  }
});

test('a reviewer reads an AAMVA form verification: where the values came from and the field the issuer’s record differs on (0002) (C59.4, C59.5, C66)', async ({
  browser,
}) => {
  const verification = await recordsVerification({
    type: 'aamva',
    steps: [{ id: 'licence', type: 'aamva', source: 'form' }],
    config: { aamva: typeConfig(DEFAULT_AAMVA_CHECKS) },
    values: {
      'name-first': 'Avery',
      'name-last': 'Quillanby',
      birthdate: '1990-04-12',
      'identification-number': 'D1230002',
      'issuing-authority': 'CA',
      'address-postal-code': '90001',
    },
  });
  expect(verification.status).toBe('failed');
  expect(recorded(verification, 'aamva_identity_comparison', 'mismatched-fields')).toEqual([
    'address-postal-code',
  ]);

  const reviewer = await consoleVerification(browser, 'reviewer', verification);
  try {
    const evidence = evidenceGroup(reviewer.page, 'AAMVA');
    await expect(evidenceTerm(evidence, 'Values from')).toContainText('The AAMVA form');
    await expect(evidenceTerm(evidence, 'Provider')).toContainText('Sandbox provider');
    await expect(evidenceTerm(evidence, 'Identity')).toContainText('Issuer’s record differs');
    const table = evidence.getByRole('table', {
      name: 'AAMVA values against the issuer’s record',
      exact: true,
    });
    await expect(evidenceRow(table, 'Address postal code')).toContainText('90001');
    await expect(evidenceRow(table, 'Address postal code')).toContainText('Differs');
    await expect(evidenceRow(table, 'Name last')).toContainText('No difference reported');
    await expect(evidenceRow(table, 'Issue date')).toContainText('Not sent');
  } finally {
    await reviewer.close();
  }

  const viewer = await consoleVerification(browser, 'viewer', verification);
  try {
    const table = evidenceGroup(viewer.page, 'AAMVA').getByRole('table', {
      name: 'AAMVA values against the issuer’s record',
      exact: true,
    });
    await expect(
      evidenceRow(table, 'Identification number').getByText('Hidden', { exact: true }),
    ).toBeVisible();
    await expect(evidenceRow(table, 'Address postal code')).toContainText('Differs');
    await expect(viewer.page.getByRole('main')).not.toContainText('D1230002');
  } finally {
    await viewer.close();
  }
});

const BUSINESS_STEPS = [
  { id: 'business', type: 'database_business' as const, collectAssociatedPersons: true },
];
const BUSINESS_CONFIG = { 'database-business': typeConfig(DEFAULT_DATABASE_BUSINESS_CHECKS) };
const BUSINESS = 'Quillanby Lantern Works Ltd';

test('a reviewer reads a business register’s record, its status as read and a person not on it (7777), and a viewer sees the names hidden (C61, C66)', async ({
  browser,
}) => {
  const verification = await recordsVerification({
    type: 'database-business',
    steps: BUSINESS_STEPS,
    config: BUSINESS_CONFIG,
    values: {
      'business-name': BUSINESS,
      'country-code': 'GB',
      'registration-number': '12347777',
      'associated-persons': [
        { 'name-first': 'Ada', 'name-last': 'Placeholder', birthdate: '1980-04' },
      ],
    },
  });
  expect(verification.status).toBe('passed');
  const persons = 'database_business_associated_persons_comparison';
  expect(verification.checks[persons]).toMatchObject({
    status: 'failed',
    requirement: 'not_required',
    reasons: ['associated_person_not_on_register'],
  });
  const identity = 'database_business_identity_comparison';
  const { attributes } = verification;

  const reviewer = await consoleVerification(browser, 'reviewer', verification);
  try {
    const evidence = evidenceGroup(reviewer.page, 'Business registry');
    await expect(evidenceTerm(evidence, 'Register')).toContainText('Sandbox register');
    await expect(evidenceTerm(evidence, 'Register')).toContainText('Sandbox provider');
    await expect(evidenceTerm(evidence, 'Authoritative')).toHaveText(/^Yes/);
    await expect(evidenceTerm(evidence, 'Record ID')).toHaveText(
      String(attributes['registry-record-id']),
    );
    await expect(evidenceTerm(evidence, 'Legal name')).toHaveText(
      String(attributes['registry-legal-name']),
    );
    await expect(evidenceTerm(evidence, 'Status on the register')).toHaveText(
      String(attributes['registry-status']),
    );
    await expect(evidenceTerm(evidence, 'Status read as')).toHaveText(/^Active/);
    const fields = evidence.getByRole('table', {
      name: 'Business registry values against the register',
      exact: true,
    });
    await expect(evidenceRow(fields, 'Business name')).toContainText(BUSINESS);
    await expect(evidenceRow(fields, 'Business name')).toContainText(
      words(LEVEL_WORDS, recorded(verification, identity, 'fields', 'name', 'level')),
    );
    const groups = evidence.getByRole('table', {
      name: 'Business registry match groups',
      exact: true,
    });
    await expect(evidenceRow(groups, 'Group 1')).toContainText(
      words(
        OUTCOME_WORDS,
        (recorded(verification, identity, 'groups') as { outcome: string }[])[0]?.outcome,
      ),
    );
    const entered = evidenceTerm(evidence, 'Associated persons');
    await expect(entered).toContainText('Person not on the register');
    await expect(entered).toContainText('Advisory');
    await expect(entered).toContainText(
      `${String(recorded(verification, persons, 'persons'))} compared: ${String(recorded(verification, persons, 'matched'))} matched, ${String(recorded(verification, persons, 'unmatched'))} not on the register`,
    );
    await expect(entered).toContainText('Placeholder');
  } finally {
    await reviewer.close();
  }

  const viewer = await consoleVerification(browser, 'viewer', verification);
  try {
    const evidence = evidenceGroup(viewer.page, 'Business registry');
    await expect(
      evidenceTerm(evidence, 'Legal name').getByText('Hidden', { exact: true }),
    ).toBeVisible();
    await expect(evidenceTerm(evidence, 'Associated persons')).toContainText('Hidden');
    await expect(evidenceTerm(evidence, 'Record ID')).toHaveText(
      String(attributes['registry-record-id']),
    );
    await expect(viewer.page.getByRole('main')).not.toContainText(BUSINESS);
    await expect(viewer.page.getByRole('main')).not.toContainText('Placeholder');
  } finally {
    await viewer.close();
  }
});

test('a reviewer reads a dissolved business’s status as inactive, the active check failing (8888) (C61.2, C66)', async ({
  browser,
}) => {
  const verification = await recordsVerification({
    type: 'database-business',
    steps: BUSINESS_STEPS,
    config: BUSINESS_CONFIG,
    values: { 'business-name': BUSINESS, 'country-code': 'GB', 'registration-number': '12348888' },
  });
  expect(verification.status).toBe('failed');
  expect(verification.attributes['registry-status']).toBe('dissolved');

  const reviewer = await consoleVerification(browser, 'reviewer', verification);
  try {
    const evidence = evidenceGroup(reviewer.page, 'Business registry');
    await expect(evidenceTerm(evidence, 'Status on the register')).toHaveText('dissolved');
    await expect(evidenceTerm(evidence, 'Status read as')).toHaveText(/^Inactive/);
    await expect(evidenceTerm(evidence, 'Active business')).toContainText('Business not active');
  } finally {
    await reviewer.close();
  }
});

test('a reviewer reads a business website: a reserved name resolved by the sandbox rule, its registration day and an advisory age failure, and a viewer sees the URL hidden (C61.3, C61.4, C66)', async ({
  browser,
  page,
}) => {
  const verification = await recordsVerification({
    type: 'business-website',
    steps: [{ id: 'website', type: 'business_website' }],
    config: { 'business-website': typeConfig(DEFAULT_BUSINESS_WEBSITE_CHECKS) },
    values: { 'website-url': 'https://new.example/' },
  });
  expect(verification.status).toBe('passed');
  const age = 'business_website_domain_age_detection';
  expect(verification.checks[age]).toMatchObject({
    status: 'failed',
    requirement: 'not_required',
  });
  const registered = String(verification.attributes['domain-registered-at']).slice(0, 10);

  const reviewer = await consoleVerification(browser, 'reviewer', verification);
  try {
    const evidence = evidenceGroup(reviewer.page, 'Business website');
    await expect(evidenceTerm(evidence, 'Website address')).toHaveText('https://new.example/');
    await expect(evidenceTerm(evidence, 'Domain')).toHaveText('new.example');
    await expect(evidenceTerm(evidence, 'Resolution')).toContainText('Reserved name, sandbox rule');
    await expect(evidenceTerm(evidence, 'Registered on')).toHaveText(registered);
    const ageTerm = evidenceTerm(evidence, 'Domain age');
    await expect(ageTerm).toContainText('Domain registered recently');
    await expect(ageTerm).toContainText('Advisory');
    await expect(ageTerm).toContainText(
      `${String(recorded(verification, age, 'age-days'))} days old; the minimum is 90 days`,
    );
    await expect(ageTerm).toContainText('Sandbox provider');
    await expect(evidenceTerm(evidence, 'Malicious-website listings')).toHaveText(
      'Not checked: the template does not run this check',
    );
  } finally {
    await reviewer.close();
  }

  // The viewer, in the test's own page.
  const stack = readStackInfo();
  await signInAs(page, stack, 'viewer');
  await page.goto(`${stack.dashboardUrl}/verifications/${verification.id}`);
  const evidence = evidenceGroup(page, 'Business website');
  await expect(
    evidenceTerm(evidence, 'Website address').getByText('Hidden', { exact: true }),
  ).toBeVisible();
  await expect(evidenceTerm(evidence, 'Registered on')).toHaveText(registered);
  await expect(page.getByRole('main')).not.toContainText('new.example');
});
