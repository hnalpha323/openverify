/**
 * C58, C59, C66: the database evidence on its card and page: what a pass means; the source, its
 * authority and whether it is a sandbox; each entered value beside its field's level, methods and
 * flags; each match group's met, unmet or undecidable result; the inquiry comparison and the PO
 * box patterns. Values come from the verification answer alone, "Hidden" without `pii:view`,
 * "Redacted" after a redaction (C53.7).
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VerificationPage from '../../app/verifications/[id]/page';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  DATABASE_PII_VALUES,
  databaseChecks,
  databaseVerification,
  olderShapeDatabaseVerification,
  redactedDatabaseVerification,
} from '../../testing/fixtures/database';
import { phase5Verification } from '../../testing/phase5-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import { RECORDS_VIEWER, serveRecordsVerification } from '../../testing/routes/records';
import { DatabaseEvidence } from './database';
import type { EvidenceProps } from './generic';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

function show(
  verification: EvidenceProps['verification'] = databaseVerification(),
  state: EvidenceProps['state'] = 'visible',
) {
  return render(<DatabaseEvidence verification={verification} label="Database" state={state} />);
}

const group = () => screen.getByRole('group', { name: 'Database evidence' });
const fieldsTable = () =>
  within(group()).getByRole('table', { name: 'Database values against the record' });
const groupsTable = () => within(group()).getByRole('table', { name: 'Database match groups' });

/** The row a row header names, in `table`. */
function row(table: HTMLElement, name: string): HTMLElement {
  const found = within(table).getByRole('rowheader', { name }).closest('tr');
  if (found === null) throw new Error(`No row ${name}`);
  return found;
}

/** The `<dd>` beside a `<dt>` of `scope`. */
function term(scope: HTMLElement, name: string): HTMLElement {
  const dd = within(scope).getByText(name, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`No value for ${name}`);
  return dd;
}

describe('DatabaseEvidence (C59, C66)', () => {
  it('is a group named after the verification, saying what a pass means and what it does not', () => {
    show();

    expect(group()).toHaveTextContent(/What a pass means/);
    expect(group()).toHaveTextContent(/does not show that the person entering the values/);
  });

  it('names the source, says it is a sandbox, and what its authority means for a miss', () => {
    show();

    expect(term(group(), 'Source')).toHaveTextContent('sandbox');
    expect(term(group(), 'Source')).toHaveTextContent('Sandbox provider');
    expect(term(group(), 'Authoritative')).toHaveTextContent(
      /^NoA miss from this source goes to review, never to a failure\.$/,
    );
    expect(term(group(), 'Identity')).toHaveTextContent(/Passed.*Required/);
  });

  it('shows each entered value beside its field’s level, methods and flags', () => {
    show();

    const headers = within(fieldsTable())
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual(['Field', 'Entered', 'Match', 'Methods', 'Flags']);
    const name = row(fieldsTable(), 'Name');
    expect(term(name, 'Name first')).toHaveTextContent(/^Bob$/);
    expect(term(name, 'Name middle')).toHaveTextContent('None');
    expect(term(name, 'Name last')).toHaveTextContent(/^Quillon$/);
    expect(name).toHaveTextContent('Partial match');
    expect(name).toHaveTextContent('Nickname');
    expect(row(fieldsTable(), 'Birth date')).toHaveTextContent('Full match');
    const address = row(fieldsTable(), 'Address');
    expect(term(address, 'Address street 1')).toHaveTextContent('12 Example Street');
    const components = within(address).getByRole('list', { name: 'Address components' });
    expect(
      within(components)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Country: same',
      'Postal code: same',
      'House number: same',
      'Street: same',
      'Unit: on neither side',
      'City: same',
      'State or region: on neither side',
    ]);
    expect(row(fieldsTable(), 'Phone number')).toHaveTextContent('Missing');
    expect(row(fieldsTable(), 'Phone number')).toHaveTextContent(/never a mismatch/);
  });

  it('keeps the API member names as the terms of the entered values (the shared card test reads them)', () => {
    show();

    expect(within(group()).getByText('Name first').nextElementSibling).toHaveTextContent('Bob');
  });

  it('shows each flag in words, and a flag it does not know as its code', () => {
    const [identity, ...rest] = databaseChecks();
    if (identity === undefined) throw new Error('no identity result');
    const fields = identity.metadata.fields as Record<string, unknown>;
    show(
      databaseVerification({
        checks: [
          {
            ...identity,
            metadata: {
              ...identity.metadata,
              fields: {
                ...fields,
                name: { level: 'partial', methods: ['nickname'], flags: ['swapped', 'new-flag'] },
              },
            },
          },
          ...rest,
        ],
      }),
    );

    const flags = within(row(fieldsTable(), 'Name')).getByRole('list', { name: 'Name flags' });
    expect(flags).toHaveTextContent('Given and family names swapped');
    expect(flags).toHaveTextContent('new-flag');
  });

  it('shows each match group with the level each field needs and its result', () => {
    show();

    const first = row(groupsTable(), 'Group 1');
    expect(first).toHaveTextContent('Name: at least partial');
    expect(first).toHaveTextContent('Birth date: at least partial');
    expect(first).toHaveTextContent('Address: at least partial');
    expect(first).toHaveTextContent('Met');
    expect(group()).toHaveTextContent(
      /passes when any group is met, fails only when every group is unmet/,
    );
  });

  it.each([
    ['name-mismatch', 'Unmet', 'No match'],
    ['no-birthdate', 'Undecidable', 'Partial match'],
  ] as const)('shows a %s record’s group as %s', (scenario, outcome, nameLevel) => {
    show(databaseVerification({ scenario }));

    expect(row(groupsTable(), 'Group 1')).toHaveTextContent(outcome);
    expect(row(fieldsTable(), 'Name')).toHaveTextContent(nameLevel);
  });

  it('says an undecidable group goes to review, and names the group fields the step did not collect', () => {
    const [identity, ...rest] = databaseChecks('no-birthdate');
    if (identity === undefined) throw new Error('no identity result');
    show(
      databaseVerification({
        checks: [
          {
            ...identity,
            metadata: { ...identity.metadata, 'not-requested-fields': ['birthdate'] },
          },
          ...rest,
        ],
      }),
    );

    expect(row(groupsTable(), 'Group 1')).toHaveTextContent(/review/);
    expect(term(group(), 'Not collected by the step')).toHaveTextContent(/^Birth date$/);
  });

  it('says the record was not found, and compares nothing', () => {
    show(databaseVerification({ scenario: 'not-found' }));

    expect(term(group(), 'Identity')).toHaveTextContent(/Not applicable.*Required/);
    expect(term(group(), 'Identity')).toHaveTextContent('No matching record');
    expect(row(fieldsTable(), 'Name')).toHaveTextContent('No record to compare');
    expect(row(groupsTable(), 'Group 1')).toHaveTextContent('Not recorded');
  });

  it('reads the golden fixture through the identity check’s comparisons and groups (Workflow 5C review P008)', () => {
    show(phase5Verification('verification/database'));

    expect(row(fieldsTable(), 'Name')).toHaveTextContent('Full match');
    expect(row(fieldsTable(), 'Address')).toHaveTextContent('Full match');
    expect(row(groupsTable(), 'Group 1')).toHaveTextContent('Met');
  });

  it('reads an older shape through the per-field results and the template’s groups', () => {
    show(olderShapeDatabaseVerification());

    expect(row(fieldsTable(), 'Name')).toHaveTextContent('Full match');
    expect(row(fieldsTable(), 'Address')).toHaveTextContent('Partial match');
    expect(row(fieldsTable(), 'Identification number')).toHaveTextContent('Not recorded');
    expect(row(groupsTable(), 'Group 1')).toHaveTextContent('Not recorded');
  });

  it('shows the inquiry comparison and the PO box patterns', () => {
    const checks = databaseChecks().map((result) =>
      result.name === 'database_inquiry_comparison'
        ? {
            ...result,
            status: 'failed' as const,
            reasons: ['inquiry_field_mismatch'],
            metadata: {
              'compared-fields': ['name', 'birthdate'],
              'mismatched-fields': ['birthdate'],
              'not-requested-fields': [],
              fields: {
                name: { level: 'full', methods: [], flags: [] },
                birthdate: { level: 'none', methods: [], flags: ['near-match'] },
              },
            },
          }
        : result.name === 'database_po_box_detection'
          ? {
              ...result,
              status: 'failed' as const,
              reasons: ['po_box_detected'],
              metadata: { 'matched-patterns': ['po_box'] },
            }
          : result,
    );
    show(databaseVerification({ checks }));

    const inquiry = term(group(), 'Inquiry comparison');
    expect(inquiry).toHaveTextContent(/Failed.*Advisory/);
    expect(inquiry).toHaveTextContent('Name: full match');
    expect(inquiry).toHaveTextContent('Birth date: no match');
    expect(term(group(), 'PO box')).toHaveTextContent('Post office box');
  });

  it.each(['visible', 'hidden'] as const)(
    'says beside each compared field where its value came from, field names only, %s (C149.4; K9-16)',
    (state) => {
      const checks = databaseChecks().map((result) =>
        result.name === 'database_inquiry_comparison'
          ? {
              ...result,
              metadata: {
                'compared-fields': ['name', 'birthdate'],
                'mismatched-fields': [],
                'not-requested-fields': [],
                fields: {
                  name: { level: 'full', methods: [], flags: [] },
                  birthdate: { level: 'full', methods: [], flags: [] },
                },
                'comparison-source': { name: 'initial', birthdate: 'entered' },
              },
            }
          : result,
      );
      show(databaseVerification({ checks }), state);

      const fields = within(term(group(), 'Inquiry comparison')).getByRole('list', {
        name: 'Inquiry comparison fields',
      });
      expect(within(fields).getByText(/^Name:/u)).toHaveTextContent(
        'Name: full match, compared with the value set when the inquiry was created, which the person could not change',
      );
      expect(within(fields).getByText(/^Birth date:/u)).toHaveTextContent(
        'Birth date: full match, compared with a value entered after the inquiry was created, by the person or through the API',
      );
    },
  );

  it('says the source is not recorded when the check recorded none, never naming one (C149.4; K9-16)', () => {
    const checks = databaseChecks().map((result) =>
      result.name === 'database_inquiry_comparison'
        ? {
            ...result,
            metadata: {
              'compared-fields': ['name'],
              'mismatched-fields': [],
              'not-requested-fields': [],
              fields: { name: { level: 'full', methods: [], flags: [] } },
              'comparison-source': { name: 'typed-by-someone' },
            },
          }
        : result,
    );
    show(databaseVerification({ checks }));

    expect(term(group(), 'Inquiry comparison')).toHaveTextContent(
      'Name: full match, where the compared value came from is not recorded',
    );
  });

  it('says what the inquiry comparison and the PO box check answered when they compared nothing', () => {
    show();

    expect(term(group(), 'Inquiry comparison')).toHaveTextContent('Nothing to compare with');
    expect(term(group(), 'PO box')).toHaveTextContent('No PO box pattern matched');
  });

  it('says nothing was compared before the checks ran', () => {
    show(databaseVerification({ checks: [], status: 'initiated' }));

    expect(row(fieldsTable(), 'Name')).toHaveTextContent('Not compared yet');
    expect(within(groupsTable()).getByText('No group recorded yet.')).toBeVisible();
    expect(term(group(), 'Source')).toHaveTextContent('Not recorded');
  });

  it('shows the values the API masked as "Hidden", and the levels it did not mask', () => {
    show(databaseVerification({ masked: true }), 'hidden');

    const name = row(fieldsTable(), 'Name');
    expect(within(term(name, 'Name first')).getByText('Hidden')).toHaveAccessibleDescription(
      'Your role cannot see personal data (the pii:view permission).',
    );
    expect(name).toHaveTextContent('Partial match');
    for (const value of DATABASE_PII_VALUES) {
      expect(group()).not.toHaveTextContent(value);
    }
  });

  it('shows "Redacted" for the values and the comparisons a redaction removed', () => {
    show(redactedDatabaseVerification(), 'redacted');

    const name = row(fieldsTable(), 'Name');
    expect(term(name, 'Name first')).toHaveTextContent(/^Redacted$/);
    expect(within(name).getAllByText('Redacted').length).toBeGreaterThanOrEqual(2);
  });

  it('shows another type’s verification through the generic view', () => {
    render(
      <DatabaseEvidence
        verification={phase5Verification('verification/aamva')}
        label="Database"
        state="visible"
      />,
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Issuing authority', { selector: 'dt' })).toBeVisible();
  });
});

describe('DatabaseEvidence with what the console has no words for (C66)', () => {
  it('shows a method, component, group field, reason or PO box pattern it does not know as its code', () => {
    const [identity, ...rest] = databaseChecks();
    if (identity === undefined) throw new Error('no identity result');
    const fields = identity.metadata.fields as Record<string, unknown>;
    const checks = [
      {
        ...identity,
        status: 'not_applicable' as const,
        reasons: ['a_future_reason'],
        metadata: {
          ...identity.metadata,
          fields: {
            ...fields,
            address: {
              level: 'partial',
              methods: ['a_future_method'],
              flags: [],
              components: { 'a-future-part': 'a-future-match' },
            },
          },
          groups: [{ fields: { 'a-future-field': 'partial' }, outcome: 'undecidable' }],
        },
      },
      ...rest.map((result) =>
        result.name === 'database_po_box_detection'
          ? {
              ...result,
              status: 'failed' as const,
              reasons: ['po_box_detected'],
              metadata: { 'matched-patterns': ['a_future_pattern'] },
            }
          : result,
      ),
    ];
    show(databaseVerification({ checks }));

    const address = row(fieldsTable(), 'Address');
    expect(address).toHaveTextContent('a_future_method');
    expect(within(address).getByRole('list', { name: 'Address components' })).toHaveTextContent(
      'a-future-part: a-future-match',
    );
    expect(term(group(), 'Identity')).toHaveTextContent('a_future_reason');
    expect(row(groupsTable(), 'Group 1')).toHaveTextContent('a-future-field: at least partial');
    expect(term(group(), 'PO box')).toHaveTextContent('a_future_pattern');
  });

  it('says a field was not compared when the identity asked no source, and when the template runs no identity check', () => {
    const [identity, ...rest] = databaseChecks();
    if (identity === undefined) throw new Error('no identity result');
    const { unmount } = show(
      databaseVerification({
        checks: [
          {
            ...identity,
            status: 'not_applicable',
            reasons: ['provider_not_configured'],
            metadata: {},
          },
          ...rest.filter(
            (result) => !result.name.endsWith('_comparison') || result.name.includes('inquiry'),
          ),
        ],
      }),
    );
    expect(row(fieldsTable(), 'Name')).toHaveTextContent('Not compared');
    unmount();

    show(databaseVerification({ checks: rest }));
    expect(term(group(), 'Identity')).toHaveTextContent('Not run by this template');
    expect(within(groupsTable()).getByText('No group recorded.')).toBeVisible();
  });

  it('says what the PO box check answered when the step collects no street', () => {
    const checks = databaseChecks().map((result) =>
      result.name === 'database_po_box_detection'
        ? { ...result, status: 'not_applicable' as const, reasons: ['not_requested'], metadata: {} }
        : result,
    );
    show(databaseVerification({ checks }));

    const poBox = term(group(), 'PO box');
    expect(poBox).toHaveTextContent('Not collected by the step');
    expect(poBox).not.toHaveTextContent('No PO box pattern matched');
  });
});

describe('the database evidence on its page (C26, C53.7, C66)', () => {
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

  it('shows the evidence in the page’s Evidence region', async () => {
    const verification = databaseVerification();
    serveRecordsVerification(api, verification);

    render(await page(verification.id));

    const evidence = screen.getByRole('region', { name: 'Evidence' });
    expect(within(evidence).getByRole('group', { name: 'Database evidence' })).toBeVisible();
    expect(
      within(evidence).getByRole('table', { name: 'Database values against the record' }),
    ).toHaveTextContent('Quillon');
  });

  it('lets no value the API masked reach the page or the RSC payload from another source', async () => {
    serveRecordsVerification(api, databaseVerification({ masked: true }), {
      seen: databaseVerification(),
      permissions: RECORDS_VIEWER,
    });

    const element = await page(databaseVerification().id);
    const payload = await rscPayloadOf(element);
    render(element);

    expect(
      screen.getByRole('table', { name: 'Database values against the record' }),
    ).toHaveTextContent('Hidden');
    for (const value of DATABASE_PII_VALUES) {
      expect(document.body.textContent).not.toContain(value);
      expect(payload).not.toContain(value);
    }
  });

  it('puts the values in the payload for an operator the API shows them to (the check above can fail)', async () => {
    serveRecordsVerification(api, databaseVerification());

    const payload = await rscPayloadOf(await page(databaseVerification().id));

    for (const value of DATABASE_PII_VALUES) {
      expect(payload).toContain(value);
    }
  });

  it('shows "Redacted" once the inquiry was redacted', async () => {
    serveRecordsVerification(api, redactedDatabaseVerification(), { redacted: true });

    render(await page(redactedDatabaseVerification().id));

    const name = row(
      screen.getByRole('table', { name: 'Database values against the record' }),
      'Name',
    );
    expect(term(name, 'Name first')).toHaveTextContent(/^Redacted$/);
  });
});
