/**
 * C126.4: the sandbox lists, one per environment and kind, every body sealed, at most 500 entries for
 * 24 hours, and the searches over them. The OTP list is untouched. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { otpDestinationIndex, createKeyring, setDefaultKeyring } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSandboxMailer } from '../../../mail/sandbox.js';
import { createSlackSender } from '../../../providers/slack/index.js';
import { sandboxSmsSinkKey } from '../../../providers/sms/sandbox.js';
import type { ApiDependencies } from '../../../services/context.js';
import { createInMemoryKeyValueCache, fixedClock } from '../../../test-support/fakes.js';
import {
  recordSandboxMessage,
  sandboxMessageListKey,
  searchSandboxEmailMessages,
  searchSandboxSlackMessages,
  searchSandboxWorkflowSmsMessages,
} from './sandbox-messages.js';

const NOW = new Date('2026-11-02T12:00:00.000Z');
const clock = fixedClock(NOW);
const ENVIRONMENT = 'env_01M5CK16P0D13FXHZSS4TCFBVH';
const RUN = 'wfr_01M5CK16P0D13FXHZSS4TCFBVH';
const SLACK_ROW = 'wsec_01M5CK16P0D13FXHZSS4TCFBVH';
const blindIndexKey = randomBytes(32);
const BODY = 'canary-body-of-a-message';

beforeAll(() => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
});

afterAll(() => {
  setDefaultKeyring(undefined);
});

const fresh = () => {
  const cache = createInMemoryKeyValueCache(clock);
  return { cache, deps: { cache, blindIndexKey } as unknown as ApiDependencies };
};

const origin = {
  environmentId: ENVIRONMENT,
  workflowRunId: RUN,
  stepId: 'wfst_1',
  messageRef: 'ref-1',
};

const emailIndex = (address: string) =>
  otpDestinationIndex(blindIndexKey, {
    environmentId: ENVIRONMENT,
    channel: 'email',
    destination: address,
  });

describe('the sandbox mailer (C126.4)', () => {
  it('records sealed, under the recipient’s HMAC, and sends nothing', async () => {
    const { cache, deps } = fresh();
    const mailer = createSandboxMailer({ cache, clock });

    await mailer.send(
      { to: { address: 'person@example.com' }, subject: 'Hello', text: BODY, html: '<p>x</p>' },
      { ...origin, recipientIndex: emailIndex('person@example.com') },
    );

    const raw = await cache.listRange(sandboxMessageListKey(ENVIRONMENT, 'email'), 10);
    expect(raw).toHaveLength(1);
    expect(raw.join()).not.toContain(BODY);
    expect(raw.join()).not.toContain('person@example.com');
    expect(raw.join()).not.toContain('Hello');
    await expect(
      searchSandboxEmailMessages(deps, ENVIRONMENT, { 'email-address': 'Person@example.com' }),
    ).resolves.toEqual({
      data: [
        {
          'message-ref': 'ref-1',
          'workflow-run-id': RUN,
          'step-id': 'wfst_1',
          'recorded-at': NOW.toISOString(),
          'message-subject': 'Hello',
          'message-text': BODY,
          'message-html': '<p>x</p>',
        },
      ],
    });
  });

  it('finds nothing for another address or a malformed one', async () => {
    const { cache, deps } = fresh();
    await createSandboxMailer({ cache, clock }).send(
      { to: { address: 'person@example.com' }, subject: 'Hello', text: BODY },
      { ...origin, recipientIndex: emailIndex('person@example.com') },
    );

    await expect(
      searchSandboxEmailMessages(deps, ENVIRONMENT, { 'email-address': 'other@example.com' }),
    ).resolves.toEqual({ data: [] });
  });

  it('refuses to claim a record it could not write', async () => {
    const mailer = createSandboxMailer({ clock });

    await expect(
      mailer.send(
        { to: { address: 'person@example.com' }, subject: 'Hello', text: BODY },
        { ...origin, recipientIndex: emailIndex('person@example.com') },
      ),
    ).rejects.toThrow('sandbox_sink_unavailable');
  });
});

describe('the sandbox Slack sender (C126.4)', () => {
  it('records sealed by secret id, and holds no URL', async () => {
    const { cache, deps } = fresh();
    const sender = createSlackSender('sandbox', { cache, clock });
    if (!sender.sandbox) {
      throw new Error('a sandbox sender');
    }

    await sender.send({ text: BODY }, { ...origin, secretId: SLACK_ROW });

    const raw = await cache.listRange(sandboxMessageListKey(ENVIRONMENT, 'slack'), 10);
    expect(raw.join()).not.toContain(BODY);
    expect(raw.join()).not.toContain('hooks.slack.com');
    await expect(
      searchSandboxSlackMessages(deps, ENVIRONMENT, { 'secret-id': SLACK_ROW }),
    ).resolves.toMatchObject({
      data: [{ 'secret-id': SLACK_ROW, 'message-text': BODY, 'message-ref': 'ref-1' }],
    });
  });
});

describe('the workflow SMS list (C126.4)', () => {
  it('records in its own list, never the OTP sink', async () => {
    const { cache, deps } = fresh();
    const index = otpDestinationIndex(blindIndexKey, {
      environmentId: ENVIRONMENT,
      channel: 'sms',
      destination: '+12025550123',
    });

    await recordSandboxMessage({ cache, clock }, 'workflow-sms', {
      ...origin,
      recipientIndex: index,
      secretId: null,
      message: { text: BODY },
    });

    expect(await cache.listRange(sandboxSmsSinkKey(ENVIRONMENT), 10)).toEqual([]);
    await expect(
      searchSandboxWorkflowSmsMessages(deps, ENVIRONMENT, { 'phone-number': '+1 (202) 555-0123' }),
    ).resolves.toMatchObject({ data: [{ 'message-text': BODY }] });
    await expect(
      searchSandboxWorkflowSmsMessages(deps, ENVIRONMENT, { 'phone-number': 'nonsense' }),
    ).resolves.toEqual({ data: [] });
  });
});

describe('the lists', () => {
  it('are one per environment', async () => {
    const { cache, deps } = fresh();
    await recordSandboxMessage({ cache, clock }, 'slack', {
      ...origin,
      recipientIndex: null,
      secretId: SLACK_ROW,
      message: { text: BODY },
    });

    await expect(
      searchSandboxSlackMessages(deps, 'env_other', { 'secret-id': SLACK_ROW }),
    ).resolves.toEqual({ data: [] });
  });

  it('answer newest first and skip what they cannot read', async () => {
    const { cache, deps } = fresh();
    await recordSandboxMessage({ cache, clock }, 'slack', {
      ...origin,
      messageRef: 'first',
      recipientIndex: null,
      secretId: SLACK_ROW,
      message: { text: 'one' },
    });
    await recordSandboxMessage({ cache, clock }, 'slack', {
      ...origin,
      messageRef: 'second',
      recipientIndex: null,
      secretId: SLACK_ROW,
      message: { text: 'two' },
    });
    await cache.pushCapped(sandboxMessageListKey(ENVIRONMENT, 'slack'), 'not json', 500, 60);

    const { data } = await searchSandboxSlackMessages(deps, ENVIRONMENT, {
      'secret-id': SLACK_ROW,
    });

    expect(data.map((entry) => entry['message-ref'])).toEqual(['second', 'first']);
  });

  it('leave out a record no run made, which the contract cannot serve', async () => {
    const { cache, deps } = fresh();
    await recordSandboxMessage({ cache, clock }, 'slack', {
      ...origin,
      workflowRunId: null,
      recipientIndex: null,
      secretId: SLACK_ROW,
      message: { text: BODY },
    });

    await expect(
      searchSandboxSlackMessages(deps, ENVIRONMENT, { 'secret-id': SLACK_ROW }),
    ).resolves.toEqual({ data: [] });
  });
});
