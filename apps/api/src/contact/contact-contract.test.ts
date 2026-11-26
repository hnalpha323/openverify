/**
 * C51.2 for the contact checks: the reasons each evaluator may emit are exactly the contract's
 * (`CONTACT_EVALUATOR_REASONS` in checks, which cannot import contracts, against
 * `CONTACT_CHECK_REASONS`), and every result the job's inputs can produce, over the OTP states
 * and the email outcomes, carries only listed reasons. The constants the API and the database
 * share with contracts and checks agree.
 */
import {
  CONTACT_EVALUATOR_REASONS,
  OTP_LIMITED_REASONS as CHECK_LIMITED_REASONS,
  evaluateEmailAddressChecks,
  evaluatePhoneNumberChecks,
  type EmailAddressCheckInput,
  type MxLookupResult,
  type OtpCheckState,
} from '@openverify/checks';
import {
  CONTACT_CHECK_REASONS,
  OTP_KEY_INFO,
  OTP_MAX_ATTEMPTS_PER_CODE,
  OTP_MAX_WRONG_ENTRIES,
} from '@openverify/contracts';
import { defaultTemplateConfig, type CheckResult } from '@openverify/core';
import {
  OTP_CHALLENGE_MAX_ATTEMPTS,
  OTP_KEY_HKDF_INFO,
  OTP_LIMITED_REASONS as DB_LIMITED_REASONS,
} from '@openverify/db';
import { describe, expect, it } from 'vitest';

const LIMITED = [null, ...CHECK_LIMITED_REASONS] as const;

/** Every OTP state the job can read, coarsely. */
function states(): (OtpCheckState | null)[] {
  const all: (OtpCheckState | null)[] = [null];
  for (const confirmed of [true, false]) {
    for (const sends of [0, 1, 5]) {
      for (const wrongEntries of [0, 3, OTP_MAX_WRONG_ENTRIES]) {
        for (const limitedReason of LIMITED) {
          all.push({
            confirmed,
            sends,
            wrongEntries,
            maxWrongEntries: OTP_MAX_WRONG_ENTRIES,
            limitedReason,
          });
        }
      }
    }
  }
  return all;
}

const MX_OUTCOMES: EmailAddressCheckInput['mx'][] = [
  undefined,
  { kind: 'not_configured' },
  { kind: 'error' },
  ...(
    [
      { kind: 'mx', exchanges: ['exchange'] },
      { kind: 'mx', exchanges: [''] },
      { kind: 'mx', exchanges: [] },
      { kind: 'no_mx', addressRecords: 2 },
      { kind: 'no_mx', addressRecords: 0 },
      { kind: 'not_found' },
    ] satisfies MxLookupResult[]
  ).map((result) => ({ kind: 'result' as const, provider: { id: 'dns', sandbox: false }, result })),
];

function expectListed(results: readonly CheckResult[]) {
  for (const result of results) {
    const listed = (CONTACT_CHECK_REASONS as Readonly<Record<string, readonly string[]>>)[
      result.name
    ];
    expect(listed, result.name).toBeDefined();
    for (const reason of result.reasons) {
      expect(listed, `${result.name}: ${reason}`).toContain(reason);
    }
  }
}

describe('the contact checks contract (C51.2)', () => {
  it('lists the same reasons per evaluator as the contract, in order', () => {
    expect(CONTACT_EVALUATOR_REASONS).toEqual(CONTACT_CHECK_REASONS);
  });

  it('emits only listed reasons for every phone OTP state', () => {
    const config = defaultTemplateConfig('phone_number');
    for (const otp of states()) {
      for (const phoneNumber of ['+12025550100', null]) {
        expectListed(
          evaluatePhoneNumberChecks(
            { phoneNumber, otp, sender: { id: 'sandbox', sandbox: true } },
            config,
          ),
        );
      }
    }
  });

  it('emits only listed reasons for every email state, list and DNS outcome', () => {
    const config = defaultTemplateConfig('email_address');
    for (const otp of states().slice(0, 8)) {
      for (const emailAddress of ['avery@mail.example.org', 'avery@trash.example', null]) {
        for (const mx of MX_OUTCOMES) {
          for (const disposableList of [
            null,
            {
              domains: new Set(['trash.example']),
              source: { id: 'synthetic', sha256: 'f'.repeat(64) },
            },
          ]) {
            expectListed(
              evaluateEmailAddressChecks(
                {
                  emailAddress,
                  otp,
                  sender: { id: 'smtp', sandbox: false },
                  disposableList,
                  mx,
                  environment: 'production',
                },
                config,
              ),
            );
          }
        }
      }
    }
  });

  it('shares its constants with contracts, checks and the database', () => {
    expect(OTP_CHALLENGE_MAX_ATTEMPTS).toBe(OTP_MAX_ATTEMPTS_PER_CODE);
    expect(OTP_KEY_HKDF_INFO).toBe(OTP_KEY_INFO);
    expect([...DB_LIMITED_REASONS]).toEqual([...CHECK_LIMITED_REASONS]);
  });
});
