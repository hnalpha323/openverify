/**
 * C61, C66: the business registry evidence on its card and page: what a pass means; the register,
 * labelled sandbox, with its authority, the record id, the legal name and the status with how it
 * was read; the entered business beside each match field's level, methods and flags; each match
 * group's result; the associated persons' results; the country and service checks. Personal
 * values come from the verification answer alone, "Hidden" without `pii:view`, "Redacted" after a
 * redaction (C53.7).
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VerificationPage from '../../app/verifications/[id]/page';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  ASSOCIATED_PERSON,
  BUSINESS_PII_VALUES,
  businessChecks,
  businessVerification,
  redactedBusinessVerification,
} from '../../testing/fixtures/database-business';
import { phase5Verification } from '../../testing/phase5-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import { RECORDS_VIEWER, serveRecordsVerification } from '../../testing/routes/records';
import { DatabaseBusinessEvidence } from './database-business';
import type { EvidenceProps } from './generic';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const LABEL = 'Business registry';

function show(
  verification: EvidenceProps['verification'] = businessVerification(),
  state: EvidenceProps['state'] = 'visible',
) {
  return render(
    <DatabaseBusinessEvidence verification={verification} label={LABEL} state={state} />,
  );
}

const group = () => screen.getByRole('group', { name: `${LABEL} evidence` });
const fieldsTable = () =>
  within(group()).getByRole('table', { name: `${LABEL} values against the register` });
const groupsTable = () => within(group()).getByRole('table', { name: `${LABEL} match groups` });

function row(table: HTMLElement, name: string): HTMLElement {
  const found = within(table).getByRole('rowheader', { name }).closest('tr');
  if (found === null) throw new Error(`No row ${name}`);
  return found;
}

function term(scope: HTMLElement, name: string): HTMLElement {
  const dd = within(scope).getByText(name, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`No value for ${name}`);
  return dd;
}

describe('DatabaseBusinessEvidence (C61, C66)', () => {
  it('is a group named after the verification, saying what a pass means and what it does not', () => {
    show();

    expect(group()).toHaveTextContent(/What a pass means/);
    expect(group()).toHaveTextContent(/does not mean the user acts for that business/);
  });

  it('names the register, labelled sandbox, its authority, the record and its status as read', () => {
    show();

    expect(term(group(), 'Register')).toHaveTextContent('Sandbox register');
    expect(term(group(), 'Register')).toHaveTextContent('Sandbox provider');
    expect(term(group(), 'Authoritative')).toHaveTextContent(/^Yes/);
    expect(term(group(), 'Record ID')).toHaveTextContent(/^01234567$/);
    expect(term(group(), 'Legal name')).toHaveTextContent(/^Quillon Lantern Works Ltd$/);
    expect(term(group(), 'Status on the register')).toHaveTextContent(/^active$/);
    expect(term(group(), 'Status read as')).toHaveTextContent(/^Active/);
    expect(term(group(), 'Identity')).toHaveTextContent(/Passed.*Required/);
    expect(term(group(), 'Active business')).toHaveTextContent(/Passed.*Required/);
  });

  it('shows the entered business beside each field’s level, methods and flags', () => {
    show();

    const name = row(fieldsTable(), 'Business name');
    expect(term(name, 'Business name')).toHaveTextContent('Quillon Lantern Works Ltd');
    expect(name).toHaveTextContent('Full match');
    expect(name).toHaveTextContent('Case and accents folded');
    expect(
      term(row(fieldsTable(), 'Registration number'), 'Registration number'),
    ).toHaveTextContent('01234567');
    const address = row(fieldsTable(), 'Registered address');
    expect(term(address, 'Address postal code')).toHaveTextContent('ZZ1 1ZZ');
    expect(
      within(address).getByRole('list', { name: 'Registered address components' }),
    ).toHaveTextContent('Street: same');
    expect(term(group(), 'LEI')).toHaveTextContent('None');
  });

  it('shows each match group with the level each field needs and its result', () => {
    show();

    const first = row(groupsTable(), 'Group 1');
    expect(first).toHaveTextContent('Business name: at least partial');
    expect(first).toHaveTextContent('Registration number: full');
    expect(first).toHaveTextContent('Met');
    expect(row(groupsTable(), 'Group 2')).toHaveTextContent('Registered address: at least partial');
  });

  it('shows another business’s record as unmet (0000)', () => {
    show(businessVerification({ scenario: 'other-business' }));

    expect(row(groupsTable(), 'Group 1')).toHaveTextContent('Unmet');
    expect(row(fieldsTable(), 'Business name')).toHaveTextContent('No match');
    expect(term(group(), 'Legal name')).toHaveTextContent('Marrowstone Placeholder Holdings');
    expect(term(group(), 'Identity')).toHaveTextContent('Register’s record does not match');
  });

  it('shows a dissolved business read as inactive (8888)', () => {
    show(businessVerification({ scenario: 'dissolved' }));

    expect(term(group(), 'Status on the register')).toHaveTextContent(/^dissolved$/);
    expect(term(group(), 'Status read as')).toHaveTextContent(/^Inactive/);
    expect(term(group(), 'Active business')).toHaveTextContent(
      /Failed.*Required.*Business not active/,
    );
  });

  it('shows a lapsed LEI from GLEIF as not available, flagged, from a register that is no sandbox and not authoritative', () => {
    show(businessVerification({ scenario: 'lapsed-lei' }));

    expect(term(group(), 'Register')).toHaveTextContent('GLEIF');
    expect(term(group(), 'Register')).not.toHaveTextContent('Sandbox');
    expect(term(group(), 'Authoritative')).toHaveTextContent(/^No/);
    expect(term(group(), 'Status on the register')).toHaveTextContent(/^LAPSED$/);
    const read = term(group(), 'Status read as');
    expect(read).toHaveTextContent(/^Not available/);
    expect(within(read).getByRole('list', { name: 'Status flags' })).toHaveTextContent(
      'LEI lapsed',
    );
    expect(term(group(), 'LEI')).toHaveTextContent('ZZZZ00SYNTHETIC00LEI');
  });

  it('says a number the register lacks goes to review, and compares nothing (9999)', () => {
    show(businessVerification({ scenario: 'number-not-found' }));

    expect(term(group(), 'Identity')).toHaveTextContent(
      /Not applicable.*Required.*Number not on the register/,
    );
    expect(term(group(), 'Record ID')).toHaveTextContent('None');
    expect(row(fieldsTable(), 'Business name')).toHaveTextContent('No record to compare');
    expect(row(groupsTable(), 'Group 1')).toHaveTextContent('Not recorded');
  });

  it('shows the persons entered and how many the register lists, as an advisory result (7777)', () => {
    show(businessVerification({ scenario: 'person-not-listed' }));

    const persons = term(group(), 'Associated persons');
    expect(persons).toHaveTextContent(/Failed.*Advisory.*Person not on the register/);
    const entered = within(persons).getByRole('list', { name: 'Associated persons entered' });
    expect(within(entered).getAllByRole('listitem')).toHaveLength(1);
    expect(term(entered, 'Name last')).toHaveTextContent('Placeholder');
    expect(term(entered, 'Birthdate')).toHaveTextContent('1980-04');
    expect(persons).toHaveTextContent(
      '1 compared: 0 matched, 1 not on the register, 0 could not be compared',
    );
    expect(persons).toHaveTextContent(/significant control/);
  });

  it('says when the step does not collect persons', () => {
    show();

    expect(term(group(), 'Associated persons')).toHaveTextContent(
      'Persons not collected by the step',
    );
  });

  it('shows the country and register availability checks', () => {
    show();

    expect(term(group(), 'Country allowed')).toHaveTextContent(
      /Not applicable.*Required.*No country allowlist set/,
    );
    expect(term(group(), 'Register available')).toHaveTextContent(/Passed.*Required/);
  });

  it('says nothing was compared before the checks ran', () => {
    // Before the job, no register record exists, so the API serves none of its members.
    show(
      businessVerification({
        checks: [],
        status: 'initiated',
        values: {
          'registry-record-id': null,
          'registry-legal-name': null,
          'registry-source': null,
          'registry-status': null,
        },
      }),
    );

    expect(row(fieldsTable(), 'Business name')).toHaveTextContent('Not compared yet');
    expect(term(group(), 'Register')).toHaveTextContent('Not recorded');
    expect(term(group(), 'Status read as')).toHaveTextContent('Not recorded');
  });

  it('shows the personal values the API masked as "Hidden", and the record id and status it did not mask', () => {
    show(businessVerification({ scenario: 'person-not-listed', masked: true }), 'hidden');

    expect(within(term(group(), 'Legal name')).getByText('Hidden')).toHaveAccessibleDescription(
      'Your role cannot see personal data (the pii:view permission).',
    );
    expect(term(row(fieldsTable(), 'Business name'), 'Business name')).toHaveTextContent('Hidden');
    expect(term(group(), 'Associated persons')).toHaveTextContent('Hidden');
    expect(term(group(), 'Record ID')).toHaveTextContent('01234567');
    for (const value of BUSINESS_PII_VALUES) {
      expect(group()).not.toHaveTextContent(value);
    }
  });

  it('shows "Redacted" for the values and the comparisons a redaction removed', () => {
    show(redactedBusinessVerification(), 'redacted');

    expect(term(group(), 'Legal name')).toHaveTextContent(/^Redacted$/);
    expect(term(group(), 'Associated persons')).toHaveTextContent('Redacted');
    expect(within(row(fieldsTable(), 'Business name')).getAllByText('Redacted')).toHaveLength(2);
  });

  it('shows another type’s verification through the generic view', () => {
    render(
      <DatabaseBusinessEvidence
        verification={phase5Verification('verification/database')}
        label={LABEL}
        state="visible"
      />,
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('DatabaseBusinessEvidence with what the console has no words for (C66)', () => {
  it('shows a flag, method, component, group field or reason it does not know as its code', () => {
    const checks = businessChecks().map((check) => {
      if (check.name === 'database_business_identity_comparison') {
        const fields = check.metadata.fields as Record<string, unknown>;
        return {
          ...check,
          reasons: ['a_future_reason'],
          metadata: {
            ...check.metadata,
            fields: {
              ...fields,
              name: {
                level: 'partial',
                methods: ['a_future_method'],
                flags: ['legal-form-mismatch', 'a-future-flag'],
              },
              address: {
                level: 'partial',
                methods: [],
                flags: [],
                components: { 'a-future-part': 'a-future-match' },
              },
            },
            groups: [{ fields: { 'a-future-field': 'full' }, outcome: 'met' }],
          },
        };
      }
      return check.name === 'database_business_active_business_detection'
        ? { ...check, metadata: { ...check.metadata, flags: ['a-future-status-flag'] } }
        : check;
    });
    show(businessVerification({ checks }));

    const name = row(fieldsTable(), 'Business name');
    expect(name).toHaveTextContent('a_future_method');
    const flags = within(name).getByRole('list', { name: 'Business name flags' });
    expect(flags).toHaveTextContent('Legal forms differ');
    expect(flags).toHaveTextContent('a-future-flag');
    expect(row(fieldsTable(), 'Registered address')).toHaveTextContent(
      'a-future-part: a-future-match',
    );
    expect(row(groupsTable(), 'Group 1')).toHaveTextContent('a-future-field: full');
    expect(term(group(), 'Identity')).toHaveTextContent('a_future_reason');
    expect(term(group(), 'Status read as')).toHaveTextContent('a-future-status-flag');
  });

  it('says a field was not compared when no register was bound, and the register by its provider when the API names none', () => {
    const checks = businessChecks().map((check) =>
      check.name === 'database_business_identity_comparison'
        ? {
            ...check,
            status: 'not_applicable' as const,
            reasons: ['provider_not_configured'],
            metadata: {},
          }
        : check,
    );
    show(businessVerification({ checks, values: { 'registry-source': null } }));

    expect(row(fieldsTable(), 'Business name')).toHaveTextContent('Not compared');
    expect(term(group(), 'Register')).toHaveTextContent(/^sandboxSandbox provider$/);
  });

  it('says when no person was entered, and shows a member a person left out as missing', () => {
    const { unmount } = show(businessVerification({ values: { 'associated-persons': [] } }));
    expect(term(group(), 'Associated persons')).toHaveTextContent('None entered');
    unmount();

    show(
      businessVerification({
        scenario: 'person-not-listed',
        values: {
          'associated-persons': [
            { 'name-first': ASSOCIATED_PERSON['name-first'], 'name-last': 'Placeholder' },
          ],
        },
      }),
    );
    const entered = within(term(group(), 'Associated persons')).getByRole('list', {
      name: 'Associated persons entered',
    });
    expect(term(entered, 'Birthdate')).toHaveTextContent('None');
  });

  it('says a register check with no result has none', () => {
    show(
      businessVerification({
        checks: businessChecks().filter(
          (check) => check.name !== 'database_business_enabled_country_detection',
        ),
      }),
    );

    expect(term(group(), 'Country allowed')).toHaveTextContent('No result');
  });
});

describe('the business registry evidence on its page (C26, C53.7, C66)', () => {
  let api: RouteApi;

  beforeEach(() => {
    fakeRequest.reset();
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api = routeApi();
  });

  afterEach(() => {
    api.restore();
  });

  const page = (id: string) => VerificationPage({ params: Promise.resolve({ id }) });

  it('lets no value the API masked reach the page or the RSC payload from another source', async () => {
    const scenario = 'person-not-listed';
    serveRecordsVerification(api, businessVerification({ scenario, masked: true }), {
      seen: businessVerification({ scenario }),
      permissions: RECORDS_VIEWER,
    });

    const element = await page(businessVerification().id);
    const payload = await rscPayloadOf(element);
    render(element);

    expect(screen.getByRole('group', { name: `${LABEL} evidence` })).toHaveTextContent('Hidden');
    for (const value of BUSINESS_PII_VALUES) {
      expect(document.body.textContent).not.toContain(value);
      expect(payload).not.toContain(value);
    }
  });

  it('puts the values in the payload for an operator the API shows them to (the check above can fail)', async () => {
    serveRecordsVerification(api, businessVerification({ scenario: 'person-not-listed' }));

    const payload = await rscPayloadOf(await page(businessVerification().id));

    for (const value of BUSINESS_PII_VALUES) {
      expect(payload).toContain(value);
    }
  });
});
