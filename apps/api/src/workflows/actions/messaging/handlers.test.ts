/**
 * C126: Send Email, Send SMS and Send Slack Message from claim to completion, over the real messenger
 * and the sandbox lists on a real schema. Nothing is sent. Every address and URL is synthetic.
 */
import { randomBytes } from 'node:crypto';
import {
  createVerification,
  getDefaultKeyring,
  listWorkflowRunEffects,
  openWorkflowStepValues,
  updateEnvironmentSettings,
} from '@openverify/db';
import {
  createTestInquiry,
  seedOtpChallenge,
  seedWorkflowSecret,
  seedWorkflowSecretValue,
  testId,
} from '@openverify/db/testing';
import type { JsonRecord } from '@openverify/workflow-engine';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSandboxMailer } from '../../../mail/sandbox.js';
import type { RateLimiter, SlackMessage } from '../../../ports.js';
import { SlackSendError } from '../../../ports.js';
import { createSlackSender, SLACK_OUTCOME_UNKNOWN } from '../../../providers/slack/index.js';
import type { ApiDependencies } from '../../../services/context.js';
import {
  createAllowAllRateLimiter,
  createInMemoryKeyValueCache,
  fixedClock,
  type InMemoryKeyValueCache,
} from '../../../test-support/fakes.js';
import {
  action,
  chain,
  createEngineHarness,
  drain,
  runOf,
  start,
  stepOf,
  type EngineHarness,
} from '../../engine/testing.js';
import { EGRESS_ACTION_HANDLERS } from './egress-handlers.js';
import { createWorkflowMessenger } from './messenger.js';
import {
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
const GRANT = { scopes: [], pii: true };

let harness: EngineHarness;
let cache: InMemoryKeyValueCache;
let limiter: RateLimiter;

const PHONE_FLOW = {
  'schema-version': 1,
  steps: [{ type: 'phone_otp', allowedCountries: ['US'] }],
};

function bind(slack?: {
  send(message: SlackMessage): Promise<object>;
  sandbox: false;
  id: string;
}) {
  const mail = {
    sandbox: createSandboxMailer({ cache, clock }),
    production: { configured: false, send: () => Promise.reject(new Error('unused')) },
  };
  Object.assign(harness.deps.services, {
    cache,
    clock,
    blindIndexKey,
    rateLimiter: limiter,
    flowPublicUrl: 'https://flow.example.test',
    messenger: createWorkflowMessenger({
      db: harness.db,
      keyring: getDefaultKeyring(),
      blindIndexKey,
      providers: {
        sandbox: {
          sms: { id: 'sandbox', sandbox: true, send: () => Promise.reject(new Error('OTP sink')) },
          slack: slack ?? createSlackSender('sandbox', { cache, clock }),
        },
        production: {},
      },
      mail,
      rateLimiter: limiter,
      cache,
      clock,
    }),
  });
}

beforeAll(async () => {
  harness = await createEngineHarness(EGRESS_ACTION_HANDLERS);
}, 120_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(() => {
  cache = createInMemoryKeyValueCache(clock);
  limiter = createAllowAllRateLimiter(clock);
  bind();
});

const deps = () => ({ cache, blindIndexKey }) as unknown as ApiDependencies;

/** An inquiry with `destination` confirmed by a code. */
async function confirmedInquiry(channel: 'email' | 'sms', destination: string) {
  const { inquiry } = await createTestInquiry(harness.db, harness.environmentId, {
    flow: PHONE_FLOW,
  });
  const verification = await createVerification(harness.db, harness.environmentId, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: channel === 'email' ? 'email_address' : 'phone_number',
  });
  await harness.database.client.query(`update verifications set status = 'passed' where id = $1`, [
    verification.id,
  ]);
  await seedOtpChallenge(harness.db, harness.environmentId, {
    verificationId: verification.id,
    inquiryId: inquiry.id,
    channel,
    destination,
    status: 'confirmed',
    confirmedAt: NOW,
  });
  return inquiry;
}

async function runStep(
  key: string,
  config: Record<string, unknown>,
  trigger: JsonRecord = { id: 'acc_01M5CK16P0D13FXHZSS4TCFBVH' },
) {
  const id = await start(harness, chain([action('send', key, config)]), { grant: GRANT, trigger });
  await drain(harness);
  const row = await runOf(harness, id);
  const step = await stepOf(harness, id, 'send');
  return { id, row, step, values: openWorkflowStepValues(step) };
}

const emailConfig = (more: Record<string, unknown> = {}) => ({
  recipient: '{{ trigger.email }}',
  subject: 'Your review',
  text: 'Your review is ready.',
  ...more,
});

describe('Send Email (C126.1)', () => {
  it('records for the address the run’s inquiry confirmed, and never says sent', async () => {
    const inquiry = await confirmedInquiry('email', PERSON);

    const { step, values } = await runStep('send_email', emailConfig(), {
      id: inquiry.id,
      email: PERSON,
    });

    expect(step.status).toBe('succeeded');
    expect(values.output).toMatchObject({
      delivery: 'recorded',
      provider: 'sandbox',
      sandbox: true,
    });
    const { data } = await searchSandboxEmailMessages(deps(), harness.environmentId, {
      'email-address': PERSON,
    });
    expect(data).toHaveLength(1);
  });

  it('refuses an address the run never confirmed', async () => {
    const inquiry = await confirmedInquiry('email', PERSON);

    const { step, row } = await runStep('send_email', emailConfig(), {
      id: inquiry.id,
      email: 'other@example.com',
    });

    expect(step.errorCode).toBe('recipient_not_allowed');
    expect(row.status).toBe('errored');
  });

  it('takes an unconfirmed field with allow-unconfirmed', async () => {
    const { step } = await runStep('send_email', emailConfig({ 'allow-unconfirmed': true }), {
      id: 'acc_01M5CK16P0D13FXHZSS4TCFBVH',
      email: 'other@example.com',
    });

    expect(step.status).toBe('succeeded');
  });

  it('refuses a literal off the allowlist, even with allow-unconfirmed', async () => {
    const { step } = await runStep(
      'send_email',
      emailConfig({ recipient: PERSON, 'allow-unconfirmed': true }),
    );

    expect(step.errorCode).toBe('recipient_not_allowed');
  });

  it('takes a literal on the allowlist', async () => {
    await updateEnvironmentSettings(harness.db, harness.environmentId, {
      'workflow-email-recipients': ['example.com'],
    });

    const { step } = await runStep('send_email', emailConfig({ recipient: PERSON }));

    expect(step.status).toBe('succeeded');
    await updateEnvironmentSettings(harness.db, harness.environmentId, {
      'workflow-email-recipients': [],
    });
  });

  it('refuses a URL a value carried in, on the rendered message', async () => {
    const inquiry = await confirmedInquiry('email', PERSON);

    const { step } = await runStep(
      'send_email',
      emailConfig({ text: 'Hello {{ trigger.name }}' }),
      { id: inquiry.id, email: PERSON, name: 'https://evil.example/' },
    );

    expect(step.errorCode).toBe('message_link_refused');
  });

  it('escapes every value in its HTML', async () => {
    const inquiry = await confirmedInquiry('email', PERSON);

    await runStep('send_email', emailConfig({ html: '<p>Hello {{ trigger.name }}</p>' }), {
      id: inquiry.id,
      email: PERSON,
      name: '<script>alert(1)</script>',
    });

    const { data } = await searchSandboxEmailMessages(deps(), harness.environmentId, {
      'email-address': PERSON,
    });
    expect(data[0]?.['message-html']).toBe('<p>Hello &lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('stores the template as its input, and no rendered text', async () => {
    const inquiry = await confirmedInquiry('email', PERSON);

    const { values } = await runStep(
      'send_email',
      emailConfig({ text: 'Hello {{ trigger.name }}' }),
      { id: inquiry.id, email: PERSON, name: 'Synthetic Person' },
    );

    expect(JSON.stringify(values.input)).toContain('{{ trigger.name }}');
    expect(JSON.stringify(values.output)).not.toContain('Synthetic Person');
  });

  it('refuses a secret in a message at the config, before anything renders', async () => {
    const { step } = await runStep(
      'send_email',
      emailConfig({ text: 'Key: {{secrets.crm_token}}' }),
    );

    expect(step.errorCode).toBe('action_input_invalid');
  });
});

describe('Send SMS (C126.2)', () => {
  const smsConfig = (more: Record<string, unknown> = {}) => ({
    recipient: '{{ trigger.phone }}',
    text: 'Your review is ready.',
    ...more,
  });

  it('records for a confirmed number in a country the template accepts', async () => {
    const inquiry = await confirmedInquiry('sms', PHONE);

    const { step, values } = await runStep('send_sms', smsConfig(), {
      id: inquiry.id,
      phone: PHONE,
    });

    expect(step.status).toBe('succeeded');
    expect(values.output).toMatchObject({ delivery: 'recorded', sandbox: true });
    const { data } = await searchSandboxWorkflowSmsMessages(deps(), harness.environmentId, {
      'phone-number': PHONE,
    });
    expect(data).toHaveLength(1);
  });

  it('sends nothing with no inquiry template in scope', async () => {
    const { step } = await runStep('send_sms', smsConfig({ 'allow-unconfirmed': true }), {
      id: 'acc_01M5CK16P0D13FXHZSS4TCFBVH',
      phone: PHONE,
    });

    expect(step.errorCode).toBe('recipient_not_allowed');
  });

  it('refuses a country the template refuses', async () => {
    const inquiry = await confirmedInquiry('sms', '+442079460018');

    const { step } = await runStep('send_sms', smsConfig(), {
      id: inquiry.id,
      phone: '+442079460018',
    });

    expect(step.errorCode).toBe('recipient_not_allowed');
  });
});

describe('Send Slack Message (C126.3)', () => {
  let counter = 0;

  async function slackSecret() {
    counter += 1;
    const key = `slack_hook_${String(counter)}`;
    const { id } = await seedWorkflowSecret(harness.db, harness.organizationId, {
      key,
      allowedHosts: ['hooks.slack.com'],
    });
    await seedWorkflowSecretValue(harness.db, {
      organizationId: harness.organizationId,
      environmentId: harness.environmentId,
      secretId: id,
      value: SLACK_URL,
    });
    return { key, id };
  }

  const config = (key: string, text = 'A review of {{ trigger.name }} is ready.') => ({
    'webhook-secret': `{{secrets.${key}}}`,
    text,
  });

  it('records in the sandbox by secret id, with an end user’s mention disarmed', async () => {
    const { key, id } = await slackSecret();

    const { step, values } = await runStep('send_slack_message', config(key), {
      id: 'acc_01M5CK16P0D13FXHZSS4TCFBVH',
      name: '<!channel> & co',
    });

    expect(step.status).toBe('succeeded');
    expect(JSON.stringify(values)).not.toContain('hooks.slack.com');
    const { data } = await searchSandboxSlackMessages(deps(), harness.environmentId, {
      'secret-id': id,
    });
    expect(data[0]?.['message-text']).toBe('A review of &lt;!channel&gt; &amp; co is ready.');
  });

  it('posts to the secret’s URL when an adapter is bound, and stores no URL', async () => {
    const { key } = await slackSecret();
    const posted: SlackMessage[] = [];
    bind({
      id: 'incoming-webhook',
      sandbox: false,
      send(message) {
        posted.push(message);
        return Promise.resolve({});
      },
    });

    const { values } = await runStep('send_slack_message', config(key, 'Synthetic'));

    expect(posted).toEqual([{ webhookUrl: SLACK_URL, text: 'Synthetic' }]);
    expect(values.output).toMatchObject({ delivery: 'accepted', provider: 'incoming-webhook' });
    expect(JSON.stringify(values)).not.toContain('hooks.slack.com');
  });

  it('ends an unknown outcome as unknown_effect, which a resume stops at', async () => {
    const { key } = await slackSecret();
    bind({
      id: 'incoming-webhook',
      sandbox: false,
      send: () => Promise.reject(new SlackSendError(SLACK_OUTCOME_UNKNOWN, { retryable: false })),
    });

    const { id, step, row, values } = await runStep('send_slack_message', config(key, 'Synthetic'));

    expect(step.errorCode).toBe('unknown_effect');
    expect(row.status).toBe('errored');
    expect(values.output).toMatchObject({ delivery: 'unknown', 'message-ref': null });
    const effects = await listWorkflowRunEffects(harness.db, harness.environmentId, id);
    expect(effects.map(({ status }) => status)).toEqual(['unknown']);
  });

  it('errors with Slack’s code and leaves no effect, so nothing reads as sent', async () => {
    const { key } = await slackSecret();
    bind({
      id: 'incoming-webhook',
      sandbox: false,
      send: () =>
        Promise.reject(new SlackSendError('slack_channel_not_found', { retryable: false })),
    });

    const { id, step } = await runStep('send_slack_message', config(key, 'Synthetic'));

    expect(step.errorCode).toBe('slack_channel_not_found');
    expect(await listWorkflowRunEffects(harness.db, harness.environmentId, id)).toEqual([]);
  });

  it('errors a key no secret holds', async () => {
    const { step } = await runStep('send_slack_message', config('no_such_key', 'Synthetic'));

    expect(step.errorCode).toBe('secret_placement_refused');
  });
});
