import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { phase5Verification } from '../../testing/phase5-fixtures';
import { EMAIL_ADDRESS_PASS_MEANS } from '../../lib/email-address-words';
import {
  EMAIL_ADDRESS,
  deniedDomainEmailAddressVerification,
  disposableCheck,
  emailAddressVerification,
  emailComparison,
  mxCheck,
} from '../../testing/fixtures/email-address';
import { EmailAddressEvidence } from './email-address';
import type { EvidenceState } from './generic';

function evidence(verification = emailAddressVerification(), state: EvidenceState = 'visible') {
  return render(
    <EmailAddressEvidence verification={verification} label="Email address" state={state} />,
  );
}

const group = () => screen.getByRole('group', { name: 'Email address evidence' });

/** The value a term of the evidence names. */
function value(term: string): HTMLElement {
  const dd = within(group()).getByText(term, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`No value for ${term}`);
  return dd;
}

describe('EmailAddressEvidence (C52.8, C55, C56, C66)', () => {
  it('shows the address, when its code was confirmed, the sends, the wrong entries and the channel', () => {
    evidence();

    expect(value('Email address').textContent).toBe(EMAIL_ADDRESS);
    expect(value('Confirmed (UTC)').querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-10-20T12:05:25.000Z',
    );
    expect(value('Sends')).toHaveTextContent(/^1$/);
    expect(value('Failed attempts')).toHaveTextContent(/^0$/);
    expect(value('Channel')).toHaveTextContent(/^Email$/);
  });

  it('says what the domain checks found, in words (C56)', () => {
    evidence();

    expect(value('Disposable-domain lists')).toHaveTextContent('On no list');
    const mail = value('Mail domain');
    expect(mail).toHaveTextContent('MX records');
    expect(mail).toHaveTextContent('2 records');
  });

  it('says a denied domain, how far up it matched, and a reserved sandbox name (C56)', () => {
    evidence(deniedDomainEmailAddressVerification());

    const disposable = value('Disposable-domain lists');
    expect(disposable).toHaveTextContent("On the template's deny list");
    expect(disposable).toHaveTextContent("Matched on the address's own domain");
    const mail = value('Mail domain');
    expect(mail).toHaveTextContent('A reserved sandbox name');
    expect(mail).not.toHaveTextContent('records');
  });

  it('says what a pass means, as the docs do', () => {
    evidence();

    expect(within(group()).getByText(EMAIL_ADDRESS_PASS_MEANS).closest('p')).toHaveTextContent(
      /^What a pass means: The user entered the code/,
    );
  });

  it('shows "Hidden" for the address the API masked, and "Redacted" after a redaction (C53.7)', () => {
    const { unmount } = evidence(emailAddressVerification({ masked: true }), 'hidden');
    expect(within(value('Email address')).getByText('Hidden')).toBeVisible();
    expect(group()).not.toHaveTextContent(EMAIL_ADDRESS);
    expect(value('Disposable-domain lists')).toHaveTextContent('On no list');
    unmount();

    evidence(emailAddressVerification({ masked: true }), 'redacted');
    expect(value('Email address')).toHaveTextContent(/^Redacted$/);
  });

  it('says what is not recorded yet, before the domain checks ran or when they recorded nothing', () => {
    const { unmount } = evidence(emailAddressVerification({ attributes: { checks: [] } }));
    expect(value('Disposable-domain lists')).toHaveTextContent(/^Not recorded yet$/);
    expect(value('Mail domain')).toHaveTextContent(/^Not recorded yet$/);
    unmount();

    evidence(
      emailAddressVerification({
        attributes: {
          checks: [
            emailComparison(),
            disposableCheck({
              status: 'not_applicable',
              reasons: ['list_unavailable'],
              metadata: {},
            }),
            mxCheck({ status: 'not_applicable', reasons: ['execution_error'], metadata: {} }),
          ],
        },
      }),
    );
    expect(value('Disposable-domain lists')).toHaveTextContent(/^Not recorded$/);
    expect(value('Mail domain')).toHaveTextContent(/^Not recorded$/);
  });

  it('shows a value it has no words for as its code', () => {
    evidence(
      emailAddressVerification({
        attributes: {
          checks: [
            emailComparison(),
            disposableCheck({ metadata: { match: 'greylisted' } }),
            mxCheck({ metadata: { route: 'carrier-pigeon' } }),
          ],
        },
      }),
    );

    expect(within(value('Disposable-domain lists')).getByText('greylisted').tagName).toBe('CODE');
    expect(within(value('Mail domain')).getByText('carrier-pigeon').tagName).toBe('CODE');
  });
  it('shows a verification of another type in the generic view, never as this one', () => {
    render(
      <EmailAddressEvidence
        verification={phase5Verification('verification/phone-number')}
        label="Synthetic"
        state="visible"
      />,
    );

    expect(screen.getByRole('group', { name: 'Synthetic evidence' })).toBeVisible();
    expect(screen.queryByText(/^What a pass means/)).not.toBeInTheDocument();
  });

  it('names the mail sender, which is no sandbox provider (C56)', () => {
    evidence();

    const sender = value('Sent through');
    expect(within(sender).getByText('smtp').tagName).toBe('CODE');
    expect(sender).not.toHaveTextContent(/sandbox/i);
  });
});
