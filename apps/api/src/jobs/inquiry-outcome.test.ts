import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import type { Flow, FlowStep } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import {
  decideInquiryOutcome,
  isRetryableFailure,
  requiredVerifications,
  type VerificationSummary,
} from './inquiry-outcome.js';

const flow = (): Flow => defaultInquiryTemplateAttributes().flow;

const passed = (type: string): VerificationSummary => ({
  type,
  status: 'passed',
  retryable: false,
});
const failed = (type: string, retryable = true): VerificationSummary => ({
  type,
  status: 'failed',
  retryable,
});
const review = (type: string): VerificationSummary => ({
  type,
  status: 'needs_review',
  retryable: false,
});
const inProgress = (type: string, status = 'submitted'): VerificationSummary => ({
  type,
  status,
  retryable: false,
});

const REQUIRED = [
  { type: 'government_id', maxAttempts: 3 },
  { type: 'selfie', maxAttempts: 3 },
] as const;

describe('requiredVerifications', () => {
  it('lists the verification steps of the flow with their attempt limits', () => {
    expect(requiredVerifications(flow())).toEqual(REQUIRED);
  });

  it('ignores steps that create no verification', () => {
    const value = flow();
    value.steps = value.steps.filter((step) => step.type !== 'selfie');
    expect(requiredVerifications(value)).toEqual([{ type: 'government_id', maxAttempts: 3 }]);
  });
});

describe('decideInquiryOutcome', () => {
  it('completes when the latest verification of every required type passed', () => {
    expect(decideInquiryOutcome(REQUIRED, [passed('government_id'), passed('selfie')])).toBe(
      'completed',
    );
  });

  it('completes after a retried verification passes', () => {
    expect(
      decideInquiryOutcome(REQUIRED, [
        failed('government_id'),
        passed('government_id'),
        passed('selfie'),
      ]),
    ).toBe('completed');
  });

  it('completes when a stray initiated verification follows a passed one (F011)', () => {
    expect(
      decideInquiryOutcome(REQUIRED, [
        passed('government_id'),
        inProgress('government_id', 'initiated'),
        passed('selfie'),
      ]),
    ).toBe('completed');
  });

  it('fails on a fraud failure even when a newer verification was only initiated (F011)', () => {
    expect(
      decideInquiryOutcome(REQUIRED, [
        failed('government_id', false),
        inProgress('government_id', 'initiated'),
      ]),
    ).toBe('failed');
  });

  it.each([
    ['nothing was submitted yet', []],
    ['the only verification was just initiated', [inProgress('government_id', 'initiated')]],
    ['the selfie is missing', [passed('government_id')]],
    ['the selfie is still processing', [passed('government_id'), inProgress('selfie')]],
    ['a retry was started', [failed('government_id'), inProgress('government_id', 'initiated')]],
    ['a user-fixable failure has attempts left', [failed('government_id')]],
    ['two of three attempts failed', [failed('government_id'), failed('government_id')]],
  ])('stays pending when %s', (_label, verifications) => {
    expect(decideInquiryOutcome(REQUIRED, verifications)).toBeNull();
  });

  it('fails once the last attempt of a required verification failed', () => {
    expect(
      decideInquiryOutcome(REQUIRED, [
        failed('government_id'),
        failed('government_id'),
        failed('government_id'),
      ]),
    ).toBe('failed');
  });

  it('fails at once when a fraud check failed: there is nothing for the user to retry', () => {
    expect(decideInquiryOutcome(REQUIRED, [passed('government_id'), failed('selfie', false)])).toBe(
      'failed',
    );
  });

  it('fails without waiting for the other verifications', () => {
    expect(decideInquiryOutcome(REQUIRED, [failed('government_id', false)])).toBe('failed');
  });

  it('judges each type on its latest verification, counting only failed attempts', () => {
    const verifications = [
      failed('government_id'),
      failed('government_id'),
      passed('government_id'),
      passed('selfie'),
    ];
    expect(decideInquiryOutcome(REQUIRED, verifications)).toBe('completed');
  });

  it('ignores verifications of types the flow does not require', () => {
    expect(
      decideInquiryOutcome(
        [{ type: 'government_id', maxAttempts: 1 }],
        [passed('government_id'), failed('selfie', false)],
      ),
    ).toBe('completed');
  });

  it('sends the inquiry to review once every required type is decided and one needs review (C30.5)', () => {
    expect(decideInquiryOutcome(REQUIRED, [review('government_id'), passed('selfie')])).toBe(
      'needs_review',
    );
    expect(decideInquiryOutcome(REQUIRED, [passed('government_id'), review('selfie')])).toBe(
      'needs_review',
    );
    expect(decideInquiryOutcome(REQUIRED, [review('government_id'), review('selfie')])).toBe(
      'needs_review',
    );
  });

  it.each([
    ['the selfie is missing', [review('government_id')]],
    ['the selfie is still processing', [review('government_id'), inProgress('selfie')]],
    ['the selfie can still be retried', [review('government_id'), failed('selfie')]],
  ])('waits while one verification needs review and %s', (_label, verifications) => {
    expect(decideInquiryOutcome(REQUIRED, verifications)).toBeNull();
  });

  it('still fails when another required type has no attempt left', () => {
    expect(decideInquiryOutcome(REQUIRED, [review('government_id'), failed('selfie', false)])).toBe(
      'failed',
    );
  });

  describe('a verification canceled by the capture cap (C40.2)', () => {
    /** The 11th capture create cancels its verification; the inquiry stays pending. */
    const canceled = (type: string): VerificationSummary => ({
      type,
      status: 'canceled',
      retryable: false,
    });

    it('counts as a failed attempt the user can retry while attempts remain', () => {
      expect(
        decideInquiryOutcome(REQUIRED, [passed('government_id'), canceled('selfie')]),
      ).toBeNull();
      expect(
        decideInquiryOutcome(REQUIRED, [
          passed('government_id'),
          canceled('selfie'),
          failed('selfie'),
        ]),
      ).toBeNull();
    });

    it('fails the inquiry when it was the last attempt', () => {
      expect(
        decideInquiryOutcome(REQUIRED, [
          passed('government_id'),
          canceled('selfie'),
          canceled('selfie'),
          canceled('selfie'),
        ]),
      ).toBe('failed');
      expect(
        decideInquiryOutcome(REQUIRED, [
          passed('government_id'),
          failed('selfie'),
          failed('selfie'),
          canceled('selfie'),
        ]),
      ).toBe('failed');
    });

    it('is outweighed by a later attempt that passed', () => {
      expect(
        decideInquiryOutcome(REQUIRED, [
          passed('government_id'),
          canceled('selfie'),
          canceled('selfie'),
          passed('selfie'),
        ]),
      ).toBe('completed');
    });
  });

  it('never completes a flow without required verifications', () => {
    expect(decideInquiryOutcome([], [passed('government_id')])).toBeNull();
  });
});

describe('Phase 5 completion (C50.5, C59.6)', () => {
  /** The default flow with `extra` steps before completion. */
  function flowWith(...extra: FlowStep[]): Flow {
    const value = flow();
    const completion = value.steps.findIndex((step) => step.type === 'completion');
    value.steps.splice(completion, 0, ...extra);
    return value;
  }

  const PHASE5_STEPS: FlowStep[] = [
    {
      id: 'document',
      type: 'document',
      documentTypes: ['utility_bill'],
      captureMethods: ['upload'],
    },
    {
      id: 'database',
      type: 'database',
      fields: ['name_first', 'name_last', 'address_country_code', 'birthdate'],
    },
    { id: 'aamva', type: 'aamva', source: 'form' },
    { id: 'phone', type: 'phone_otp', allowedCountries: ['US'] },
    { id: 'email', type: 'email_otp' },
    { id: 'chip', type: 'nfc', androidOnly: true },
    { id: 'wallet', type: 'crypto_wallet', chains: ['eip155:1'], signing: ['wallet'] },
    { id: 'business', type: 'database_business' },
    { id: 'website', type: 'business_website' },
  ];

  describe('requiredVerifications', () => {
    it('counts every verification step, each with its own or its type default attempts', () => {
      expect(requiredVerifications(flowWith(...PHASE5_STEPS))).toEqual([
        ...REQUIRED,
        { type: 'document', maxAttempts: 3 },
        { type: 'database', maxAttempts: 1 },
        { type: 'aamva', maxAttempts: 1 },
        { type: 'phone_number', maxAttempts: 5 },
        { type: 'email_address', maxAttempts: 5 },
        { type: 'government_id_nfc', maxAttempts: 3 },
        { type: 'crypto_wallet', maxAttempts: 3 },
        { type: 'database_business', maxAttempts: 3 },
        { type: 'business_website', maxAttempts: 3 },
      ]);
    });

    it("keeps a step's own maxAttempts", () => {
      expect(
        requiredVerifications(flowWith({ id: 'email', type: 'email_otp', maxAttempts: 2 })),
      ).toContainEqual({ type: 'email_address', maxAttempts: 2 });
    });

    it('marks an AAMVA step that reads the government ID as silent', () => {
      expect(
        requiredVerifications(flowWith({ id: 'aamva', type: 'aamva', source: 'government_id' })),
      ).toContainEqual({ type: 'aamva', maxAttempts: 1, silent: true });
    });
  });

  const PHONE = [...REQUIRED, { type: 'phone_number', maxAttempts: 5 }] as const;

  it('waits for every new step, then completes once it passed', () => {
    const others = [passed('government_id'), passed('selfie')];
    expect(decideInquiryOutcome(PHONE, others)).toBeNull();
    expect(decideInquiryOutcome(PHONE, [...others, passed('phone_number')])).toBe('completed');
  });

  it('ignores a confirmed attempt: the code was accepted, the verification not yet submitted', () => {
    expect(
      decideInquiryOutcome(PHONE, [
        passed('government_id'),
        passed('selfie'),
        failed('phone_number'),
        inProgress('phone_number', 'confirmed'),
      ]),
    ).toBeNull();
    expect(
      decideInquiryOutcome(PHONE, [
        passed('government_id'),
        passed('selfie'),
        passed('phone_number'),
        inProgress('phone_number', 'confirmed'),
      ]),
    ).toBe('completed');
  });

  it('fails a new step once its attempts are used up', () => {
    const database = [...REQUIRED, { type: 'database', maxAttempts: 1 }] as const;
    expect(
      decideInquiryOutcome(database, [
        passed('government_id'),
        passed('selfie'),
        failed('database', true),
      ]),
    ).toBe('failed');
  });

  it('counts a latest skipped attempt as done', () => {
    const aamva = [...REQUIRED, { type: 'aamva', maxAttempts: 1 }] as const;
    expect(
      decideInquiryOutcome(aamva, [
        passed('government_id'),
        passed('selfie'),
        inProgress('aamva', 'skipped'),
      ]),
    ).toBe('completed');
  });

  describe('a silent AAMVA step (C59.6)', () => {
    const SILENT = [...REQUIRED, { type: 'aamva', maxAttempts: 1, silent: true }] as const;
    const ID_A = 'ver_01M5CK16P0D13FXHZSS4TCFBVH';
    const ID_B = 'ver_01M5CK17N82ZP0PQ8RZRRTT5V5';
    const withId = (summary: VerificationSummary, id: string): VerificationSummary => ({
      ...summary,
      id,
    });
    const bound = (status: string, source: string, retryable = false): VerificationSummary => ({
      type: 'aamva',
      status,
      retryable,
      id: `ver_aamva_${source}_${status}`,
      sourceVerificationId: source,
    });

    it('completes when it is last and the server skipped it', () => {
      expect(
        decideInquiryOutcome(SILENT, [
          withId(passed('government_id'), ID_A),
          passed('selfie'),
          bound('skipped', ID_A),
        ]),
      ).toBe('completed');
    });

    it('stays open before any government ID decision', () => {
      expect(
        decideInquiryOutcome(SILENT, [withId(inProgress('government_id'), ID_A), passed('selfie')]),
      ).toBeNull();
    });

    it('stays open until the server created the attempt of the latest ID decision', () => {
      expect(
        decideInquiryOutcome(SILENT, [withId(passed('government_id'), ID_A), passed('selfie')]),
      ).toBeNull();
    });

    it('is judged on the attempt bound to the latest decided ID: reviewed on a passport, then passed on a US licence', () => {
      const history = [
        withId(review('government_id'), ID_A),
        bound('skipped', ID_A),
        passed('selfie'),
        withId(passed('government_id'), ID_B),
      ];
      expect(decideInquiryOutcome(SILENT, [...history, bound('submitted', ID_B)])).toBeNull();
      expect(decideInquiryOutcome(SILENT, [...history, bound('passed', ID_B)])).toBe('completed');
      expect(decideInquiryOutcome(SILENT, [...history, bound('failed', ID_B)])).toBe('failed');
    });

    it('fails on a failed bound attempt, whatever attempts the step allows: the user cannot retry a step the server runs', () => {
      const three = [...REQUIRED, { type: 'aamva', maxAttempts: 3, silent: true }] as const;
      expect(
        decideInquiryOutcome(three, [
          withId(passed('government_id'), ID_A),
          passed('selfie'),
          bound('failed', ID_A, true),
        ]),
      ).toBe('failed');
    });

    it('ignores attempts bound to an earlier ID decision', () => {
      const three = [...REQUIRED, { type: 'aamva', maxAttempts: 3, silent: true }] as const;
      expect(
        decideInquiryOutcome(three, [
          withId(review('government_id'), ID_A),
          bound('skipped', ID_A),
          passed('selfie'),
          withId(passed('government_id'), ID_B),
        ]),
      ).toBeNull();
    });
  });
});

describe('isRetryableFailure', () => {
  const check = (type: 'user_behavior' | 'fraud', status: string, requirement = 'required') => ({
    type,
    status,
    requirement,
  });

  it('is true when only required user_behavior checks failed', () => {
    expect(
      isRetryableFailure([
        check('user_behavior', 'failed'),
        check('fraud', 'passed'),
        check('fraud', 'failed', 'not_required'),
      ]),
    ).toBe(true);
  });

  it('is false when a required fraud check failed', () => {
    expect(isRetryableFailure([check('user_behavior', 'failed'), check('fraud', 'failed')])).toBe(
      false,
    );
  });

  it('is false when no required check failed', () => {
    expect(isRetryableFailure([check('user_behavior', 'passed')])).toBe(false);
  });
});
