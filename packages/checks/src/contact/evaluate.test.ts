/**
 * C56 at the logic level: the runners evaluate every enabled contact check over one context,
 * every evaluator emits only the reasons its C51.2 row lists, and the decision engine reads the
 * results as the plan says (the OTP comparison required, disposable and MX advisory).
 */
import {
  checkResultSchema,
  decideVerification,
  defaultTemplateConfig,
  type CheckResult,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from '../result.js';
import { evaluateEmailAddressChecks, evaluatePhoneNumberChecks } from './evaluate.js';
import { EMAIL_ADDRESS_EVALUATORS, PHONE_NUMBER_EVALUATORS } from './evaluators.js';
import { OTP_LIMITED_REASONS, type EmailAddressCheckInput } from './inputs.js';
import { CONTACT_EVALUATOR_REASONS } from './reasons.js';
import {
  EMAIL_CHECKS,
  PHONE_CHECKS,
  disposableList,
  emailInput,
  otpState,
  phoneInput,
  templateOf,
} from './testing.js';

/** The C51.2 rows with the C29.4 shared reasons first, as `CONTACT_CHECK_REASONS` lists them. */
const C51_2 = {
  phone_number_otp_comparison: [
    'input_missing',
    'otp_attempts_exhausted',
    'otp_not_confirmed',
    'otp_delivery_unavailable',
  ],
  email_address_otp_comparison: [
    'input_missing',
    'otp_attempts_exhausted',
    'otp_not_confirmed',
    'otp_delivery_unavailable',
  ],
  email_address_disposable_detection: ['input_missing', 'disposable_domain', 'list_unavailable'],
  email_address_mx_detection: [
    'input_missing',
    'execution_error',
    'provider_not_configured',
    'domain_not_found',
    'domain_rejects_mail',
    'no_mail_server',
  ],
};

const OTP_STATES = [
  null,
  otpState(),
  otpState({ confirmed: false, sends: 0 }),
  otpState({ confirmed: false, sends: 5 }),
  otpState({ confirmed: false, wrongEntries: 10 }),
  ...OTP_LIMITED_REASONS.map((limitedReason) => otpState({ confirmed: false, limitedReason })),
];

const EMAIL_VARIANTS: Partial<EmailAddressCheckInput>[] = [
  {},
  { emailAddress: null },
  { emailAddress: 'bad address' },
  { emailAddress: 'a@trash.example' },
  { disposableList: null },
  { mx: undefined },
  { mx: { kind: 'not_configured' } },
  { mx: { kind: 'error' } },
  {
    mx: { kind: 'result', provider: { id: 'dns', sandbox: false }, result: { kind: 'not_found' } },
  },
  {
    mx: {
      kind: 'result',
      provider: { id: 'dns', sandbox: false },
      result: { kind: 'mx', exchanges: ['.'] },
    },
  },
  {
    mx: {
      kind: 'result',
      provider: { id: 'dns', sandbox: false },
      result: { kind: 'no_mx', addressRecords: 0 },
    },
  },
  { environment: 'sandbox', emailAddress: 'a@x.test', mx: undefined },
  { environment: 'sandbox', emailAddress: 'a@x.invalid', mx: undefined },
];

function expectListedReasons(results: readonly CheckResult[]): void {
  for (const result of results) {
    expect(checkResultSchema.parse(result)).toEqual(result);
    const allowed = CONTACT_EVALUATOR_REASONS[result.name] ?? [];
    for (const reason of result.reasons) {
      expect(allowed, `${result.name} emitted ${reason}`).toContain(reason);
    }
    expect(result.status === 'pending').toBe(false);
  }
}

describe('the contact reasons (C51.2)', () => {
  it('lists exactly the C51.2 row of each check, with its shared reasons first', () => {
    expect(CONTACT_EVALUATOR_REASONS).toEqual(C51_2);
  });

  it('has an evaluator for every contact check and none for another type', () => {
    expect(Object.keys(PHONE_NUMBER_EVALUATORS)).toEqual([...PHONE_CHECKS]);
    expect(Object.keys(EMAIL_ADDRESS_EVALUATORS)).toEqual([...EMAIL_CHECKS]);
  });

  it('emits only listed reasons over every OTP state and email outcome', () => {
    for (const otp of OTP_STATES) {
      expectListedReasons(evaluatePhoneNumberChecks(phoneInput({ otp }), templateOf(PHONE_CHECKS)));
      for (const variant of EMAIL_VARIANTS) {
        expectListedReasons(
          evaluateEmailAddressChecks(emailInput({ otp, ...variant }), templateOf(EMAIL_CHECKS)),
        );
      }
    }
  });
});

describe('evaluatePhoneNumberChecks and evaluateEmailAddressChecks (C56)', () => {
  it('evaluates the enabled checks in configuration order; disabled ones give no result', () => {
    const template = templateOf([...EMAIL_CHECKS].reverse());
    const disposable = template.checks.email_address_disposable_detection;
    if (disposable !== undefined) {
      disposable.enabled = false;
    }
    expect(evaluateEmailAddressChecks(emailInput(), template).map((result) => result.name)).toEqual(
      ['email_address_mx_detection', 'email_address_otp_comparison'],
    );
    expect(evaluatePhoneNumberChecks(phoneInput(), templateOf(PHONE_CHECKS))).toHaveLength(1);
  });

  it('refuses an unknown check or one of another verification type', () => {
    expect(() =>
      evaluatePhoneNumberChecks(phoneInput(), templateOf(['email_address_mx_detection'])),
    ).toThrow(InvalidCheckConfigError);
    expect(() =>
      evaluateEmailAddressChecks(emailInput(), {
        checks: { not_a_check: { enabled: true, required: true } },
      }),
    ).toThrow(InvalidCheckConfigError);
  });

  it('refuses a disposable config that breaks its schema', () => {
    expect(() =>
      evaluateEmailAddressChecks(
        emailInput(),
        templateOf(EMAIL_CHECKS, {
          email_address_disposable_detection: { 'deny-domains': ['Not A Domain'] },
        }),
      ),
    ).toThrow(InvalidCheckConfigError);
  });

  it('passes a confirmed phone verification on the registry default template', () => {
    const template = defaultTemplateConfig('phone_number');
    const results = evaluatePhoneNumberChecks(phoneInput(), template);
    expect(decideVerification(results, template).status).toBe('passed');
  });

  it('fails a phone verification whose sends ran out, as a retryable user mistake', () => {
    const template = defaultTemplateConfig('phone_number');
    const results = evaluatePhoneNumberChecks(
      phoneInput({ otp: otpState({ confirmed: false, sends: 5 }) }),
      template,
    );
    const decision = decideVerification(results, template);
    expect(decision.status).toBe('failed');
  });

  it('sends a limit refusal to review, never to a failure', () => {
    const template = defaultTemplateConfig('email_address');
    const results = evaluateEmailAddressChecks(
      emailInput({ otp: otpState({ confirmed: false, limitedReason: 'environment' }) }),
      template,
    );
    expect(decideVerification(results, template).status).toBe('needs_review');
  });

  it('passes a confirmed email whose advisory disposable check failed (the operator decides)', () => {
    const defaults = defaultTemplateConfig('email_address');
    const template = {
      ...defaults,
      checks: {
        ...defaults.checks,
        email_address_disposable_detection: {
          enabled: true,
          required: false,
          config: { 'deny-domains': ['disposable.test'] },
        },
      },
    };
    const results = evaluateEmailAddressChecks(
      emailInput({ emailAddress: 'a@disposable.test', disposableList: disposableList([]) }),
      template,
    );
    expect(
      results.find((result) => result.name === 'email_address_disposable_detection'),
    ).toMatchObject({ status: 'failed', reasons: ['disposable_domain'] });
    expect(decideVerification(results, template).status).toBe('passed');
  });
});
