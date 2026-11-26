/** C124, C126: the egress steps' contracts. What a sink checks on rendered values is `api-egress`'s. */
import { describe, expect, it } from 'vitest';
import { createWorkflowActionEntries } from './catalogue.js';
import { WORKFLOW_ACTION_CONTRACTS } from './contracts.js';
import { WORKFLOW_ACTION_ERROR_TYPES } from './errors.js';
import {
  HTTPS_ACTION_LIMITS,
  WORKFLOW_HTTP_REFUSED_HEADERS,
  httpsLiteralHost,
  makeHttpsRequestConfigSchema,
  makeHttpsRequestOutputSchema,
} from './https.js';
import {
  MESSAGE_LIMITS,
  SLACK_WEBHOOK_HOST,
  SLACK_WEBHOOK_PATH,
  messageOutputSchema,
  sendEmailConfigSchema,
  sendSlackMessageConfigSchema,
  sendSmsConfigSchema,
} from './messages.js';
import {
  ACTION_OBJECT_TYPE_ENTRIES,
  WORKFLOW_ACTION_KEYS,
  actionOutputMarks,
  createActionObjectTypeTable,
  createActionRegistry,
} from './registry.js';

const REQUEST = {
  method: 'POST',
  url: 'https://api.example.com/v1/{{ trigger.id }}?a={{ vars.b }}',
};
const https = (value: object) => makeHttpsRequestConfigSchema.safeParse(value).success;

describe('the catalogue is whole (C122.2)', () => {
  it('holds a contract for every key', () => {
    expect(Object.keys(WORKFLOW_ACTION_CONTRACTS).sort()).toEqual([...WORKFLOW_ACTION_KEYS].sort());
  });

  const registry = createActionRegistry(
    createWorkflowActionEntries(createActionObjectTypeTable(ACTION_OBJECT_TYPE_ENTRIES)),
  );

  it('registers every key', () => {
    expect(
      registry
        .list()
        .map(({ key }) => key)
        .sort(),
    ).toEqual([...WORKFLOW_ACTION_KEYS].sort());
  });

  it.each([
    ['make_https_request', 'at-least-once', 'none'],
    ['send_email', 'at-most-once', 'mailer'],
    ['send_sms', 'at-most-once', 'sms'],
    ['send_slack_message', 'at-most-once', 'slack'],
  ] as const)('%s is egress, %s, on adapter %s', (key, delivery, availability) => {
    expect(registry.latest(key)).toMatchObject({
      kind: 'egress',
      delivery,
      availability,
      retry: { allowed: true },
    });
  });

  it('needs no scope of its own: PII leaving is the publish rule (C121.4)', () => {
    const entry = registry.latest('make_https_request') as unknown as {
      grant: (config: object) => unknown;
    };
    expect(entry.grant({})).toEqual({ scopes: [], pii: false });
  });

  it.each(['make_https_request', 'send_email', 'send_sms', 'send_slack_message'] as const)(
    '%s marks every output member',
    (key) => {
      expect(() => actionOutputMarks(key, WORKFLOW_ACTION_CONTRACTS[key].output)).not.toThrow();
    },
  );
});

describe('Make HTTPS Request (C124.1)', () => {
  it('takes the five methods', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(https({ ...REQUEST, method }), method).toBe(true);
    }
    expect(https({ ...REQUEST, method: 'TRACE' })).toBe(false);
  });

  it('carries a body on POST, PUT and PATCH only', () => {
    for (const method of ['POST', 'PUT', 'PATCH']) {
      expect(https({ ...REQUEST, method, body: { a: '{{ vars.a }}' } }), method).toBe(true);
    }
    for (const method of ['GET', 'DELETE']) {
      expect(https({ ...REQUEST, method, body: { a: 1 } }), method).toBe(false);
    }
  });

  it('caps the body at 256 KiB', () => {
    expect(https({ ...REQUEST, body: { a: 'x'.repeat(256 * 1024) } })).toBe(false);
  });

  it('defaults the timeout and caps it at 30 seconds', () => {
    expect(makeHttpsRequestConfigSchema.parse(REQUEST)).toMatchObject({ 'timeout-seconds': 10 });
    expect(https({ ...REQUEST, 'timeout-seconds': 30 })).toBe(true);
    expect(https({ ...REQUEST, 'timeout-seconds': 31 })).toBe(false);
    expect(https({ ...REQUEST, 'timeout-seconds': 0 })).toBe(false);
  });

  it('holds its limits with a basis', () => {
    expect(HTTPS_ACTION_LIMITS['response-bytes']).toMatchObject({ value: 1024 * 1024 });
    expect(HTTPS_ACTION_LIMITS['error-body-bytes']).toMatchObject({ value: 16 * 1024 });
    expect(HTTPS_ACTION_LIMITS['requests-per-minute']).toMatchObject({ value: 600 });
    expect(HTTPS_ACTION_LIMITS['host-concurrency']).toMatchObject({ value: 5 });
  });
});

describe('a literal destination (C124.3)', () => {
  it.each([
    ['a templated host', 'https://{{ vars.host }}/a'],
    ['a host built with a template', 'https://{{ vars.a }}.example.com/a'],
    ['a templated port', 'https://api.example.com:{{ vars.port }}/a'],
    ['a templated scheme', '{{ vars.scheme }}://api.example.com/a'],
    ['a whole templated URL', '{{ vars.url }}'],
    ['http', 'http://api.example.com/a'],
    ['credentials', 'https://user:pass@api.example.com/a'],
    ['a template in the credentials', 'https://{{ vars.a }}@api.example.com/a'],
    ['a fragment', 'https://api.example.com/a#b'],
    ['a template in a query name', 'https://api.example.com/a?{{ vars.a }}=1'],
    ['a secret in a path', 'https://api.example.com/{{secrets.a}}'],
    ['a secret in a query', 'https://api.example.com/a?b={{secrets.a}}'],
    [
      'the public secret form in a path',
      'https://api.example.com/{{current_run.environment.secrets.a}}',
    ],
    ['a space', 'https://api.example.com/a b'],
    ['no host', 'https:///a'],
  ])('refuses %s', (_name, url) => {
    expect(https({ ...REQUEST, url })).toBe(false);
  });

  it.each([
    ['a path segment', 'https://api.example.com/v1/{{ trigger.id }}/x'],
    ['a query value', 'https://api.example.com/a?b={{ vars.a }}&c=1'],
    ['a literal port', 'https://api.example.com:8443/a'],
    ['no path', 'https://api.example.com'],
  ])('takes %s', (_name, url) => {
    expect(https({ ...REQUEST, url })).toBe(true);
  });

  it('leaves an IDN and an IPv6 literal to the normaliser and the guard', () => {
    expect(https({ ...REQUEST, url: 'https://bücher.example/a' })).toBe(true);
    expect(https({ ...REQUEST, url: 'https://[2001:db8::1]/a' })).toBe(true);
    expect(https({ ...REQUEST, url: 'https://api.example.com\\@evil.example/a' })).toBe(false);
  });

  it('reads the literal host off the published URL', () => {
    expect(httpsLiteralHost('https://api.example.com:8443/v1/{{ trigger.id }}')).toBe(
      'api.example.com',
    );
    expect(httpsLiteralHost('https://{{ vars.a }}/x')).toBeNull();
  });
});

describe('the header policy (C124.4)', () => {
  const withHeader = (name: string, value = 'a') =>
    https({ ...REQUEST, headers: [{ name, value }] });

  it('takes a token name and a template value', () => {
    expect(withHeader('x-partner-id', '{{ vars.a }}')).toBe(true);
    expect(withHeader('Authorization', 'Bearer {{secrets.partner_token}}')).toBe(true);
  });

  it.each([...WORKFLOW_HTTP_REFUSED_HEADERS, 'Host', 'Proxy-Authorization', 'proxy-x'])(
    'refuses %s',
    (name) => {
      expect(withHeader(name)).toBe(false);
    },
  );

  it('names every refused header of the plan', () => {
    expect(WORKFLOW_HTTP_REFUSED_HEADERS).toEqual(
      expect.arrayContaining([
        'host',
        'content-length',
        'transfer-encoding',
        'connection',
        'keep-alive',
        'upgrade',
        'expect',
        'te',
        'trailer',
        'openverify-request-signature',
        'openverify-signature',
        'idempotency-key',
        'openverify-workflow-run',
      ]),
    );
  });

  it('refuses a name that is no token, and CR, LF or NUL in a value', () => {
    expect(withHeader('bad header')).toBe(false);
    expect(withHeader('x-a', 'a\r\nb: c')).toBe(false);
    expect(withHeader('x-a', 'a\u0000b')).toBe(false);
  });

  it('caps the headers at 32 and 8 KiB', () => {
    const headers = (count: number, value: string) =>
      Array.from({ length: count }, (_item, index) => ({ name: `x-${String(index)}`, value }));
    expect(https({ ...REQUEST, headers: headers(32, 'a') })).toBe(true);
    expect(https({ ...REQUEST, headers: headers(33, 'a') })).toBe(false);
    expect(https({ ...REQUEST, headers: headers(2, 'a'.repeat(5 * 1024)) })).toBe(false);
  });

  it('refuses the same header twice', () => {
    const headers = [
      { name: 'X-A', value: '1' },
      { name: 'x-a', value: '2' },
    ];
    expect(https({ ...REQUEST, headers })).toBe(false);
  });
});

describe('signing and responses (C124.1, C124.5, C124.6)', () => {
  it('signs with a secret reference, never a literal', () => {
    expect(https({ ...REQUEST, signing: { secret: '{{secrets.partner_signing}}' } })).toBe(true);
    expect(https({ ...REQUEST, signing: { secret: 'change-me-canary' } })).toBe(false);
  });

  it('declares each response member with an explicit PII mark', () => {
    const schema = [{ name: 'score', type: 'number', pii: false }];
    expect(https({ ...REQUEST, 'response-schema': schema })).toBe(true);
    expect(https({ ...REQUEST, 'response-schema': [{ name: 'score', type: 'number' }] })).toBe(
      false,
    );
  });

  it('captures an error body only when asked', () => {
    expect(makeHttpsRequestConfigSchema.parse(REQUEST)).not.toHaveProperty('capture-error-body');
    expect(https({ ...REQUEST, 'capture-error-body': true })).toBe(true);
  });

  it('answers a status, the allowlisted headers and a body held PII', () => {
    const answer = { status: 200, headers: { 'content-type': 'application/json' }, body: { a: 1 } };
    expect(makeHttpsRequestOutputSchema.safeParse(answer).success).toBe(true);
    const marks = actionOutputMarks('make_https_request', makeHttpsRequestOutputSchema);
    expect(marks).toEqual({ status: false, headers: true, body: true });
  });

  it('refuses a header outside the allowlist on the output', () => {
    const answer = { status: 200, headers: { 'set-cookie': 'a=b' }, body: null };
    expect(makeHttpsRequestOutputSchema.safeParse(answer).success).toBe(false);
  });
});

describe('Send Email (C126.1)', () => {
  const email = { recipient: '{{ trigger.email-address }}', subject: 'Hello', text: 'Hi' };
  const ok = (value: object) => sendEmailConfigSchema.safeParse(value).success;

  it('takes one recipient, a subject and a text, and optional HTML', () => {
    expect(ok(email)).toBe(true);
    expect(ok({ ...email, html: '<p>Hi</p>' })).toBe(true);
    expect(ok({ ...email, 'allow-unconfirmed': true })).toBe(true);
  });

  it.each(['cc', 'bcc', 'from', 'attachments', 'smtp'])('offers no %s', (member) => {
    expect(ok({ ...email, [member]: 'x' })).toBe(false);
  });

  it('refuses a secret anywhere in a message (C125.3)', () => {
    for (const member of ['recipient', 'subject', 'text', 'html']) {
      expect(ok({ ...email, [member]: 'a {{secrets.a}}' }), member).toBe(false);
      expect(ok({ ...email, [member]: 'a {{current_run.environment.secrets.a}}' }), member).toBe(
        false,
      );
    }
  });

  it('caps the HTML at 64 KiB and holds the rendered caps', () => {
    expect(ok({ ...email, html: 'x'.repeat(64 * 1024) })).toBe(true);
    expect(ok({ ...email, html: 'x'.repeat(64 * 1024 + 1) })).toBe(false);
    expect(MESSAGE_LIMITS['email-subject-characters']).toMatchObject({ value: 200 });
    expect(MESSAGE_LIMITS['email-text-bytes']).toMatchObject({ value: 32 * 1024 });
    expect(MESSAGE_LIMITS['sms-characters']).toMatchObject({ value: 480 });
    expect(MESSAGE_LIMITS['slack-characters']).toMatchObject({ value: 3000 });
  });
});

describe('Send SMS (C126.2)', () => {
  const ok = (value: object) => sendSmsConfigSchema.safeParse(value).success;

  it('takes a recipient and a text', () => {
    expect(ok({ recipient: '{{ a }}', text: 'Hi' })).toBe(true);
    expect(ok({ recipient: '{{ a }}', text: 'Hi', 'allow-unconfirmed': true })).toBe(true);
  });

  it('refuses a secret, and a sender of its own', () => {
    expect(ok({ recipient: '{{ a }}', text: '{{secrets.a}}' })).toBe(false);
    expect(ok({ recipient: '{{ a }}', text: 'Hi', from: '+15550100' })).toBe(false);
  });
});

describe('Send Slack Message (C126.3)', () => {
  const ok = (value: object) => sendSlackMessageConfigSchema.safeParse(value).success;

  it('posts through a secret reference', () => {
    expect(ok({ 'webhook-secret': '{{secrets.slack_url}}', text: 'Hi' })).toBe(true);
  });

  it('takes no URL literally, no channel and no secret in the text', () => {
    const url = 'https://hooks.slack.com/services/T0/B0/x';
    expect(ok({ 'webhook-secret': url, text: 'Hi' })).toBe(false);
    expect(ok({ 'webhook-secret': '{{secrets.a}}', text: 'Hi', channel: '#a' })).toBe(false);
    expect(ok({ 'webhook-secret': '{{secrets.a}}', text: '{{secrets.b}}' })).toBe(false);
  });

  it('holds the incoming webhook shape', () => {
    expect(SLACK_WEBHOOK_HOST).toBe('hooks.slack.com');
    expect(SLACK_WEBHOOK_PATH.test('/services/T0AAA/B0BBB/abcDEF123')).toBe(true);
    expect(SLACK_WEBHOOK_PATH.test('/services/T0AAA/B0BBB/abc/../x')).toBe(false);
    expect(SLACK_WEBHOOK_PATH.test('/api/chat.postMessage')).toBe(false);
  });
});

describe('what a message says of itself (C126.5)', () => {
  const answer = { delivery: 'accepted', provider: 'twilio', sandbox: false, 'message-ref': 'SM1' };

  it.each(['recorded', 'accepted', 'unknown'])('takes %s', (delivery) => {
    expect(messageOutputSchema.safeParse({ ...answer, delivery }).success).toBe(true);
  });

  it.each(['sent', 'delivered'])('never says %s', (delivery) => {
    expect(messageOutputSchema.safeParse({ ...answer, delivery }).success).toBe(false);
  });

  it('marks nothing PII: it holds no address and no body', () => {
    expect(Object.values(actionOutputMarks('send_email', messageOutputSchema))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('the egress step errors (C124, C125, C126)', () => {
  it.each([
    ['destination_refused', 'configuration-error'],
    ['secret_placement_refused', 'configuration-error'],
    ['response_unsupported', 'resource-error'],
    ['test_run_egress_disabled', 'configuration-error'],
    ['message_link_refused', 'invalid-input-error'],
    ['recipient_not_allowed', 'invalid-input-error'],
    ['request_failed', 'resource-error'],
  ] as const)('%s is a %s', (code, type) => {
    expect((WORKFLOW_ACTION_ERROR_TYPES as Readonly<Record<string, string>>)[code]).toBe(type);
  });
});
