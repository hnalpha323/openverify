/**
 * Test support for the one-time code tests (C55): a template with a phone and an email step, a
 * sandbox SMS sender that records what it was asked to send, a limiter a test can make refuse or
 * fail, and helpers that start an inquiry and read a code back from the sink or the mailbox.
 * Only tests import this file; every value is synthetic.
 */
import {
  defaultInquiryTemplateAttributes,
  newId,
  type DefaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import { createTestInquiry } from '@openverify/db/testing';
import type { FlowStep } from '@openverify/flow-spec';
import type { ApiDependencies } from '../context.js';
import type {
  Clock,
  KeyValueCache,
  RateLimitDecision,
  RateLimiter,
  RateLimitRule,
  SandboxSmsContext,
  SandboxSmsSender,
  SmsMessage,
  SmsSender,
} from '../../ports.js';
import { passStepsBefore } from '../../flow-engine/testing.js';
import { createSandboxSmsSender } from '../../providers/sms/sandbox.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  resumeInquiry,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';

/** A synthetic US number in the 555-01xx range, valid for libphonenumber. */
export const TEST_NUMBER = '+12025550100';
/** A synthetic Canadian number in the 555-01xx range. */
export const TEST_CANADIAN_NUMBER = '+16135550123';
/** A synthetic address at an RFC 2606 name. */
export const TEST_ADDRESS = 'avery.synthetic@mail.example.test';

export const CONSENT_BODY = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
} as const;

/** The phone and email steps the OTP tests use. */
export const OTP_STEPS: readonly FlowStep[] = [
  { id: 'phone', type: 'phone_otp', allowedCountries: ['US', 'CA'] },
  { id: 'email', type: 'email_otp' },
];

/** The default template with a phone and an email step before completion. */
export function otpTemplateAttributes(
  steps: readonly FlowStep[] = OTP_STEPS,
): DefaultInquiryTemplateAttributes {
  const attributes = defaultInquiryTemplateAttributes();
  attributes.name = 'Phone and email codes';
  const completion = attributes.flow.steps.findIndex((step) => step.type === 'completion');
  attributes.flow.steps = [
    ...attributes.flow.steps.slice(0, completion),
    ...steps,
    ...attributes.flow.steps.slice(completion),
  ];
  attributes['verification-config'] = {
    ...attributes['verification-config'],
    'phone-number': defaultTemplateConfig('phone_number'),
    'email-address': defaultTemplateConfig('email_address'),
  };
  return attributes;
}

export interface RecordingSmsSender extends SandboxSmsSender {
  /** Every send it was asked for, oldest first. */
  readonly sends: { message: SmsMessage; context: SandboxSmsContext }[];
  /** Makes the next send reject with `error` (nothing reaches the sink). */
  failNext(error: Error): void;
}

/** The sandbox sender over `cache`, recording each send. */
export function recordingSmsSender(cache: KeyValueCache, clock: Clock): RecordingSmsSender {
  const sender = createSandboxSmsSender({ cache, clock });
  const sends: RecordingSmsSender['sends'] = [];
  let failure: Error | undefined;
  return {
    id: sender.id,
    sandbox: true,
    sends,
    failNext: (error) => {
      failure = error;
    },
    send(message, context) {
      sends.push({ message: { ...message }, context: { ...context } });
      const error = failure;
      failure = undefined;
      return error === undefined ? sender.send(message, context) : Promise.reject(error);
    },
  };
}

export interface ControllableLimiter extends RateLimiter {
  /** Every consume, oldest first. */
  readonly calls: { key: string; rule: RateLimitRule }[];
  /** Rule keys that refuse (`<rule name>` or `<rule name>|<key>`), retrying after 75 s. */
  readonly refusing: Set<string>;
  /** Makes every consume reject, as Valkey being down does. */
  down: boolean;
}

/** A limiter that allows everything but what a test tells it to refuse. */
export function controllableLimiter(): ControllableLimiter {
  const calls: ControllableLimiter['calls'] = [];
  const refusing = new Set<string>();
  const limiter: ControllableLimiter = {
    calls,
    refusing,
    down: false,
    consume(key, rule) {
      calls.push({ key, rule: { ...rule } });
      if (limiter.down) {
        return Promise.reject(new Error('Valkey is unavailable (reconnecting)'));
      }
      const refused = refusing.has(rule.name) || refusing.has(`${rule.name}|${key}`);
      const decision: RateLimitDecision = {
        allowed: !refused,
        limit: rule.limit,
        remaining: refused ? 0 : rule.limit,
        resetAt: new Date(0),
        retryAfterSeconds: refused ? 75 : 0,
      };
      return Promise.resolve(decision);
    },
  };
  return limiter;
}

/** The overrides that bind `sms` for sandbox environments and use `limiter`. */
export function otpOverrides(
  options: {
    sms?: (defaults: ApiDependencies) => SmsSender | SandboxSmsSender;
    limiter?: RateLimiter;
  } = {},
) {
  return (defaults: ApiDependencies): Partial<ApiDependencies> => ({
    providers: {
      sandbox: {
        ...defaults.providers.sandbox,
        sms: options.sms?.(defaults) ?? createSandboxSmsSender(defaults),
      },
      production: defaults.providers.production,
    },
    ...(options.limiter === undefined ? {} : { rateLimiter: options.limiter }),
  });
}

export interface OtpTargetOptions {
  /** Record consent first (true by default). */
  consent?: boolean;
  /** The consent's locale (`en` by default). */
  locale?: string;
}

/**
 * A started inquiry of `templateId` with consent recorded and an `initiated` verification of
 * `type`, and its session token.
 */
export async function otpTarget(
  api: TestApi,
  templateId: string,
  type: 'phone_number' | 'email_address',
  options: OtpTargetOptions = {},
) {
  return startedTarget(api, await createInquiry(api, { templateId }), type, options);
}

/**
 * {@link otpTarget} on a template version written straight to the database, as a version
 * published while its channels were bound is stored, so no publish rule runs.
 */
export async function unpublishedOtpTarget(
  api: TestApi,
  type: 'phone_number' | 'email_address',
  options: OtpTargetOptions = {},
  attributes: DefaultInquiryTemplateAttributes = otpTemplateAttributes(),
) {
  const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, {
    flow: attributes.flow,
    verificationConfig: attributes['verification-config'],
  });
  return startedTarget(api, inquiry.id, type, options);
}

async function startedTarget(
  api: TestApi,
  inquiryId: string,
  type: 'phone_number' | 'email_address',
  options: OtpTargetOptions,
) {
  const token = await resumeInquiry(api, inquiryId);
  // C151.4 (Workflow 9A): the steps before the OTP step passed, so it is the current step.
  await passStepsBefore(api, inquiryId, type);
  expectStatus(await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }), 200);
  if (options.consent !== false) {
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/consent',
        headers: bearer(token),
        payload: { ...CONSENT_BODY, locale: options.locale ?? 'en' },
      }),
      201,
    );
  }
  const { id } = await seedVerification(api, api.environmentId, inquiryId, { type });
  return { inquiryId, token, verificationId: id };
}

/** A template of {@link otpTemplateAttributes} created through the API. */
export function createOtpTemplate(api: TestApi, steps?: readonly FlowStep[]) {
  return createTemplate(api, api.token, otpTemplateAttributes(steps));
}

/** `POST .../otp` with `body`. */
export function sendCode(
  api: TestApi,
  token: string,
  verificationId: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${verificationId}/otp`,
    headers: { ...bearer(token), ...headers },
    payload: body,
  });
}

/** `POST .../otp/confirm` with `code`. */
export function confirmCode(api: TestApi, token: string, verificationId: string, code: string) {
  return api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${verificationId}/otp/confirm`,
    headers: bearer(token),
    payload: { code },
  });
}

/** The code of the latest email the mailer captured. */
export function mailedCode(api: TestApi): string {
  const text = api.mailer.messages.at(-1)?.text ?? '';
  const code = /\b(\d{6,10})\b/u.exec(text)?.[1];
  if (code === undefined) {
    throw new Error('no code was mailed');
  }
  return code;
}

/** A code that is not `code`, of the same length. */
export function wrongCode(code: string): string {
  return code.startsWith('9') ? `0${code.slice(1)}` : `9${code.slice(1)}`;
}

/** A synthetic id of an `otpc_` challenge. */
export const newChallengeId = () => newId('otpc');
