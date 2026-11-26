import { describe, expect, it } from 'vitest';
import { AT, AT_ISO, IDS, LATER, LATER_ISO, LATEST_ISO, issuesOf } from './test-support.js';
import {
  MAX_WEBHOOK_ATTRIBUTE_BLOCKLIST,
  MAX_WEBHOOK_CUSTOM_HEADERS,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_PREVIOUS_SECRET_DEFAULT_TTL_SECONDS,
  WEBHOOK_PREVIOUS_SECRET_MAX_TTL_SECONDS,
  WEBHOOK_REPLAY_MAX_EVENTS,
  WEBHOOK_REPLAY_MAX_EVENT_IDS,
  WEBHOOK_RETRY_JITTER_RATIO,
  WEBHOOK_RETRY_OFFSETS_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
  WEBHOOK_STATUSES,
  WEBHOOK_TIMEOUT_MS,
  WEBHOOK_USER_AGENT,
  archiveWebhookBodySchema,
  attributeBlocklistSchema,
  buildCreatedWebhookResource,
  buildWebhookResource,
  cloneWebhookBodySchema,
  createWebhookBodySchema,
  createdWebhookDocumentSchema,
  customHeadersInputSchema,
  disableWebhookBodySchema,
  enableWebhookBodySchema,
  enabledEventsSchema,
  listWebhooksQuerySchema,
  replayWebhookBodySchema,
  replayWebhookDocumentSchema,
  rotateWebhookSecretBodySchema,
  rotateWebhookSecretDocumentSchema,
  simulateWebhookBodySchema,
  simulateWebhookDocumentSchema,
  updateWebhookBodySchema,
  webhookDocumentSchema,
  webhookFiltersSchema,
  webhookListDocumentSchema,
  webhookResourceSchema,
  webhookUrlSchema,
  webhookWantsEvent,
} from './webhooks.js';

const secret = 'wbhsec_test_ONLY_not_a_real_secret_000000000000001';

const webhook = {
  type: 'webhook',
  id: IDS.webhook,
  attributes: {
    url: 'https://hooks.example.test/openverify',
    'enabled-events': ['inquiry.completed', 'inquiry.failed'],
    status: 'enabled',
    'secret-last4': '0001',
    'created-at': AT_ISO,
    'updated-at': LATER_ISO,
  },
};

const record = {
  id: IDS.webhook,
  url: 'https://hooks.example.test/openverify',
  enabledEvents: ['inquiry.completed', 'inquiry.failed'] as const,
  status: 'enabled' as const,
  secretLast4: '0001',
  createdAt: AT,
  updatedAt: LATER,
};

describe('webhook delivery constants (C5)', () => {
  it('match the delivery contract', () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe('openverify-signature');
    expect(WEBHOOK_EVENT_ID_HEADER).toBe('openverify-event-id');
    expect(WEBHOOK_USER_AGENT).toBe('OpenVerify-Webhooks/1');
    expect(WEBHOOK_TIMEOUT_MS).toBe(10_000);
    // C14 replaces Phase 1's 5 attempts with 8.
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
    expect(WEBHOOK_SIGNATURE_TOLERANCE_SECONDS).toBe(300);
  });
});

describe('webhook resource (C2)', () => {
  it('shows the last four characters of the secret, never the secret', () => {
    expect(webhookResourceSchema.parse(webhook)).toEqual(webhook);
    const leaked = { ...webhook, attributes: { ...webhook.attributes, secret } };
    expect(webhookResourceSchema.safeParse(leaked).success).toBe(false);
    expect(webhookDocumentSchema.safeParse({ data: leaked }).success).toBe(false);
    expect(
      webhookListDocumentSchema.safeParse({ data: [leaked], links: { next: null } }).success,
    ).toBe(false);
  });

  it('returns the secret exactly once, in the creation response', () => {
    const created = { ...webhook, attributes: { ...webhook.attributes, secret } };
    expect(createdWebhookDocumentSchema.parse({ data: created })).toEqual({ data: created });
    const mismatched = {
      ...created,
      attributes: { ...created.attributes, 'secret-last4': 'zzzz' },
    };
    expect(createdWebhookDocumentSchema.safeParse({ data: mismatched }).success).toBe(false);
  });

  it('is built from a webhook record', () => {
    expect(buildWebhookResource(record)).toEqual(webhook);
    expect(buildCreatedWebhookResource(record, secret)).toEqual({
      ...webhook,
      attributes: { ...webhook.attributes, secret },
    });
  });

  it('refuses to build a created resource for a secret that does not match', () => {
    expect(() => buildCreatedWebhookResource({ ...record, secretLast4: 'abcd' }, secret)).toThrow();
  });
});

describe('webhook URLs', () => {
  it.each(['https://hooks.example.test/openverify', 'http://localhost:4010/hooks?source=ov'])(
    'accept %s',
    (url) => {
      expect(webhookUrlSchema.safeParse(url).success).toBe(true);
    },
  );

  it.each([
    ['another scheme', 'ftp://hooks.example.test/x'],
    ['credentials', 'https://user:pw@hooks.example.test/x'],
    ['a fragment', 'https://hooks.example.test/x#frag'],
    ['a relative URL', '/hooks'],
    ['an overlong URL', `https://hooks.example.test/${'a'.repeat(2048)}`],
  ])('reject %s', (_name, url) => {
    expect(webhookUrlSchema.safeParse(url).success).toBe(false);
  });
});

describe('enabled events', () => {
  it('are a wildcard or a unique list of event names', () => {
    expect(enabledEventsSchema.safeParse(['*']).success).toBe(true);
    expect(enabledEventsSchema.safeParse(['verification.passed']).success).toBe(true);
    expect(enabledEventsSchema.safeParse([]).success).toBe(false);
    expect(enabledEventsSchema.safeParse(['*', 'inquiry.created']).success).toBe(false);
    expect(enabledEventsSchema.safeParse(['inquiry.created', 'inquiry.created']).success).toBe(
      false,
    );
    expect(enabledEventsSchema.safeParse(['inquiry.deleted']).success).toBe(false);
  });

  it('decide which events a webhook receives', () => {
    expect(webhookWantsEvent(['*'], 'verification.submitted')).toBe(true);
    expect(webhookWantsEvent(['inquiry.completed'], 'inquiry.completed')).toBe(true);
    expect(webhookWantsEvent(['inquiry.completed'], 'inquiry.failed')).toBe(false);
  });
});

describe('webhook request bodies', () => {
  it('create a webhook from a URL and its events', () => {
    const body = {
      data: {
        attributes: { url: 'https://hooks.example.test/openverify', 'enabled-events': ['*'] },
      },
    };
    expect(createWebhookBodySchema.parse(body)).toEqual(body);
    expect(
      createWebhookBodySchema.safeParse({
        data: { attributes: { ...body.data.attributes, secret } },
      }).success,
    ).toBe(false);
  });

  it('update the URL, events or status', () => {
    expect(
      updateWebhookBodySchema.safeParse({ data: { attributes: { status: 'disabled' } } }).success,
    ).toBe(true);
    expect(
      updateWebhookBodySchema.safeParse({
        data: { attributes: { 'enabled-events': ['inquiry.failed'] } },
      }).success,
    ).toBe(true);
    expect(updateWebhookBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(false);
    expect(
      updateWebhookBodySchema.safeParse({ data: { attributes: { status: 'archived' } } }).success,
    ).toBe(false);
  });

  it('paginate by webhook id', () => {
    expect(listWebhooksQuerySchema.parse({ 'page[after]': IDS.webhook })).toEqual({
      'page[after]': IDS.webhook,
    });
    expect(listWebhooksQuerySchema.safeParse({ 'page[after]': IDS.inquiry }).success).toBe(false);
  });
});

describe('Phase 2 webhook delivery schedule (C14)', () => {
  it('makes 8 attempts at +0, 1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 24 h with 10% jitter', () => {
    expect(WEBHOOK_RETRY_OFFSETS_SECONDS).toEqual([0, 60, 300, 1800, 7200, 21_600, 43_200, 86_400]);
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(WEBHOOK_RETRY_OFFSETS_SECONDS.length);
    expect(WEBHOOK_RETRY_JITTER_RATIO).toBe(0.1);
  });

  it('keeps a rotated secret valid for 24 hours by default and at most 7 days', () => {
    expect(WEBHOOK_PREVIOUS_SECRET_DEFAULT_TTL_SECONDS).toBe(86_400);
    expect(WEBHOOK_PREVIOUS_SECRET_MAX_TTL_SECONDS).toBe(604_800);
  });

  it('replays at most 100 named events or 1,000 events in a range', () => {
    expect(WEBHOOK_REPLAY_MAX_EVENT_IDS).toBe(100);
    expect(WEBHOOK_REPLAY_MAX_EVENTS).toBe(1000);
  });
});

describe('Phase 2 webhook attributes (C12, C14)', () => {
  const phase2 = {
    ...webhook,
    attributes: {
      ...webhook.attributes,
      'api-version': '2026-10-01',
      'custom-headers': { 'X-Tenant': '[REDACTED]', authorization: '[REDACTED]' },
      filters: { 'inquiry-template-ids': [IDS.template], 'account-type-ids': [IDS.accountType] },
      'attribute-blocklist': ['fields', 'note'],
    },
  };

  it('can be archived, which is terminal', () => {
    expect(WEBHOOK_STATUSES).toEqual(['enabled', 'disabled', 'archived']);
    const archived = { ...webhook, attributes: { ...webhook.attributes, status: 'archived' } };
    expect(webhookResourceSchema.safeParse(archived).success).toBe(true);
  });

  it('show the API version, header names with redacted values, filters and blocklist', () => {
    expect(webhookResourceSchema.parse(phase2)).toEqual(phase2);
  });

  it('never show a custom header value', () => {
    const leaked = {
      ...phase2,
      attributes: { ...phase2.attributes, 'custom-headers': { 'X-Tenant': 'tenant-42' } },
    };
    expect(webhookResourceSchema.safeParse(leaked).success).toBe(false);
  });

  it('are built from a record that carries them', () => {
    const built = buildWebhookResource({
      ...record,
      apiVersion: '2026-10-01',
      customHeaderNames: ['X-Tenant', 'authorization'],
      filters: { 'inquiry-template-ids': [IDS.template], 'account-type-ids': [IDS.accountType] },
      attributeBlocklist: ['fields', 'note'],
    });
    expect(built).toEqual(phase2);
    expect(buildWebhookResource(record).attributes).not.toHaveProperty('api-version');
  });

  it('carry over to the created resource with its secret', () => {
    const created = buildCreatedWebhookResource(
      { ...record, status: 'disabled', apiVersion: '2026-10-01' },
      secret,
    );
    expect(created.attributes).toMatchObject({ status: 'disabled', 'api-version': '2026-10-01' });
  });
});

describe('custom headers (C14)', () => {
  it('accept up to 10 token-named headers with single-line values', () => {
    const headers = { 'X-Tenant': 'tenant-42', Authorization: 'Bearer synthetic-test-value' };
    expect(customHeadersInputSchema.parse(headers)).toEqual(headers);
    expect(MAX_WEBHOOK_CUSTOM_HEADERS).toBe(10);
    const eleven = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [`x-h${String(index)}`, 'v']),
    );
    expect(customHeadersInputSchema.safeParse(eleven).success).toBe(false);
  });

  it.each([
    'Content-Type',
    'content-length',
    'Host',
    'User-Agent',
    'OpenVerify-Signature',
    'openverify-anything',
    'Connection',
    'Keep-Alive',
    'Proxy-Authenticate',
    'Proxy-Authorization',
    'TE',
    'Trailer',
    'Transfer-Encoding',
    'Upgrade',
    'Proxy-Connection',
    'Expect',
  ])('refuse the reserved header %s', (name) => {
    expect(customHeadersInputSchema.safeParse({ [name]: 'x' }).success).toBe(false);
  });

  it.each([
    ['a name with a space', { 'X Tenant': 'x' }],
    ['a name with a colon', { 'X:Tenant': 'x' }],
    ['the same name twice in another case', { 'X-Tenant': 'a', 'x-tenant': 'b' }],
    ['a value with CR or LF', { 'X-Tenant': 'a\r\nX-Injected: 1' }],
    ['a value with another control character', { 'X-Tenant': 'a\u0000b' }],
    ['a value over 1,024 characters', { 'X-Tenant': 'x'.repeat(1025) }],
    ['a non-ASCII value, which HTTP clients refuse', { 'X-Tenant': 'café' }],
    ['the redacted placeholder as a value', { 'X-Tenant': '[REDACTED]' }],
  ])('refuse %s', (_name, headers) => {
    expect(customHeadersInputSchema.safeParse(headers).success).toBe(false);
  });

  it('allow a tab inside a value', () => {
    expect(customHeadersInputSchema.safeParse({ 'X-Tenant': 'a\tb' }).success).toBe(true);
  });
});

describe('webhook filters and attribute blocklist (C14)', () => {
  it('filter by template and account type ids', () => {
    expect(webhookFiltersSchema.parse({})).toEqual({});
    expect(webhookFiltersSchema.parse({ 'inquiry-template-ids': [IDS.template] })).toEqual({
      'inquiry-template-ids': [IDS.template],
    });
    for (const filters of [
      { 'inquiry-template-ids': [] },
      { 'inquiry-template-ids': [IDS.template, IDS.template] },
      { 'account-type-ids': [IDS.account] },
      { 'reference-ids': ['x'] },
    ]) {
      expect(webhookFiltersSchema.safeParse(filters).success).toBe(false);
    }
  });

  it('block up to 100 distinct kebab-case attribute names', () => {
    expect(MAX_WEBHOOK_ATTRIBUTE_BLOCKLIST).toBe(100);
    expect(attributeBlocklistSchema.parse(['fields', 'reference-id'])).toEqual([
      'fields',
      'reference-id',
    ]);
    for (const list of [
      ['referenceId'],
      ['fields', 'fields'],
      Array.from({ length: 101 }, (_, index) => `a${String(index)}`),
    ]) {
      expect(attributeBlocklistSchema.safeParse(list).success).toBe(false);
    }
  });
});

describe('Phase 2 webhook requests (C12, C14)', () => {
  it('create a webhook with an API version, headers, filters and a blocklist', () => {
    const body = {
      data: {
        attributes: {
          url: 'https://hooks.example.test/openverify',
          'enabled-events': ['inquiry.approved', 'account.consolidated'],
          'api-version': '2026-10-01',
          'custom-headers': { 'X-Tenant': 'tenant-42' },
          filters: { 'inquiry-template-ids': [IDS.template] },
          'attribute-blocklist': ['fields'],
        },
      },
    };
    expect(createWebhookBodySchema.parse(body)).toEqual(body);
    expect(
      createWebhookBodySchema.safeParse({
        data: { attributes: { ...body.data.attributes, 'api-version': '2020-01-01' } },
      }).success,
    ).toBe(false);
  });

  it('update the Phase 2 attributes, but never archive through PATCH', () => {
    expect(
      updateWebhookBodySchema.safeParse({
        data: { attributes: { 'attribute-blocklist': [], 'custom-headers': {} } },
      }).success,
    ).toBe(true);
    expect(
      updateWebhookBodySchema.safeParse({ data: { attributes: { filters: {} } } }).success,
    ).toBe(true);
  });

  it.each([
    ['enable', enableWebhookBodySchema],
    ['disable', disableWebhookBodySchema],
    ['archive', archiveWebhookBodySchema],
    ['clone', cloneWebhookBodySchema],
  ])('%s takes no parameters', (_name, schema) => {
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.safeParse({ meta: { status: 'enabled' } }).success).toBe(false);
  });

  it('rotate the secret, keeping the previous one for 0 to 7 days', () => {
    expect(rotateWebhookSecretBodySchema.parse(undefined)).toBeUndefined();
    expect(
      rotateWebhookSecretBodySchema.parse({ meta: { 'previous-secret-expires-in-seconds': 0 } }),
    ).toEqual({ meta: { 'previous-secret-expires-in-seconds': 0 } });
    expect(
      rotateWebhookSecretBodySchema.safeParse({
        meta: { 'previous-secret-expires-in-seconds': 604_801 },
      }).success,
    ).toBe(false);
    const created = { ...webhook, attributes: { ...webhook.attributes, secret } };
    const document = { data: created, meta: { 'previous-secret-expires-at': LATEST_ISO } };
    expect(rotateWebhookSecretDocumentSchema.parse(document)).toEqual(document);
    expect(
      rotateWebhookSecretDocumentSchema.safeParse({ data: webhook, meta: document.meta }).success,
    ).toBe(false);
  });

  it('simulate one event and report its id', () => {
    expect(simulateWebhookBodySchema.parse({ meta: { 'event-name': 'account.created' } })).toEqual({
      meta: { 'event-name': 'account.created' },
    });
    expect(simulateWebhookBodySchema.safeParse({ meta: { 'event-name': '*' } }).success).toBe(
      false,
    );
    expect(
      simulateWebhookDocumentSchema.parse({ data: webhook, meta: { 'event-id': IDS.event } }),
    ).toEqual({ data: webhook, meta: { 'event-id': IDS.event } });
  });

  it('replay named events or a time range of (failed) events', () => {
    expect(replayWebhookBodySchema.parse({ meta: { 'event-ids': [IDS.event] } })).toEqual({
      meta: { 'event-ids': [IDS.event] },
    });
    const range = {
      meta: {
        'created-at-start': '2026-10-01T00:00:00Z',
        'created-at-end': '2026-10-02T00:00:00Z',
        status: 'failed',
      },
    };
    expect(replayWebhookBodySchema.parse(range)).toEqual(range);
    expect(
      replayWebhookDocumentSchema.parse({ data: webhook, meta: { 'replayed-count': 12 } }),
    ).toEqual({ data: webhook, meta: { 'replayed-count': 12 } });
  });

  it.each([
    ['no criteria', {}],
    ['an empty id list', { 'event-ids': [] }],
    ['101 ids', { 'event-ids': Array.from({ length: 101 }, () => IDS.event) }],
    ['duplicate ids', { 'event-ids': [IDS.event, IDS.event] }],
    [
      'ids and a range at once',
      {
        'event-ids': [IDS.event],
        'created-at-start': '2026-10-01T00:00:00Z',
        'created-at-end': '2026-10-02T00:00:00Z',
      },
    ],
    ['a range without an end', { 'created-at-start': '2026-10-01T00:00:00Z' }],
    [
      'a range that ends before it starts',
      { 'created-at-start': '2026-10-02T00:00:00Z', 'created-at-end': '2026-10-01T00:00:00Z' },
    ],
    [
      'a status other than failed',
      {
        'created-at-start': '2026-10-01T00:00:00Z',
        'created-at-end': '2026-10-02T00:00:00Z',
        status: 'succeeded',
      },
    ],
  ])('refuses a replay with %s', (_name, meta) => {
    expect(issuesOf(replayWebhookBodySchema.safeParse({ meta })).length).toBeGreaterThan(0);
  });
});
