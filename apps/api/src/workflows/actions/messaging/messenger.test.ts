/**
 * C126: the messenger, on the rendered message, with recording adapters: who may receive, what a
 * message may hold, the budgets and how they fail, the sandbox lists, and what a step may say of its
 * delivery. No test here sends anything. Every address, number and URL is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { getDefaultKeyring, otpDestinationIndex, updateEnvironmentSettings } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedWorkflowSecret,
  seedWorkflowSecretValue,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSandboxMailer } from '../../../mail/sandbox.js';
import {
  SlackSendError,
  SmsSendError,
  type MailMessage,
  type Mailer,
  type RateLimiter,
  type SlackMessage,
  type SmsMessage,
} from '../../../ports.js';
import { createSlackSender, SLACK_OUTCOME_UNKNOWN } from '../../../providers/slack/index.js';
import { sandboxSmsSinkKey } from '../../../providers/sms/sandbox.js';
import type { ApiDependencies } from '../../../services/context.js';
import {
  createAllowAllRateLimiter,
  createDenyRateLimiter,
  createInMemoryKeyValueCache,
  fixedClock,
  type InMemoryKeyValueCache,
  type RecordingRateLimiter,
} from '../../../test-support/fakes.js';
import { ActionStepError } from '../../engine/action-port.js';
import { createWorkflowMessenger, type WorkflowMessengerDeps } from './messenger.js';
import type {
  WorkflowEmailMessage,
  WorkflowMessage,
  WorkflowMessageContext,
  WorkflowSlackMessage,
  WorkflowSmsMessage,
} from './port.js';
import {
  sandboxMessageListKey,
  searchSandboxEmailMessages,
  searchSandboxSlackMessages,
  searchSandboxWorkflowSmsMessages,
} from './sandbox-messages.js';

const NOW = new Date('2026-11-02T12:00:00.000Z');
const clock = fixedClock(NOW);
const blindIndexKey = randomBytes(32);
const PERSON = 'person@example.com';
const PHONE = '+12025550123';
const SLACK_URL = 'https://hooks.slack.com/services/T000/B000/changeme';
const RUN = 'wfr_01M5CK16P0D13FXHZSS4TCFBVH';

let database: TestDatabase;
let sandbox: { organizationId: string; environmentId: string };
let production: { organizationId: string; environmentId: string };
let cache: InMemoryKeyValueCache;
let limiter: RecordingRateLimiter;
let mailed: MailMessage[];
let texts: SmsMessage[];
let slacked: SlackMessage[];
let mailFailure: Error | undefined;
let smsFailure: Error | undefined;
let slackFailure: Error | undefined;

const tenantOf = async (kind: 'sandbox' | 'production') => {
  const { organization, environment } = await createTestTenant(database.db, { kind });
  return { organizationId: organization.id, environmentId: environment.id };
};

beforeAll(async () => {
  database = await createTestDatabase();
  sandbox = await tenantOf('sandbox');
  production = await tenantOf('production');
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  cache = createInMemoryKeyValueCache(clock);
  limiter = createAllowAllRateLimiter(clock);
  mailed = [];
  texts = [];
  slacked = [];
  mailFailure = undefined;
  smsFailure = undefined;
  slackFailure = undefined;
});

const smtp = (configured = true): Mailer => ({
  configured,
  send(message) {
    if (mailFailure !== undefined) {
      return Promise.reject(mailFailure);
    }
    mailed.push(message);
    return Promise.resolve();
  },
});

const realSms = {
  id: 'twilio',
  sandbox: false as const,
  send(message: SmsMessage) {
    if (smsFailure !== undefined) {
      return Promise.reject(smsFailure);
    }
    texts.push(message);
    return Promise.resolve({ providerMessageId: 'SM-synthetic' });
  },
};

const realSlack = {
  id: 'incoming-webhook',
  sandbox: false as const,
  send(message: SlackMessage) {
    if (slackFailure !== undefined) {
      return Promise.reject(slackFailure);
    }
    slacked.push(message);
    return Promise.resolve({});
  },
};

function messengerOf(more: Partial<WorkflowMessengerDeps> = {}) {
  return createWorkflowMessenger({
    db: database.db,
    keyring: getDefaultKeyring(),
    blindIndexKey,
    providers: {
      sandbox: {
        sms: {
          id: 'sandbox',
          sandbox: true,
          send: () => Promise.reject(new Error('the OTP sink')),
        },
        slack: createSlackSender('sandbox', { cache, clock }),
      },
      production: { sms: realSms, slack: realSlack },
    },
    mail: { sandbox: createSandboxMailer({ cache, clock }), production: smtp() },
    rateLimiter: limiter,
    cache,
    clock,
    ...more,
  });
}

const contextOf = (
  tenant: { organizationId: string; environmentId: string },
  kind: 'sandbox' | 'production',
  more: Partial<WorkflowMessageContext> = {},
): WorkflowMessageContext => ({
  ...tenant,
  environmentKind: kind,
  effect: { runId: RUN, stepId: 'wfst_1', effectKey: `${RUN}/send/` },
  flowLink: 'https://flow.example.test',
  scrub: [],
  ...more,
});

const inSandbox = (more: Partial<WorkflowMessageContext> = {}) =>
  contextOf(sandbox, 'sandbox', more);
const inProduction = (more: Partial<WorkflowMessageContext> = {}) =>
  contextOf(production, 'production', more);

const email = (more: Partial<WorkflowEmailMessage> = {}): WorkflowEmailMessage => ({
  kind: 'email',
  to: PERSON,
  basis: 'confirmed',
  allowUnconfirmed: false,
  subject: 'Your review',
  text: 'Your review is ready.',
  html: null,
  ...more,
});

const sms = (more: Partial<WorkflowSmsMessage> = {}): WorkflowSmsMessage => ({
  kind: 'sms',
  to: PHONE,
  basis: 'confirmed',
  allowUnconfirmed: false,
  text: 'Your review is ready.',
  templateCountries: ['US'],
  ...more,
});

const slack = (secretKey: string, text = 'A review is ready.'): WorkflowSlackMessage => ({
  kind: 'slack',
  secretKey,
  text,
});

async function refusal(
  message: WorkflowMessage,
  context: WorkflowMessageContext,
  more: Partial<WorkflowMessengerDeps> = {},
): Promise<ActionStepError> {
  try {
    await messengerOf(more).send(message, context);
  } catch (error) {
    if (error instanceof ActionStepError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

const settings = (
  tenant: { environmentId: string },
  changes: Parameters<typeof updateEnvironmentSettings>[2],
) => updateEnvironmentSettings(database.db, tenant.environmentId, changes);

const nothingWentOut = () => {
  expect(mailed).toEqual([]);
  expect(texts).toEqual([]);
  expect(slacked).toEqual([]);
};

describe('email: the sender name (C169.8, K9-25)', () => {
  it('sends from the environment’s mail-sender-name', async () => {
    const named = await tenantOf('production');
    await settings(named, { 'mail-sender-name': 'Synthetic Bank' });

    await messengerOf().send(email(), contextOf(named, 'production'));

    expect(mailed.map(({ senderName }) => senderName)).toEqual(['Synthetic Bank']);
  });
});

describe('email: who may receive (C126.1)', () => {
  it('sends to a confirmed address in production, and says accepted, never sent', async () => {
    const output = await messengerOf().send(email(), inProduction());

    expect(output).toEqual({
      delivery: 'accepted',
      provider: 'smtp',
      sandbox: false,
      'message-ref': null,
    });
    expect(mailed).toEqual([
      {
        to: { address: PERSON },
        subject: 'Your review',
        text: 'Your review is ready.',
      },
    ]);
  });

  it('refuses an unconfirmed field without the step’s option', async () => {
    const error = await refusal(email({ basis: 'unconfirmed' }), inProduction());

    expect(error.code).toBe('recipient_not_allowed');
    nothingWentOut();
  });

  it('takes an unconfirmed field with the acknowledged option', async () => {
    const output = await messengerOf().send(
      email({ basis: 'unconfirmed', allowUnconfirmed: true }),
      inProduction(),
    );

    expect(output.delivery).toBe('accepted');
  });

  it('refuses a literal address off the allowlist, whatever the option says', async () => {
    const error = await refusal(
      email({ basis: 'literal', allowUnconfirmed: true }),
      inProduction(),
    );

    expect(error.code).toBe('recipient_not_allowed');
  });

  it.each(['person@example.com', 'PERSON@example.com', 'example.com', 'EXAMPLE.COM'])(
    'takes a literal address when %s is on the allowlist',
    async (entry) => {
      await settings(production, { 'workflow-email-recipients': [entry] });

      const output = await messengerOf().send(email({ basis: 'literal' }), inProduction());

      expect(output.delivery).toBe('accepted');
      await settings(production, { 'workflow-email-recipients': [] });
    },
  );

  it('never reads a suffix-extended domain as the listed one', async () => {
    await settings(production, { 'workflow-email-recipients': ['example.com'] });

    const error = await refusal(
      email({ basis: 'literal', to: 'person@example.com.evil.example' }),
      inProduction(),
    );

    expect(error.code).toBe('recipient_not_allowed');
    await settings(production, { 'workflow-email-recipients': [] });
  });

  it.each(['not an address', 'a@b@example.com', 'person@[192.0.2.1]'])('refuses %s', async (to) => {
    expect((await refusal(email({ to }), inProduction())).code).toBe('recipient_not_allowed');
  });
});

describe('email: what it may hold (C126.1)', () => {
  it('removes CR and LF from the subject', async () => {
    await messengerOf().send(email({ subject: 'One\r\nBcc: x@example.com' }), inProduction());

    expect(mailed[0]?.subject).toBe('OneBcc: x@example.com');
  });

  it.each([
    ['subject', { subject: 'x'.repeat(201) }],
    ['text', { text: 'x'.repeat(32 * 1024 + 1) }],
    ['html', { html: 'x'.repeat(64 * 1024 + 1) }],
  ])('refuses a %s past its cap', async (_name, more) => {
    const error = await refusal(email(more), inProduction());

    expect(error.code).toBe('payload_too_large');
    nothingWentOut();
  });

  it.each([
    ['subject', { subject: 'See https://evil.example/' }],
    ['text', { text: 'See evil.example now' }],
    ['html', { html: '<a href="https://evil.example/">Open</a>' }],
  ])('refuses a link in its %s', async (_name, more) => {
    const error = await refusal(email(more), inProduction());

    expect(error.code).toBe('message_link_refused');
    nothingWentOut();
  });

  it('takes a link to the flow’s host, and to a listed host', async () => {
    await settings(production, { 'workflow-link-hosts': ['links.example.com'] });

    const output = await messengerOf().send(
      email({ text: 'See https://flow.example.test/a and https://links.example.com/b' }),
      inProduction(),
    );

    expect(output.delivery).toBe('accepted');
    await settings(production, { 'workflow-link-hosts': [] });
  });
});

describe('email: budgets (C126.1, P31, V12)', () => {
  it('counts the recipient, the environment and the install, in that order', async () => {
    await messengerOf().send(email(), inProduction());

    expect(limiter.calls.map(({ policy }) => policy)).toEqual([
      { name: 'workflow-email-recipient-hour', limit: 5, windowSeconds: 3_600 },
      { name: 'workflow-email-recipient-day', limit: 20, windowSeconds: 86_400 },
      { name: 'workflow-email', limit: 1_000, windowSeconds: 3_600 },
      { name: 'workflow-email-install', limit: 20, windowSeconds: 86_400 },
    ]);
  });

  it('keys no address, and one key across environments for the install rule', async () => {
    await messengerOf().send(email(), inProduction());
    await messengerOf().send(email(), inSandbox());

    expect(JSON.stringify(limiter.calls)).not.toContain('example.com');
    const install = limiter.calls
      .filter(({ policy }) => policy.name === 'workflow-email-install')
      .map(({ key }) => key);
    expect(new Set(install).size).toBe(1);
    const perEnvironment = limiter.calls
      .filter(({ policy }) => policy.name === 'workflow-email-recipient-hour')
      .map(({ key }) => key);
    expect(new Set(perEnvironment).size).toBe(2);
  });

  it('refuses past a rule, with the time to wait', async () => {
    const error = await refusal(email(), inProduction(), {
      rateLimiter: createDenyRateLimiter(42, clock),
    });

    expect(error.code).toBe('rate_limited');
    expect(error.options).toEqual({ retryable: true, retryAfterSeconds: 42 });
    nothingWentOut();
  });

  it('fails closed when the store is down', async () => {
    const down: RateLimiter = { consume: () => Promise.reject(new Error('down')) };

    const error = await refusal(email(), inProduction(), { rateLimiter: down });

    expect(error.code).toBe('rate_limited');
    nothingWentOut();
  });

  it('never counts a message the rules refused', async () => {
    await refusal(email({ basis: 'unconfirmed' }), inProduction());

    expect(limiter.calls).toEqual([]);
  });
});

describe('email: delivery (C126.5)', () => {
  const smtpError = (fields: Record<string, unknown>) =>
    Object.assign(new Error('smtp said no to person@example.com'), fields);

  it.each([
    ['a refused connection', { code: 'ECONNREFUSED', command: 'CONN' }],
    ['a name that did not resolve', { code: 'EDNS', command: 'CONN' }],
    ['a 4xx before DATA', { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 450 }],
    ['a 4xx at MAIL FROM', { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 451 }],
  ])('retries %s: proof of non-delivery', async (_name, fields) => {
    mailFailure = smtpError(fields);

    const error = await refusal(email(), inProduction());

    expect(error.code).toBe('smtp_unavailable');
    expect(error.options.retryable).toBe(true);
  });

  it('fails a 5xx before DATA, which no retry can change', async () => {
    mailFailure = smtpError({ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550 });

    const error = await refusal(email(), inProduction());

    expect(error.code).toBe('smtp_rejected');
    expect(error.options.retryable).toBeUndefined();
  });

  it.each([
    ['a timeout', { code: 'ETIMEDOUT', command: 'DATA' }],
    ['a connection lost', { code: 'ECONNECTION', command: 'CONN' }],
    ['a 4xx after DATA', { code: 'EMESSAGE', command: 'DATA', responseCode: 451 }],
    ['a 5xx after DATA', { code: 'EMESSAGE', command: 'DATA', responseCode: 554 }],
    ['anything else', {}],
  ])('reads %s as unknown, never as sent or failed', async (_name, fields) => {
    mailFailure = smtpError(fields);

    await expect(messengerOf().send(email(), inProduction())).resolves.toEqual({
      delivery: 'unknown',
      provider: 'smtp',
      sandbox: false,
      'message-ref': null,
    });
  });

  it('answers provider_not_configured with no SMTP server in production', async () => {
    const mail = { sandbox: createSandboxMailer({ cache, clock }), production: smtp(false) };

    expect((await refusal(email(), inProduction(), { mail })).code).toBe('provider_not_configured');
  });
});

describe('email in a sandbox (C126.4, decision 40)', () => {
  it('records and sends nothing', async () => {
    const output = await messengerOf().send(email(), inSandbox());

    expect(output).toMatchObject({ delivery: 'recorded', provider: 'sandbox', sandbox: true });
    expect(output['message-ref']).toMatch(/^msg_[0-9a-f]{32}$/);
    expect(mailed).toEqual([]);
    const { data } = await searchSandboxEmailMessages(
      { cache, blindIndexKey } as unknown as ApiDependencies,
      sandbox.environmentId,
      { 'email-address': PERSON },
    );
    expect(data).toMatchObject([
      {
        'message-ref': output['message-ref'],
        'workflow-run-id': RUN,
        'step-id': 'wfst_1',
        'message-subject': 'Your review',
      },
    ]);
  });

  it('delivers for real to an address on the allowlist', async () => {
    await settings(sandbox, { 'workflow-email-recipients': [PERSON] });

    const output = await messengerOf().send(email(), inSandbox());

    expect(output).toMatchObject({ delivery: 'accepted', provider: 'smtp', sandbox: false });
    expect(mailed).toHaveLength(1);
    await settings(sandbox, { 'workflow-email-recipients': [] });
  });

  it('records with no SMTP server, whatever the allowlist says', async () => {
    await settings(sandbox, { 'workflow-email-recipients': [PERSON] });
    const mail = { sandbox: createSandboxMailer({ cache, clock }), production: smtp(false) };

    const output = await messengerOf({ mail }).send(email(), inSandbox());

    expect(output.delivery).toBe('recorded');
    await settings(sandbox, { 'workflow-email-recipients': [] });
  });

  it('holds no one-time token in its record (P32)', async () => {
    const token = 'canary-one-time-token';
    const link = `https://flow.example.test/start?token=${token}`;

    await messengerOf().send(email({ text: `Open ${link}` }), inSandbox({ scrub: [token] }));

    const { data } = await searchSandboxEmailMessages(
      { cache, blindIndexKey } as unknown as ApiDependencies,
      sandbox.environmentId,
      { 'email-address': PERSON },
    );
    expect(JSON.stringify(data)).not.toContain(token);
    expect(data[0]?.['message-text']).toContain('[REDACTED]');
  });

  it('says what it could not record, and claims nothing', async () => {
    const mail = { sandbox: createSandboxMailer({ clock }), production: smtp() };

    const error = await refusal(email(), inSandbox(), { mail });

    expect(error.code).toBe('sandbox_sink_unavailable');
    expect(error.options.retryable).toBe(true);
  });
});

describe('sms: who may receive (C126.2)', () => {
  it('sends to a confirmed number in an allowed country', async () => {
    const output = await messengerOf().send(sms(), inProduction());

    expect(output).toEqual({
      delivery: 'accepted',
      provider: 'twilio',
      sandbox: false,
      'message-ref': 'SM-synthetic',
    });
    expect(texts).toEqual([{ to: PHONE, body: 'Your review is ready.' }]);
  });

  it('reads the countries from the setting over the template', async () => {
    await settings(production, { 'workflow-sms-countries': ['GB'] });

    const error = await refusal(sms(), inProduction());

    expect(error.code).toBe('recipient_not_allowed');
    await settings(production, { 'workflow-sms-countries': null });
  });

  it.each([
    ['a country the template refuses', { templateCountries: ['GB'] }],
    ['no inquiry template in scope', { templateCountries: null }],
    ['an unconfirmed field', { basis: 'unconfirmed' as const }],
    ['a literal off the allowlist', { basis: 'literal' as const, allowUnconfirmed: true }],
    ['no number', { to: 'not a number' }],
  ])('refuses %s', async (_name, more) => {
    expect((await refusal(sms(more), inProduction())).code).toBe('recipient_not_allowed');
    nothingWentOut();
  });

  it('takes an unconfirmed field with the acknowledged option', async () => {
    const output = await messengerOf().send(
      sms({ basis: 'unconfirmed', allowUnconfirmed: true }),
      inProduction(),
    );

    expect(output.delivery).toBe('accepted');
  });

  it('takes a literal on the allowlist', async () => {
    await settings(production, { 'workflow-sms-recipients': [PHONE] });

    const output = await messengerOf().send(sms({ basis: 'literal' }), inProduction());

    expect(output.delivery).toBe('accepted');
    await settings(production, { 'workflow-sms-recipients': [] });
  });
});

describe('sms: what it may hold (C126.2)', () => {
  it('refuses past 480 characters', async () => {
    expect((await refusal(sms({ text: 'x'.repeat(481) }), inProduction())).code).toBe(
      'payload_too_large',
    );
  });

  it('refuses any URL', async () => {
    expect(
      (await refusal(sms({ text: 'Open https://flow.example.test/x' }), inProduction())).code,
    ).toBe('message_link_refused');
  });

  it('takes the inquiry’s own flow link, and a listed host', async () => {
    const link = 'https://flow.example.test/start?token=abc';
    await settings(production, { 'workflow-link-hosts': ['links.example.com'] });

    const output = await messengerOf().send(
      sms({ text: `Open ${link} or https://links.example.com/a` }),
      inProduction({ flowLink: link }),
    );

    expect(output.delivery).toBe('accepted');
    await settings(production, { 'workflow-link-hosts': [] });
  });
});

describe('sms: budgets (C126.2)', () => {
  it('consumes the C55.7 rules, and at most half the hourly budget', async () => {
    await settings(production, { 'otp-sms-max-per-hour': 100 });

    await messengerOf().send(sms(), inProduction());

    const env = production.environmentId;
    const index = otpDestinationIndex(blindIndexKey, {
      environmentId: env,
      channel: 'sms',
      destination: PHONE,
    });
    expect(limiter.calls.map(({ key, policy }) => [policy.name, key, policy.limit])).toEqual([
      ['otp-destination-hour', `${env}|destination|${index}`, 5],
      ['otp-destination-day', `${env}|destination|${index}`, 10],
      ['otp-sms-prefix-hour', `${env}|prefix|12025550`, 20],
      ['otp-sms-country-hour', `${env}|country|US`, 50],
      ['otp-sms-max-per-hour', `${env}|workflow-budget`, 50],
      ['otp-sms-max-per-hour', `${env}|budget`, 100],
    ]);
    await settings(production, { 'otp-sms-max-per-hour': 200 });
  });

  it('keys no number', async () => {
    await messengerOf().send(sms(), inProduction());

    expect(JSON.stringify(limiter.calls.map(({ key }) => key))).not.toContain(PHONE);
  });

  it('fails closed when the store is down', async () => {
    const down: RateLimiter = { consume: () => Promise.reject(new Error('down')) };

    expect((await refusal(sms(), inProduction(), { rateLimiter: down })).code).toBe('rate_limited');
    nothingWentOut();
  });
});

describe('sms: delivery (C126.5)', () => {
  it.each(['twilio_rate_limited', 'twilio_dns'])(
    'retries %s: proof of non-delivery',
    async (code) => {
      smsFailure = new SmsSendError(code, { retryable: true });

      const error = await refusal(sms(), inProduction());

      expect(error.code).toBe(code);
      expect(error.options.retryable).toBe(true);
    },
  );

  it.each(['twilio_rejected', 'twilio_blocked', 'twilio_redirect'])('fails %s', async (code) => {
    smsFailure = new SmsSendError(code, { retryable: false });

    const error = await refusal(sms(), inProduction());

    expect(error.code).toBe(code);
    expect(error.options.retryable).toBeUndefined();
  });

  it.each(['twilio_timeout', 'twilio_network', 'twilio_unavailable', 'twilio_too_large'])(
    'reads %s as unknown',
    async (code) => {
      smsFailure = new SmsSendError(code, { retryable: true });

      await expect(messengerOf().send(sms(), inProduction())).resolves.toEqual({
        delivery: 'unknown',
        provider: 'twilio',
        sandbox: false,
        'message-ref': null,
      });
    },
  );

  it('answers provider_not_configured with no binding', async () => {
    const error = await refusal(sms(), inProduction(), {
      providers: { sandbox: {}, production: {} },
    });

    expect(error.code).toBe('provider_not_configured');
  });

  it('records a sandbox provider’s message in its own list, never the OTP sink', async () => {
    const output = await messengerOf().send(sms(), inSandbox());

    expect(output).toMatchObject({ delivery: 'recorded', provider: 'sandbox', sandbox: true });
    expect(await cache.listRange(sandboxSmsSinkKey(sandbox.environmentId), 10)).toEqual([]);
    const { data } = await searchSandboxWorkflowSmsMessages(
      { cache, blindIndexKey } as unknown as ApiDependencies,
      sandbox.environmentId,
      { 'phone-number': PHONE },
    );
    expect(data).toMatchObject([{ 'message-text': 'Your review is ready.' }]);
    const raw = await cache.listRange(
      sandboxMessageListKey(sandbox.environmentId, 'workflow-sms'),
      10,
    );
    expect(raw.join()).not.toContain(PHONE);
    expect(raw.join()).not.toContain('Your review');
  });
});

describe('slack (C126.3)', () => {
  let counter = 0;

  async function secret(
    tenant: { organizationId: string; environmentId: string },
    value = SLACK_URL,
    hosts: readonly string[] = ['hooks.slack.com'],
  ) {
    counter += 1;
    const key = `slack_hook_${String(counter)}`;
    const { id } = await seedWorkflowSecret(database.db, tenant.organizationId, {
      key,
      allowedHosts: hosts,
    });
    await seedWorkflowSecretValue(database.db, {
      organizationId: tenant.organizationId,
      environmentId: tenant.environmentId,
      secretId: id,
      value,
    });
    return { key, id };
  }

  it('posts to the secret’s URL, and the output names no URL', async () => {
    const { key } = await secret(production);

    const output = await messengerOf().send(slack(key), inProduction());

    expect(output).toEqual({
      delivery: 'accepted',
      provider: 'incoming-webhook',
      sandbox: false,
      'message-ref': null,
    });
    expect(slacked).toEqual([{ webhookUrl: SLACK_URL, text: 'A review is ready.' }]);
  });

  it('limits one a second with a burst of three, per secret, failing closed', async () => {
    const { key, id } = await secret(production);

    await messengerOf().send(slack(key), inProduction());

    expect(limiter.calls).toEqual([
      {
        key: `${production.environmentId}|${id}`,
        policy: { name: 'workflow-slack', limit: 3, windowSeconds: 3 },
      },
    ]);
    const down: RateLimiter = { consume: () => Promise.reject(new Error('down')) };
    expect((await refusal(slack(key), inProduction(), { rateLimiter: down })).code).toBe(
      'rate_limited',
    );
  });

  it.each([
    ['another host', 'https://hooks.slack.com.evil.example/services/T000/B000/changeme'],
    ['plain http', 'http://hooks.slack.com/services/T000/B000/changeme'],
    ['another path', 'https://hooks.slack.com/workflows/T000/B000/changeme'],
    ['a lower-case team', 'https://hooks.slack.com/services/t000/B000/changeme'],
    ['a query', 'https://hooks.slack.com/services/T000/B000/changeme?x=1'],
    ['no URL', 'not a url'],
  ])('refuses a value that is %s', async (_name, value) => {
    const { key } = await secret(production, value);

    expect((await refusal(slack(key), inProduction())).code).toBe('secret_placement_refused');
    nothingWentOut();
  });

  it('refuses a secret not bound to hooks.slack.com', async () => {
    const { key } = await secret(production, SLACK_URL, ['api.example.com']);

    expect((await refusal(slack(key), inProduction())).code).toBe('secret_placement_refused');
  });

  it('refuses a key with no secret', async () => {
    expect((await refusal(slack('no_such_key'), inProduction())).code).toBe(
      'secret_placement_refused',
    );
  });

  it('refuses a key of another organisation', async () => {
    const { key } = await secret(sandbox);

    expect((await refusal(slack(key), inProduction())).code).toBe('secret_placement_refused');
  });

  it('refuses past 3,000 characters', async () => {
    const { key } = await secret(production);

    expect((await refusal(slack(key, 'x'.repeat(3_001)), inProduction())).code).toBe(
      'payload_too_large',
    );
  });

  it('answers provider_not_configured with no binding', async () => {
    const { key } = await secret(production);

    const error = await refusal(slack(key), inProduction(), {
      providers: { sandbox: {}, production: {} },
    });

    expect(error.code).toBe('provider_not_configured');
  });

  it('maps a Slack code to the step’s error, no retry', async () => {
    const { key } = await secret(production);
    slackFailure = new SlackSendError('slack_channel_not_found', { retryable: false });

    const error = await refusal(slack(key), inProduction());

    expect(error.code).toBe('slack_channel_not_found');
    expect(error.options.retryable).toBeUndefined();
  });

  it('honours Retry-After on a 429', async () => {
    const { key } = await secret(production);
    slackFailure = new SlackSendError('slack_rate_limited', {
      retryable: true,
      retryAfterSeconds: 30,
    });

    const error = await refusal(slack(key), inProduction());

    expect(error.options).toEqual({ retryable: true, retryAfterSeconds: 30 });
  });

  it('reads an unknown outcome as unknown', async () => {
    const { key } = await secret(production);
    slackFailure = new SlackSendError(SLACK_OUTCOME_UNKNOWN, { retryable: false });

    await expect(messengerOf().send(slack(key), inProduction())).resolves.toMatchObject({
      delivery: 'unknown',
    });
  });

  it('records a sandbox message by secret id, and never the URL', async () => {
    const { key, id } = await secret(sandbox);

    const output = await messengerOf().send(slack(key), inSandbox());

    expect(output).toMatchObject({ delivery: 'recorded', provider: 'sandbox', sandbox: true });
    const { data } = await searchSandboxSlackMessages(
      { cache, blindIndexKey } as unknown as ApiDependencies,
      sandbox.environmentId,
      { 'secret-id': id },
    );
    expect(data).toMatchObject([{ 'message-text': 'A review is ready.' }]);
    const raw = await cache.listRange(sandboxMessageListKey(sandbox.environmentId, 'slack'), 10);
    expect(raw.join()).not.toContain('hooks.slack.com');
  });

  it('holds a signing key out of a sandbox record too: a reused sink never sees the URL', async () => {
    const { key } = await secret(sandbox);

    await messengerOf().send(slack(key), inSandbox());

    expect(slacked).toEqual([]);
  });
});

describe('beforeSend (C121.4)', () => {
  it('runs after every check, right before the message goes', async () => {
    const order: string[] = [];

    await messengerOf().send(email(), {
      ...inProduction(),
      beforeSend: () => {
        order.push(`audited after ${String(limiter.calls.length)} budget calls`);
        return Promise.resolve();
      },
    });

    expect(order).toEqual(['audited after 4 budget calls']);
  });

  it('never runs for a refused message', async () => {
    let audited = false;

    await refusal(email({ basis: 'unconfirmed' }), {
      ...inProduction(),
      beforeSend: () => {
        audited = true;
        return Promise.resolve();
      },
    });

    expect(audited).toBe(false);
  });
});

describe('a message no run sends (C126.8)', () => {
  it('needs no effect', async () => {
    const output = await messengerOf().send(email(), inProduction({ effect: null }));

    expect(output.delivery).toBe('accepted');
  });
});
