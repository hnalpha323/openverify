import { describe, expect, it } from 'vitest';
import {
  EMAIL_ADDRESS,
  emailAddressVerification,
  emailComparison,
} from '../testing/fixtures/email-address';
import {
  PHONE_CONFIRMED_AT,
  PHONE_NUMBER,
  initiatedPhoneNumberVerification,
  limitedPhoneNumberVerification,
  phoneComparison,
  phoneNumberVerification,
} from '../testing/fixtures/phone-number';
import { otpEvidenceOf } from './otp-evidence';

describe('otpEvidenceOf (C52.8, C55, C66)', () => {
  it('reads the number, its confirmation, the sends and the wrong entries, and the channel', () => {
    expect(otpEvidenceOf(phoneNumberVerification())).toEqual({
      destination: PHONE_NUMBER,
      confirmedAt: PHONE_CONFIRMED_AT,
      sends: 2,
      failedAttempts: 1,
      channel: 'sms',
      limitedReason: null,
      sender: { id: 'sandbox', sandbox: true },
    });
  });

  it('reads an email address the same way', () => {
    expect(otpEvidenceOf(emailAddressVerification())).toMatchObject({
      destination: EMAIL_ADDRESS,
      sends: 1,
      failedAttempts: 0,
      channel: 'email',
    });
  });

  it('reads the destination as the API masked it, and keeps the counts, which are not PII (C53.7)', () => {
    expect(otpEvidenceOf(phoneNumberVerification({ masked: true }))).toMatchObject({
      destination: null,
      confirmedAt: PHONE_CONFIRMED_AT,
      sends: 2,
      failedAttempts: 1,
    });
  });

  it('reads the limit that refused the user, and a code never confirmed (C55.6)', () => {
    expect(otpEvidenceOf(limitedPhoneNumberVerification())).toMatchObject({
      confirmedAt: null,
      limitedReason: 'environment',
    });
  });

  it('has no channel before the comparison ran', () => {
    expect(otpEvidenceOf(initiatedPhoneNumberVerification())).toMatchObject({
      sends: 1,
      channel: null,
      limitedReason: null,
    });
  });

  it('counts metadata of the wrong shape as not recorded', () => {
    const odd = phoneNumberVerification({
      attributes: {
        checks: [phoneComparison({ metadata: { channel: 5, 'limited-reason': ['destination'] } })],
      },
    });

    expect(otpEvidenceOf(odd)).toMatchObject({ channel: null, limitedReason: null });
    expect(
      otpEvidenceOf(
        emailAddressVerification({
          attributes: { checks: [emailComparison({ metadata: { channel: '' } })] },
        }),
      ).channel,
    ).toBeNull();
  });

  it('says nothing was recorded when an earlier server sent no type attributes', () => {
    const bare = phoneNumberVerification({
      attributes: {
        'phone-number': undefined,
        'confirmed-at': undefined,
        sends: undefined,
        'failed-attempts': undefined,
      },
    });

    expect(otpEvidenceOf(bare)).toMatchObject({
      destination: null,
      confirmedAt: undefined,
      sends: null,
      failedAttempts: null,
    });
  });

  it('reads the sender the comparison names, and whether it is a sandbox provider (C56, ADR 0002 §3d)', () => {
    expect(otpEvidenceOf(emailAddressVerification()).sender).toEqual({
      id: 'smtp',
      sandbox: false,
    });
    expect(otpEvidenceOf(initiatedPhoneNumberVerification()).sender).toBeNull();
    const unnamed = phoneNumberVerification({
      attributes: {
        checks: [phoneComparison({ provenance: { 'implementation-version': 1, thresholds: {} } })],
      },
    });
    expect(otpEvidenceOf(unnamed).sender).toBeNull();
  });
});
