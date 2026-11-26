import { describe, expect, it } from 'vitest';
import {
  PII_SANDBOX_MESSAGE_ATTRIBUTES,
  SANDBOX_MESSAGE_KINDS,
  sandboxEmailSearchBodySchema,
  sandboxEmailSearchResponseSchema,
  sandboxSlackSearchBodySchema,
  sandboxSlackSearchResponseSchema,
  sandboxWorkflowSmsSearchBodySchema,
  sandboxWorkflowSmsSearchResponseSchema,
} from './sandbox-messages.js';
import { readFixture } from './test-support.js';

const SECRET = 'wsec_01M5CM00000000000000000030';

describe('the sandbox messages (C126.4)', () => {
  it('keeps workflow messages apart from the OTP list', () => {
    expect(SANDBOX_MESSAGE_KINDS).toEqual(['workflow-sms', 'email', 'slack']);
    expect(SANDBOX_MESSAGE_KINDS).not.toContain('otp');
  });

  it('searches in the body, by what each record is keyed on', () => {
    expect(
      sandboxEmailSearchBodySchema.safeParse({ 'email-address': 'a@example.test' }).success,
    ).toBe(true);
    expect(sandboxEmailSearchBodySchema.safeParse({ 'email-address': 'nope' }).success).toBe(false);
    expect(sandboxSlackSearchBodySchema.safeParse({ 'secret-id': SECRET }).success).toBe(true);
    expect(sandboxSlackSearchBodySchema.safeParse({ 'secret-id': 'partner_token' }).success).toBe(
      false,
    );
    expect(
      sandboxWorkflowSmsSearchBodySchema.safeParse({ 'phone-number': '+15550100' }).success,
    ).toBe(true);
  });

  it.each([
    ['sandbox-email-messages.json', sandboxEmailSearchResponseSchema],
    ['sandbox-slack-messages.json', sandboxSlackSearchResponseSchema],
    ['sandbox-workflow-sms-messages.json', sandboxWorkflowSmsSearchResponseSchema],
  ] as const)('parses the golden %s', (file, schema) => {
    expect(schema.safeParse(readFixture(`api/${file}`)).success).toBe(true);
  });

  it('holds a Slack record by secret id, never the URL', () => {
    const answer = readFixture('api/sandbox-slack-messages.json') as { data: object[] };
    const [message] = answer.data;
    expect(JSON.stringify(message)).not.toContain('hooks.slack.com');
    expect(
      sandboxSlackSearchResponseSchema.safeParse({
        data: [{ ...message, url: 'https://hooks.slack.com/services/T0/B0/x' }],
      }).success,
    ).toBe(false);
  });

  it('says a record is a record, never a delivery', () => {
    const answer = readFixture('api/sandbox-email-messages.json') as { data: object[] };
    const [message] = answer.data;
    expect(Object.keys(message ?? {})).toContain('recorded-at');
    expect(Object.keys(message ?? {})).not.toContain('sent-at');
  });

  it('names the members a stored log masks', () => {
    expect(PII_SANDBOX_MESSAGE_ATTRIBUTES).toEqual([
      'message-subject',
      'message-text',
      'message-html',
    ]);
  });
});
