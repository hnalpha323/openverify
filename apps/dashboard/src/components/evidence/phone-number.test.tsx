import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { phase5Verification } from '../../testing/phase5-fixtures';
import { OTP_SANDBOX_SENDER_TEXT } from '../../lib/otp-words';
import { PHONE_NUMBER_PASS_MEANS } from '../../lib/phone-number-words';
import {
  PHONE_CONFIRMED_AT,
  PHONE_NUMBER,
  initiatedPhoneNumberVerification,
  limitedPhoneNumberVerification,
  phoneComparison,
  phoneNumberVerification,
} from '../../testing/fixtures/phone-number';
import { formatUtc } from '../timestamp';
import type { EvidenceState } from './generic';
import { PhoneNumberEvidence } from './phone-number';

function evidence(
  verification = phoneNumberVerification(),
  state: EvidenceState = 'visible',
  label = 'Phone number',
) {
  return render(<PhoneNumberEvidence verification={verification} label={label} state={state} />);
}

const group = (name = 'Phone number evidence') => screen.getByRole('group', { name });

/** The value a term of the evidence names. */
function value(term: string): HTMLElement {
  const dd = within(group()).getByText(term, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`No value for ${term}`);
  return dd;
}

describe('PhoneNumberEvidence (C52.8, C55, C66)', () => {
  it('shows the number, when its code was confirmed, the sends, the wrong entries and the channel', () => {
    evidence();

    expect(value('Phone number')).toHaveTextContent(/^\+15555550100$/);
    expect(value('Phone number').textContent).toBe(PHONE_NUMBER);
    const confirmed = within(value('Confirmed (UTC)')).getByText(formatUtc(PHONE_CONFIRMED_AT));
    expect(confirmed.closest('time')).toHaveAttribute('datetime', PHONE_CONFIRMED_AT);
    expect(value('Sends')).toHaveTextContent(/^2$/);
    expect(value('Failed attempts')).toHaveTextContent(/^1$/);
    expect(value('Channel')).toHaveTextContent(/^Text message \(SMS\)$/);
  });

  it('says what a pass means, as the docs do', () => {
    evidence();

    const meaning = within(group()).getByText(PHONE_NUMBER_PASS_MEANS);
    expect(meaning.closest('p')).toHaveTextContent(/^What a pass means: The user entered/);
  });

  it('is a group named after the verification, so a retry has its own', () => {
    evidence(phoneNumberVerification(), 'visible', 'Phone number, attempt 2');

    expect(group('Phone number, attempt 2 evidence')).toBeVisible();
  });

  it('shows "Hidden" for the number the API masked, and the counts, which are not PII (C53.7)', () => {
    evidence(phoneNumberVerification({ masked: true }), 'hidden');

    expect(within(value('Phone number')).getByText('Hidden')).toHaveAccessibleDescription(
      'Your role cannot see personal data (the pii:view permission).',
    );
    expect(group()).not.toHaveTextContent(PHONE_NUMBER);
    expect(value('Sends')).toHaveTextContent(/^2$/);
    expect(value('Failed attempts')).toHaveTextContent(/^1$/);
  });

  it('shows "Redacted" for the number once the inquiry was redacted', () => {
    evidence(phoneNumberVerification({ masked: true }), 'redacted');

    expect(value('Phone number')).toHaveTextContent(/^Redacted$/);
  });

  it('says which limit refused the user, and that no code was confirmed (C55.6)', () => {
    evidence(limitedPhoneNumberVerification());

    expect(value('Confirmed (UTC)')).toHaveTextContent(/^Not confirmed$/);
    const limit = value('Refused by');
    expect(limit).toHaveTextContent("The environment's text message budget");
    expect(limit).toHaveTextContent('(otp-sms-max-per-hour, otp-sms-country-hour)');
  });

  it('names no limit when none refused the user', () => {
    evidence();

    expect(within(group()).queryByText('Refused by')).not.toBeInTheDocument();
  });

  it('says the channel is not recorded before the comparison ran', () => {
    evidence(initiatedPhoneNumberVerification());

    expect(value('Channel')).toHaveTextContent(/^Not recorded yet$/);
    expect(value('Sends')).toHaveTextContent(/^1$/);
  });

  it('shows a value it has no words for as its code', () => {
    evidence(
      phoneNumberVerification({
        attributes: {
          checks: [
            {
              ...phoneComparison({
                status: 'not_applicable',
                reasons: ['otp_delivery_unavailable'],
                metadata: { channel: 'carrier-pigeon', 'limited-reason': 'moon-phase' },
              }),
            },
          ],
        },
      }),
    );

    expect(within(value('Channel')).getByText('carrier-pigeon').tagName).toBe('CODE');
    expect(within(value('Refused by')).getByText('moon-phase').tagName).toBe('CODE');
  });

  it('keeps every term in its own row of the evidence list, which a page reads a value by', () => {
    evidence();

    const list = within(group()).getByText('Phone number', { selector: 'dt' }).closest('dl');
    expect(list?.parentElement).toBe(group());
    for (const row of list?.children ?? []) {
      expect(row.querySelectorAll('dt')).toHaveLength(1);
    }
  });
  it('shows a verification of another type in the generic view, never as this one', () => {
    render(
      <PhoneNumberEvidence
        verification={phase5Verification('verification/email-address')}
        label="Synthetic"
        state="visible"
      />,
    );

    expect(screen.getByRole('group', { name: 'Synthetic evidence' })).toBeVisible();
    expect(screen.queryByText(/^What a pass means/)).not.toBeInTheDocument();
  });

  it('names the sender, and says a sandbox sender sent nothing (ADR 0002 §3d)', () => {
    evidence();

    const sender = value('Sent through');
    expect(within(sender).getByText('sandbox').tagName).toBe('CODE');
    expect(sender).toHaveTextContent(OTP_SANDBOX_SENDER_TEXT);
  });

  it('says the sender is not recorded yet before the comparison ran', () => {
    evidence(initiatedPhoneNumberVerification());

    expect(value('Sent through')).toHaveTextContent(/^Not recorded yet$/);
  });

  it('says nothing of the counts and the confirmation an earlier server did not report', () => {
    evidence(
      phoneNumberVerification({
        attributes: { 'confirmed-at': undefined, sends: undefined, 'failed-attempts': undefined },
      }),
    );

    for (const term of ['Confirmed (UTC)', 'Sends', 'Failed attempts']) {
      expect(value(term), term).toHaveTextContent(/^—None$/);
    }
  });
});
