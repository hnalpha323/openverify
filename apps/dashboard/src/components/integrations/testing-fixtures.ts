/**
 * Synthetic API documents for the integrations tests (webhooks, deliveries, API keys, API logs,
 * events). No real people or credentials: every ID is a made-up ULID, every secret and token a
 * placeholder of the right shape.
 */
import type {
  ApiKeyResource,
  ApiLogResource,
  EventResource,
  WebhookDeliveryResource,
  WebhookResource,
} from '@openverify/contracts';

export const INTEGRATION_IDS = {
  webhook: 'wbh_01J9ZK3M5Q7R8S9T0V1W2X3Y60',
  clonedWebhook: 'wbh_01J9ZK3M5Q7R8S9T0V1W2X3Y67',
  event: 'evt_01J9ZK3M5Q7R8S9T0V1W2X3Y61',
  delivery: 'whd_01J9ZK3M5Q7R8S9T0V1W2X3Y62',
  apiKey: 'key_01J9ZK3M5Q0000000000000063',
  clonedApiKey: 'key_01J9ZK3M5Q0000000000000068',
  apiLog: 'alog_01J9ZK3M5Q7R8S9T0V1W2X3Y64',
  inquiry: 'inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
  template: 'itmpl_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
  accountType: 'acctp_01J9ZK3M5Q7R8S9T0V1W2X3Y65',
  user: 'usr_01J9ZK3M5Q7R8S9T0V1W2X3Y46',
} as const;

export const AT = '2026-10-20T04:35:00.000Z';
export const LATER = '2026-10-20T04:40:00.000Z';

/** A webhook secret of the contract's shape, ending in `last`. */
export function webhookSecret(fill = 's', last = 'Zz9_'): string {
  return `wbhsec_${fill.repeat(39)}${last}`;
}

/** An API key token of the contract's shape (sandbox), starting with `ov_sbx_abcd`. */
export function apiKeyToken(fill = 't'): string {
  return `ov_sbx_abcd${fill.repeat(39)}`;
}

export function webhookResource(
  overrides: Partial<WebhookResource['attributes']> = {},
  id: string = INTEGRATION_IDS.webhook,
): WebhookResource {
  return {
    type: 'webhook',
    id,
    attributes: {
      url: 'https://hooks.example.test/openverify',
      'enabled-events': ['inquiry.approved', 'inquiry.declined'],
      status: 'enabled',
      'secret-last4': 'Zz9_',
      'api-version': '2026-10-01',
      'custom-headers': { Authorization: '[REDACTED]' },
      filters: { 'inquiry-template-ids': [INTEGRATION_IDS.template] },
      'attribute-blocklist': ['fields'],
      'created-at': AT,
      'updated-at': LATER,
      ...overrides,
    },
  };
}

/** A webhook as Phase 1 served it: without API version, custom headers, filters or blocklist. */
export function phase1WebhookResource(
  overrides: Partial<WebhookResource['attributes']> = {},
): WebhookResource {
  const { attributes } = webhookResource(overrides);
  return {
    type: 'webhook',
    id: INTEGRATION_IDS.webhook,
    attributes: {
      url: attributes.url,
      'enabled-events': attributes['enabled-events'],
      status: attributes.status,
      'secret-last4': attributes['secret-last4'],
      'created-at': attributes['created-at'],
      'updated-at': attributes['updated-at'],
    },
  };
}

/** A creation, clone or rotation answer: the webhook with its secret, once. */
export function createdWebhookResource(
  id: string = INTEGRATION_IDS.webhook,
  secret: string = webhookSecret(),
): Record<string, unknown> {
  const webhook = webhookResource({ 'secret-last4': secret.slice(-4) }, id);
  return { ...webhook, attributes: { ...webhook.attributes, secret } };
}

export function deliveryResource(
  overrides: Partial<WebhookDeliveryResource['attributes']> = {},
  id: string = INTEGRATION_IDS.delivery,
): WebhookDeliveryResource {
  return {
    type: 'webhook-delivery',
    id,
    attributes: {
      status: 'failed',
      'webhook-id': INTEGRATION_IDS.webhook,
      'event-id': INTEGRATION_IDS.event,
      'event-name': 'inquiry.approved',
      attempts: [
        { 'attempted-at': AT, 'response-status': 500, 'duration-ms': 120, error: null },
        {
          'attempted-at': LATER,
          'response-status': null,
          'duration-ms': null,
          error: 'The request timed out.',
        },
      ],
      'next-attempt-at': null,
      'created-at': AT,
      ...overrides,
    },
  };
}

export function apiKeyResource(
  overrides: Partial<ApiKeyResource['attributes']> = {},
  id: string = INTEGRATION_IDS.apiKey,
): ApiKeyResource {
  return {
    type: 'api-key',
    id,
    attributes: {
      name: 'CI deploys',
      scopes: ['inquiries:read', 'webhooks:read'],
      'allowed-ips': ['203.0.113.0/24'],
      'api-version': '2026-10-01',
      'token-prefix': 'ov_sbx_abcd',
      'expires-at': null,
      'last-used-at': LATER,
      'created-at': AT,
      // C25.6: every key answer says whether the key sees personal data masked.
      'pii-masked': false,
      ...overrides,
    },
  };
}

/** `GET /rate-limits` (C12): the caller's `api` limit, 297 of 300 left this minute. */
export function rateLimitList() {
  return {
    data: [
      {
        type: 'rate-limit',
        id: 'api',
        attributes: {
          name: 'api',
          limit: 300,
          'window-seconds': 60,
          remaining: 297,
          'reset-at': '2026-10-20T12:01:00.000Z',
        },
      },
    ],
    links: { next: null },
  };
}

export function apiLogResource(
  overrides: Partial<ApiLogResource['attributes']> = {},
  id: string = INTEGRATION_IDS.apiLog,
): ApiLogResource {
  return {
    type: 'api-log',
    id,
    attributes: {
      method: 'POST',
      path: `/api/v1/inquiries/${INTEGRATION_IDS.inquiry}/approve`,
      route: '/api/v1/inquiries/:id/approve',
      status: 200,
      'duration-ms': 42,
      'request-id': 'req-synthetic-0002',
      'idempotency-key': 'idem-synthetic-1',
      'api-key-id': INTEGRATION_IDS.apiKey,
      'user-id': null,
      'ip-address': '203.0.113.7',
      'user-agent': 'synthetic-agent/1.0',
      query: null,
      'request-body': { meta: { comment: 'synthetic' } },
      'response-body': {
        data: { type: 'inquiry', id: INTEGRATION_IDS.inquiry, attributes: { fields: { age: 42 } } },
      },
      'created-at': AT,
      ...overrides,
    },
  };
}

export function eventResource(
  overrides: Partial<EventResource['attributes']> = {},
  id: string = INTEGRATION_IDS.event,
): EventResource {
  return {
    type: 'event',
    id,
    attributes: {
      name: 'inquiry.redacted',
      payload: {
        data: {
          type: 'inquiry',
          id: INTEGRATION_IDS.inquiry,
          attributes: { 'redacted-at': AT },
        },
      },
      simulated: false,
      'created-at': AT,
      ...overrides,
    },
  };
}

/**
 * The item at `index`.
 * @throws {Error} when there is none, so tests fail with a clear message.
 */
export function nth<Item>(items: readonly Item[], index: number): Item {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`No item at index ${String(index)}`);
  }
  return item;
}

/** `{ data, links }` of one list page. */
export function listOf<Resource>(data: readonly Resource[], next: string | null = null) {
  return { data, links: { next } };
}
