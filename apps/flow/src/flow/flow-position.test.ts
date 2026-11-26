import type { RetryHint } from '@openverify/contracts';
import type { Flow, FlowStep } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import {
  VERIFICATION_IDS,
  defaultFlow,
  flowSession,
  flowVerification,
} from '../testing/flow-fixtures';
import { resolveFlowPosition, type FlowPosition } from './flow-position';

const BLUR: RetryHint = { name: 'id_blur_detection', reasons: ['image_blurry'] };

function stepOf(flow: Flow, id: string): FlowStep {
  const step = flow.steps.find((candidate) => candidate.id === id);
  if (step === undefined) {
    throw new Error(`no step ${id}`);
  }
  return step;
}

const FLOW = defaultFlow();
const CONSENT = stepOf(FLOW, 'consent');
const GOVERNMENT_ID = stepOf(FLOW, 'government_id');
const SELFIE = stepOf(FLOW, 'selfie');
const COMPLETION = stepOf(FLOW, 'completion');
const FAILURE = stepOf(FLOW, 'failure');

function customFlow(steps: unknown[], transitions: unknown[] = []): Flow {
  return {
    metadata: { specVersion: 1, id: 'custom', version: 1, name: 'Custom' },
    steps,
    transitions,
  } as Flow;
}

const consentStep = {
  id: 'consent',
  type: 'consent',
  textKeys: ['consent.biometric'],
  required: true,
};
const completionStep = { id: 'done', type: 'completion' };

function position(options: Parameters<typeof flowSession>[0]): FlowPosition {
  return resolveFlowPosition(flowSession(options));
}

describe('resolveFlowPosition', () => {
  describe('consent', () => {
    it.each(['created', 'pending'] as const)('starts with consent for a %s inquiry', (status) => {
      expect(position({ status })).toEqual({ kind: 'consent', step: CONSENT });
    });

    it('moves on once consent is recorded', () => {
      expect(position({ consent: true })).toMatchObject({ kind: 'capture', step: GOVERNMENT_ID });
    });
  });

  describe('a verification step', () => {
    it('asks for a first attempt when there is no verification yet', () => {
      expect(position({ consent: true })).toEqual({
        kind: 'capture',
        step: GOVERNMENT_ID,
        attempt: 1,
        maxAttempts: 3,
        verificationId: null,
        hints: [],
      });
    });

    it('reuses an initiated verification, which is the same attempt', () => {
      expect(
        position({
          consent: true,
          verifications: [flowVerification('government_id', 'initiated')],
        }),
      ).toEqual({
        kind: 'capture',
        step: GOVERNMENT_ID,
        attempt: 1,
        maxAttempts: 3,
        verificationId: VERIFICATION_IDS.governmentId,
        hints: [],
      });
    });

    it.each(['submitted', 'confirmed'] as const)('waits for a %s verification', (status) => {
      expect(
        position({ consent: true, verifications: [flowVerification('government_id', status)] }),
      ).toEqual({
        kind: 'processing',
        step: GOVERNMENT_ID,
        verificationId: VERIFICATION_IDS.governmentId,
        attempt: 1,
        maxAttempts: 3,
      });
    });

    it('offers another attempt with the retry hints after a failure', () => {
      expect(
        position({
          consent: true,
          verifications: [flowVerification('government_id', 'failed', { hints: [BLUR] })],
        }),
      ).toEqual({
        kind: 'capture',
        step: GOVERNMENT_ID,
        attempt: 2,
        maxAttempts: 3,
        verificationId: null,
        hints: [BLUR],
      });
    });

    it('waits for the server to fail the inquiry after a failure with no retry hint, attempts left or not (C30.1, C50.5)', () => {
      // A failure without a hint failed a fraud check: it is not retryable, so the server fails the
      // inquiry. The verification's decision commits before the inquiry's, so the flow can read
      // the one before the other; it must not offer an attempt the server then refuses.
      expect(
        position({
          consent: true,
          verifications: [flowVerification('government_id', 'failed')],
        }),
      ).toEqual({ kind: 'finalizing', step: GOVERNMENT_ID });
    });

    it('treats the deprecated requires_retry status as a failure', () => {
      expect(
        position({
          consent: true,
          verifications: [flowVerification('government_id', 'requires_retry', { hints: [BLUR] })],
        }),
      ).toMatchObject({ kind: 'capture', attempt: 2, hints: [BLUR] });
    });

    it('offers a new attempt without hints after a canceled verification', () => {
      expect(
        position({ consent: true, verifications: [flowVerification('government_id', 'canceled')] }),
      ).toMatchObject({ kind: 'capture', attempt: 2, hints: [], verificationId: null });
    });

    it('counts the attempt in progress after earlier failures', () => {
      expect(
        position({
          consent: true,
          verifications: [
            flowVerification('government_id', 'failed', {
              id: VERIFICATION_IDS.governmentIdRetry,
              hints: [BLUR],
            }),
            flowVerification('government_id', 'submitted'),
          ],
        }),
      ).toMatchObject({ kind: 'processing', attempt: 2, maxAttempts: 3 });
    });

    it('waits for the server’s decision once the last attempt has failed', () => {
      expect(
        position({
          consent: true,
          verifications: [
            flowVerification('government_id', 'failed', { id: VERIFICATION_IDS.governmentIdRetry }),
            flowVerification('government_id', 'failed', { id: VERIFICATION_IDS.governmentIdThird }),
            flowVerification('government_id', 'failed', { hints: [BLUR] }),
          ],
        }),
      ).toEqual({ kind: 'finalizing', step: GOVERNMENT_ID });
    });

    it('counts only verifications of the step’s own type', () => {
      expect(
        position({
          consent: true,
          verifications: [
            flowVerification('government_id', 'passed'),
            flowVerification('selfie', 'failed', {
              hints: [{ name: 'selfie_image_quality_detection', reasons: ['image_too_dark'] }],
            }),
          ],
        }),
      ).toEqual({
        kind: 'capture',
        step: SELFIE,
        attempt: 2,
        maxAttempts: 3,
        verificationId: null,
        hints: [{ name: 'selfie_image_quality_detection', reasons: ['image_too_dark'] }],
      });
    });

    it.each(['passed', 'skipped', 'needs_review'] as const)(
      'moves to the next step once %s',
      (status) => {
        expect(
          position({ consent: true, verifications: [flowVerification('government_id', status)] }),
        ).toMatchObject({ kind: 'capture', step: SELFIE, attempt: 1 });
      },
    );

    it('moves on when a later attempt passes', () => {
      expect(
        position({
          consent: true,
          verifications: [
            flowVerification('government_id', 'failed', { id: VERIFICATION_IDS.governmentIdRetry }),
            flowVerification('government_id', 'passed'),
          ],
        }),
      ).toMatchObject({ kind: 'capture', step: SELFIE });
    });
  });

  describe('the Phase 5 steps this client runs (C64.1)', () => {
    const phone = { id: 'phone', type: 'phone_otp', allowedCountries: ['GB', 'US'] };
    const email = { id: 'email', type: 'email_otp', maxAttempts: 2 };
    const wallet = {
      id: 'wallet',
      type: 'crypto_wallet',
      chains: ['eip155:1'],
      signing: ['wallet', 'paste'],
    };
    const records = {
      id: 'records',
      type: 'database',
      fields: ['name_first', 'name_last', 'birthdate', 'address_country_code'],
    };
    const licenceForm = { id: 'licence', type: 'aamva', source: 'form' };
    const governmentId = {
      id: 'government_id',
      type: 'government_id',
      sides: 'both',
      maxAttempts: 3,
      captureMethods: ['upload'],
    };
    const silentAamva = { id: 'aamva', type: 'aamva', source: 'government_id' };
    const OTP_GUIDANCE = {
      'allowed-countries': ['GB', 'US'],
      'code-length': 6,
      otp: {
        'masked-destination': '+44 •••• ••• 123',
        'expires-at': '2026-10-20T12:10:00.000Z',
        'resend-available-at': '2026-10-20T12:00:30.000Z',
        'sends-remaining': 4,
        'attempts-remaining': 5,
      },
    };
    const OTP_HINT: RetryHint = {
      name: 'phone_number_otp_comparison',
      reasons: ['otp_not_confirmed'],
    };

    function flowWith(...steps: unknown[]): Flow {
      return customFlow([consentStep, ...steps, completionStep]);
    }

    it.each([
      { step: phone, max: 5 },
      { step: email, max: 2 },
      { step: wallet, max: 3 },
      { step: records, max: 1 },
      { step: licenceForm, max: 1 },
    ])('asks for a first attempt of a $step.type step, with $max attempts', ({ step, max }) => {
      expect(position({ consent: true, flow: flowWith(step) })).toEqual({
        kind: 'capture',
        step,
        attempt: 1,
        maxAttempts: max,
        verificationId: null,
        hints: [],
      });
    });

    it('resumes an initiated phone verification with its open code', () => {
      const initiated = flowVerification('phone_number', 'initiated', { guidance: OTP_GUIDANCE });

      expect(
        position({ consent: true, flow: flowWith(phone), verifications: [initiated] }),
      ).toEqual({
        kind: 'capture',
        step: phone,
        attempt: 1,
        maxAttempts: 5,
        verificationId: initiated.id,
        hints: [],
        verification: initiated,
      });
    });

    it.each([
      { step: phone, type: 'phone_number' },
      { step: email, type: 'email_address' },
    ] as const)(
      'submits a confirmed $type verification at once instead of waiting on it (C64.1 resume)',
      ({ step, type }) => {
        const confirmed = flowVerification(type, 'confirmed');

        expect(
          position({ consent: true, flow: flowWith(step), verifications: [confirmed] }),
        ).toEqual({
          kind: 'confirmed',
          step,
          verificationId: confirmed.id,
          attempt: 1,
          maxAttempts: step === phone ? 5 : 2,
        });
      },
    );

    it('waits on a submitted phone verification', () => {
      const submitted = flowVerification('phone_number', 'submitted');

      expect(
        position({ consent: true, flow: flowWith(phone), verifications: [submitted] }),
      ).toEqual({
        kind: 'processing',
        step: phone,
        verificationId: submitted.id,
        attempt: 1,
        maxAttempts: 5,
      });
    });

    it('offers another attempt with its hints after a code was not confirmed', () => {
      expect(
        position({
          consent: true,
          flow: flowWith(phone),
          verifications: [flowVerification('phone_number', 'failed', { hints: [OTP_HINT] })],
        }),
      ).toEqual({
        kind: 'capture',
        step: phone,
        attempt: 2,
        maxAttempts: 5,
        verificationId: null,
        hints: [OTP_HINT],
      });
    });

    it('offers to start again after a canceled wallet attempt (C64.1, C57.2)', () => {
      expect(
        position({
          consent: true,
          flow: flowWith(wallet),
          verifications: [flowVerification('crypto_wallet', 'canceled')],
        }),
      ).toEqual({
        kind: 'capture',
        step: wallet,
        attempt: 2,
        maxAttempts: 3,
        verificationId: null,
        hints: [],
        restarted: true,
      });
    });

    it('waits for the inquiry once the single database attempt has failed', () => {
      expect(
        position({
          consent: true,
          flow: flowWith(records),
          verifications: [flowVerification('database', 'failed')],
        }),
      ).toEqual({ kind: 'finalizing', step: records });
    });

    it.each(['passed', 'skipped', 'needs_review'] as const)(
      'moves on from a %s database verification',
      (status) => {
        expect(
          position({
            consent: true,
            flow: flowWith(records, phone),
            verifications: [flowVerification('database', status)],
          }),
        ).toMatchObject({ kind: 'capture', step: phone, attempt: 1 });
      },
    );

    describe('a silent AAMVA step (C59.6)', () => {
      const flow = flowWith(governmentId, silentAamva, phone);
      const idPassed = flowVerification('government_id', 'passed');

      it.each([
        ['no AAMVA verification yet', []],
        ['an initiated one', [flowVerification('aamva', 'initiated')]],
        ['a submitted one', [flowVerification('aamva', 'submitted')]],
        ['a canceled one', [flowVerification('aamva', 'canceled')]],
      ])('waits on the server with %s, never creating one', (_label, aamva) => {
        expect(position({ consent: true, flow, verifications: [idPassed, ...aamva] })).toEqual({
          kind: 'silent',
          step: silentAamva,
        });
      });

      it.each(['passed', 'skipped', 'needs_review'] as const)(
        'moves on once the server has %s it',
        (status) => {
          expect(
            position({
              consent: true,
              flow,
              verifications: [idPassed, flowVerification('aamva', status)],
            }),
          ).toMatchObject({ kind: 'capture', step: phone });
        },
      );

      it('waits for the inquiry once its attempt has failed: it has no retry', () => {
        expect(
          position({
            consent: true,
            flow,
            verifications: [idPassed, flowVerification('aamva', 'failed')],
          }),
        ).toEqual({ kind: 'finalizing', step: silentAamva });
      });

      it('lets the ID step come first', () => {
        expect(position({ consent: true, flow })).toMatchObject({
          kind: 'capture',
          step: governmentId,
        });
      });
    });
  });

  describe('the document, business registry and business website steps (C64.1, Workflow 5B)', () => {
    const proof = {
      id: 'proof',
      type: 'document',
      documentTypes: ['utility_bill', 'bank_statement'],
      captureMethods: ['upload', 'camera'],
    };
    const business = { id: 'business', type: 'database_business', collectAssociatedPersons: true };
    const website = { id: 'website', type: 'business_website', maxAttempts: 2 };
    /** C52.2: what a document verification's guidance says (synthetic). */
    const DOCUMENT_GUIDANCE = {
      'accepted-types': ['utility_bill', 'bank_statement'],
      'max-age-days': 90,
      'max-pages': 50,
      'accepted-mime-types': ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    };
    const TOO_OLD: RetryHint = {
      name: 'document_recency_detection',
      reasons: ['document_too_old'],
    };

    function flowWith(...steps: unknown[]): Flow {
      return customFlow([consentStep, ...steps, completionStep]);
    }

    it.each([
      { step: proof, max: 3 },
      { step: business, max: 3 },
      { step: website, max: 2 },
    ])('asks for a first attempt of a $step.type step, with $max attempts', ({ step, max }) => {
      expect(position({ consent: true, flow: flowWith(step) })).toEqual({
        kind: 'capture',
        step,
        attempt: 1,
        maxAttempts: max,
        verificationId: null,
        hints: [],
      });
    });

    it('resumes an initiated document verification with its guidance', () => {
      const initiated = flowVerification('document', 'initiated', { guidance: DOCUMENT_GUIDANCE });

      expect(
        position({ consent: true, flow: flowWith(proof), verifications: [initiated] }),
      ).toEqual({
        kind: 'capture',
        step: proof,
        attempt: 1,
        maxAttempts: 3,
        verificationId: initiated.id,
        hints: [],
        verification: initiated,
      });
    });

    it.each([
      { step: business, type: 'database_business' },
      { step: website, type: 'business_website' },
    ] as const)(
      'resumes an initiated $type verification with what it received',
      ({ step, type }) => {
        const initiated = flowVerification(type, 'initiated', { inputsReceived: true });

        expect(
          position({ consent: true, flow: flowWith(step), verifications: [initiated] }),
        ).toMatchObject({
          kind: 'capture',
          step,
          attempt: 1,
          verificationId: initiated.id,
          verification: initiated,
        });
      },
    );

    it('waits on a submitted document verification', () => {
      const submitted = flowVerification('document', 'submitted');

      expect(
        position({ consent: true, flow: flowWith(proof), verifications: [submitted] }),
      ).toEqual({
        kind: 'processing',
        step: proof,
        verificationId: submitted.id,
        attempt: 1,
        maxAttempts: 3,
      });
    });

    it('offers another document attempt with the hints of the one that failed', () => {
      expect(
        position({
          consent: true,
          flow: flowWith(proof),
          verifications: [flowVerification('document', 'failed', { hints: [TOO_OLD] })],
        }),
      ).toEqual({
        kind: 'capture',
        step: proof,
        attempt: 2,
        maxAttempts: 3,
        verificationId: null,
        hints: [TOO_OLD],
      });
    });

    it.each([
      { step: proof, type: 'document', max: 3 },
      { step: business, type: 'database_business', max: 3 },
      { step: website, type: 'business_website', max: 2 },
    ] as const)(
      'starts a new attempt after a canceled $type attempt, so resuming never strands the user',
      ({ step, type, max }) => {
        expect(
          position({
            consent: true,
            flow: flowWith(step),
            verifications: [flowVerification(type, 'canceled')],
          }),
        ).toEqual({
          kind: 'capture',
          step,
          attempt: 2,
          maxAttempts: max,
          verificationId: null,
          hints: [],
        });
      },
    );

    it('waits for the inquiry once the last website attempt has failed', () => {
      expect(
        position({
          consent: true,
          flow: flowWith(website),
          verifications: [
            flowVerification('business_website', 'failed', { id: VERIFICATION_IDS.selfie }),
            flowVerification('business_website', 'failed', { id: VERIFICATION_IDS.selfieRetry }),
          ],
        }),
      ).toEqual({ kind: 'finalizing', step: website });
    });

    it.each([
      { step: proof, type: 'document' },
      { step: business, type: 'database_business' },
      { step: website, type: 'business_website' },
    ] as const)('moves on from a $type verification an operator reviews', ({ step, type }) => {
      const next = { id: 'phone', type: 'phone_otp', allowedCountries: ['GB'] };

      expect(
        position({
          consent: true,
          flow: flowWith(step, next),
          verifications: [flowVerification(type, 'needs_review')],
        }),
      ).toMatchObject({ kind: 'capture', step: next, attempt: 1 });
    });
  });

  describe('the end of the flow', () => {
    it('reaches the completion step once every step has passed', () => {
      expect(
        position({
          consent: true,
          verifications: [
            flowVerification('government_id', 'passed'),
            flowVerification('selfie', 'passed'),
          ],
        }),
      ).toEqual({ kind: 'completion', step: COMPLETION });
    });

    it.each(['completed', 'approved', 'declined', 'needs_review'] as const)(
      'shows completion for a %s inquiry, whatever the steps say',
      (status) => {
        expect(position({ status })).toEqual({ kind: 'completion', step: COMPLETION });
      },
    );

    it('shows the failure step for a failed inquiry', () => {
      expect(
        position({
          status: 'failed',
          consent: true,
          verifications: [flowVerification('government_id', 'failed')],
        }),
      ).toEqual({ kind: 'failure', step: FAILURE });
    });

    it('reports an expired inquiry', () => {
      expect(position({ status: 'expired', consent: true })).toEqual({ kind: 'expired' });
    });

    it('has no step to show when the flow defines no completion or failure step', () => {
      const flow = customFlow([consentStep]);

      expect(position({ status: 'completed', flow })).toEqual({ kind: 'completion', step: null });
      expect(position({ status: 'failed', flow })).toEqual({ kind: 'failure', step: null });
    });

    it('completes when the last step is done and no terminal step follows', () => {
      expect(position({ consent: true, flow: customFlow([consentStep]) })).toEqual({
        kind: 'completion',
        step: null,
      });
    });
  });

  // C151 (Workflow 9A, ADR 0008): the web flow never evaluates or follows a transition. A session
  // without a server position (a server before Phase 9) is read as the v1 projection, in list order;
  // the server owns the path and refuses any step but the current one (C151.4).
  describe('a session without a server position', () => {
    it('never evaluates a transition, even one whose condition would hold', () => {
      const flow = customFlow(
        [consentStep, { id: 'details', type: 'form', fields: [formField()] }, completionStep],
        [
          {
            from: 'consent',
            to: 'done',
            condition: { '==': [{ var: 'inquiry.status' }, 'pending'] },
          },
        ],
      );

      // The list's next step, never the transition's target.
      expect(position({ consent: true, flow })).toMatchObject({
        kind: 'unsupported',
        step: { id: 'details' },
      });
    });

    it('does not follow an unconditional transition either', () => {
      const flow = customFlow(
        [consentStep, { id: 'details', type: 'form', fields: [formField()] }, completionStep],
        [{ from: 'consent', to: 'done' }],
      );

      expect(position({ consent: true, flow })).toMatchObject({
        kind: 'unsupported',
        step: { id: 'details' },
      });
    });

    it('walks a flow without transitions in list order', () => {
      expect(
        position({ consent: true, verifications: [flowVerification('government_id', 'passed')] }),
      ).toMatchObject({ kind: 'capture', step: SELFIE });
    });
  });

  describe('steps this version cannot run', () => {
    // Workflow 10C (C207.10): an nfc step has its own position now (steps/nfc/nfc-step.test.tsx).
    it.each([{ id: 'details', type: 'form', fields: [formField()] }])(
      'stops at a $type step instead of skipping it',
      (step) => {
        const flow = customFlow([consentStep, step, completionStep]);

        expect(position({ consent: true, flow })).toEqual({
          kind: 'unsupported',
          step,
          reason: 'step',
        });
      },
    );

    // C151.6 (owner option (i)): a spec-1 client never skips a projection's placeholder.
    it('stops at a server-continuation placeholder of a projection instead of skipping it', () => {
      const placeholder = { id: 'continue-1', type: 'server-continuation' };
      const flow = customFlow([consentStep, placeholder]);

      expect(position({ consent: true, flow })).toEqual({
        kind: 'unsupported',
        step: placeholder,
        reason: 'step',
      });
    });
  });
});

describe('the device_handoff step (C96.1, F01, Stage 1a minimum)', () => {
  const handoff = { id: 'handoff', type: 'device_handoff' } as const;

  it('keeps a desktop reloaded while the phone works on the step (K7A-5)', () => {
    const flow = customFlow([consentStep, handoff, completionStep]);
    const member = { 'step-id': 'handoff', state: 'redeemed', 'handed-off': true } as const;
    const session = flowSession({ flow, consent: true, handoff: member });

    expect(resolveFlowPosition(session)).toEqual({
      kind: 'handoff',
      step: handoff,
      handoff: member,
    });
  });

  it.each(['redeemed', 'continued_here', 'skipped'] as const)(
    'is done once the handoff is %s, and the flow moves on',
    (state) => {
      const flow = customFlow([consentStep, handoff, completionStep]);
      const session = {
        ...flowSession({ consent: true, flow }),
        handoff: { 'step-id': 'handoff', state },
      };
      expect(resolveFlowPosition(session)).toMatchObject({ kind: 'completion' });
    },
  );

  it.each(['pending', 'issued', 'rejected', 'declined'] as const)(
    'stops at the step while the handoff is %s, in its own slot (Stage 1b (H))',
    (state) => {
      const flow = customFlow([consentStep, handoff, completionStep]);
      const session = {
        ...flowSession({ consent: true, flow }),
        handoff: { 'step-id': 'handoff', state },
      };
      expect(resolveFlowPosition(session)).toEqual({
        kind: 'handoff',
        step: handoff,
        handoff: { 'step-id': 'handoff', state },
      });
    },
  );

  it('stops at the step, with no state, when the server serves none', () => {
    const flow = customFlow([consentStep, handoff, completionStep]);

    expect(resolveFlowPosition(flowSession({ consent: true, flow }))).toEqual({
      kind: 'handoff',
      step: handoff,
      handoff: null,
    });
  });
});

function formField() {
  return { type: 'text', name: 'name_first', labelKey: 'form.name_first', required: true };
}
