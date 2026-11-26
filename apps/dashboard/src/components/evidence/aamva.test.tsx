/**
 * C59.4–C59.6, C66: the AAMVA evidence on its card and page: what a pass means; where the values
 * came from (the AAMVA form, or the inquiry's government ID copied by the server); the provider,
 * labelled sandbox; each value beside the issuer's answer for it; the ignored fields; what the
 * template does when the jurisdiction does not take part. Values come from the verification answer
 * alone, "Hidden" without `pii:view`, "Redacted" after a redaction (C53.7).
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VerificationPage from '../../app/verifications/[id]/page';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  AAMVA_PII_VALUES,
  aamvaChecks,
  aamvaVerification,
  redactedAamvaVerification,
} from '../../testing/fixtures/aamva';
import { phase5Verification } from '../../testing/phase5-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import { RECORDS_VIEWER, serveRecordsVerification } from '../../testing/routes/records';
import { AamvaEvidence } from './aamva';
import type { EvidenceProps } from './generic';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const TABLE = 'AAMVA values against the issuer’s record';

function show(
  verification: EvidenceProps['verification'] = aamvaVerification(),
  state: EvidenceProps['state'] = 'visible',
) {
  return render(<AamvaEvidence verification={verification} label="AAMVA" state={state} />);
}

const group = () => screen.getByRole('group', { name: 'AAMVA evidence' });
const table = () => within(group()).getByRole('table', { name: TABLE });

function row(name: string): HTMLElement {
  const found = within(table()).getByRole('rowheader', { name }).closest('tr');
  if (found === null) throw new Error(`No row ${name}`);
  return found;
}

function term(scope: HTMLElement, name: string): HTMLElement {
  const dd = within(scope).getByText(name, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`No value for ${name}`);
  return dd;
}

describe('AamvaEvidence (C59, C66)', () => {
  it('is a group named after the verification, saying what a pass means and what it does not', () => {
    show();

    expect(group()).toHaveTextContent(/What a pass means/);
    expect(group()).toHaveTextContent(/does not show that the card is in the user's hands/);
  });

  it('says the values were entered in the AAMVA form, and names the sandbox provider', () => {
    show();

    expect(term(group(), 'Values from')).toHaveTextContent('The AAMVA form');
    expect(term(group(), 'Provider')).toHaveTextContent('sandbox');
    expect(term(group(), 'Provider')).toHaveTextContent('Sandbox provider');
    expect(term(group(), 'Identity')).toHaveTextContent(/Passed.*Required/);
  });

  it('says a silent attempt’s values were copied from the inquiry’s government ID, which the API does not name', () => {
    show(aamvaVerification({ source: 'government_id' }));

    expect(term(group(), 'Values from')).toHaveTextContent('The inquiry’s government ID');
    expect(term(group(), 'Values from')).toHaveTextContent(/does not name/);
  });

  it('shows each value beside the issuer’s answer, the differing field named (0002)', () => {
    show(aamvaVerification({ scenario: 'postal-code' }));

    const headers = within(table())
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual(['Field', 'Value', 'Issuer’s record']);
    expect(row('Name first')).toHaveTextContent(/^Name firstRowanNo difference reported$/);
    expect(row('Address postal code')).toHaveTextContent('90001');
    expect(row('Address postal code')).toHaveTextContent('Differs');
    expect(row('Issuing authority')).toHaveTextContent('Picks the jurisdiction asked');
    expect(term(group(), 'Identity')).toHaveTextContent('Issuer’s record differs');
  });

  it('shows a difference the template ignores, and the ignored fields', () => {
    show(aamvaVerification({ scenario: 'ignored' }));

    expect(row('Address postal code')).toHaveTextContent('Differs, ignored');
    expect(term(group(), 'Ignored fields')).toHaveTextContent(/^Address postal code$/);
  });

  it('says no ignored field, and what happens when the jurisdiction does not take part', () => {
    show();

    expect(term(group(), 'Ignored fields')).toHaveTextContent('None');
    expect(term(group(), 'If the jurisdiction does not take part')).toHaveTextContent(
      'Send to review',
    );
  });

  it.each([
    ['not-found', 'No record'],
    ['not-participating', 'Not compared'],
    ['no-field-list', 'Not recorded'],
  ] as const)('says %s for each compared field: %s', (scenario, answer) => {
    show(aamvaVerification({ scenario }));

    expect(row('Name last')).toHaveTextContent(answer);
    expect(row('Name last')).not.toHaveTextContent('No difference reported');
  });

  it('says a silent attempt is always skipped when the jurisdiction does not take part (the golden fixture)', () => {
    show(phase5Verification('verification/aamva'));

    expect(term(group(), 'If the jurisdiction does not take part')).toHaveTextContent(
      'Skip the step',
    );
    expect(row('Birthdate')).toHaveTextContent('Not compared');
  });

  it('says nothing was compared before the checks ran, or ever for a skipped attempt', () => {
    const { unmount } = show(aamvaVerification({ checks: [], status: 'initiated', source: null }));
    expect(row('Name first')).toHaveTextContent('Not compared yet');
    expect(term(group(), 'Values from')).toHaveTextContent('Not recorded yet');
    expect(term(group(), 'Provider')).toHaveTextContent('Not recorded');
    unmount();

    show(aamvaVerification({ checks: [], status: 'skipped', source: 'government_id' }));
    expect(row('Name first')).toHaveTextContent('Skipped, not compared');
  });

  it('says a value that was not entered was not sent', () => {
    show(aamvaVerification({ values: { 'issue-date': null } }));

    expect(row('Issue date')).toHaveTextContent('Not sent');
  });

  it('shows the values the API masked as "Hidden", and the answers it did not mask', () => {
    show(aamvaVerification({ scenario: 'postal-code', masked: true }), 'hidden');

    expect(within(row('Name first')).getByText('Hidden')).toHaveAccessibleDescription(
      'Your role cannot see personal data (the pii:view permission).',
    );
    expect(row('Address postal code')).toHaveTextContent('Differs');
    for (const value of AAMVA_PII_VALUES) {
      expect(group()).not.toHaveTextContent(value);
    }
  });

  it('shows "Redacted" for the values and the answers a redaction removed', () => {
    show(redactedAamvaVerification(), 'redacted');

    expect(within(row('Name first')).getAllByText('Redacted')).toHaveLength(2);
    expect(term(group(), 'Values from')).toHaveTextContent('The AAMVA form');
  });

  it('shows another type’s verification through the generic view', () => {
    render(
      <AamvaEvidence
        verification={phase5Verification('verification/database')}
        label="AAMVA"
        state="visible"
      />,
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Name first', { selector: 'dt' })).toBeVisible();
  });
});

describe('AamvaEvidence with what the console has no words for, or no result (C66)', () => {
  it('shows a non-participation choice it does not know as its code, and none when not recorded', () => {
    const [identity, ...rest] = aamvaChecks();
    if (identity === undefined) throw new Error('no identity result');
    const withChoice = (thresholds: Record<string, string | string[]>) => [
      {
        ...identity,
        provenance: { 'implementation-version': 1, thresholds },
      },
      ...rest,
    ];
    const { unmount } = show(
      aamvaVerification({
        checks: withChoice({ 'on-jurisdiction-not-participating': 'a-future-choice' }),
      }),
    );
    expect(term(group(), 'If the jurisdiction does not take part')).toHaveTextContent(
      'a-future-choice',
    );
    unmount();

    show(aamvaVerification({ checks: withChoice({}) }));
    expect(term(group(), 'If the jurisdiction does not take part')).toHaveTextContent(
      'Not recorded',
    );
  });

  it('says the identity was not run, or skipped, when it has no result', () => {
    const [, ...rest] = aamvaChecks();
    const { unmount } = show(aamvaVerification({ checks: rest }));
    expect(term(group(), 'Identity')).toHaveTextContent('Not run by this template');
    unmount();

    show(aamvaVerification({ checks: [], status: 'skipped', source: 'government_id' }));
    expect(term(group(), 'Identity')).toHaveTextContent('Skipped');
  });
});

describe('the AAMVA evidence on its page (C26, C53.7, C66)', () => {
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
    serveRecordsVerification(api, aamvaVerification({ masked: true }), {
      seen: aamvaVerification(),
      permissions: RECORDS_VIEWER,
    });

    const element = await page(aamvaVerification().id);
    const payload = await rscPayloadOf(element);
    render(element);

    expect(screen.getByRole('table', { name: TABLE })).toHaveTextContent('Hidden');
    for (const value of AAMVA_PII_VALUES) {
      expect(document.body.textContent).not.toContain(value);
      expect(payload).not.toContain(value);
    }
  });

  it('puts the values in the payload for an operator the API shows them to (the check above can fail)', async () => {
    serveRecordsVerification(api, aamvaVerification());

    const payload = await rscPayloadOf(await page(aamvaVerification().id));

    for (const value of AAMVA_PII_VALUES) {
      expect(payload).toContain(value);
    }
  });
});
