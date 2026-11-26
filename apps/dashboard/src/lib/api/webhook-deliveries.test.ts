// @vitest-environment node
import { createClient } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { API_URL, mockApi, type MockApi } from '../../testing/api-mock';
import { listWebhookDeliveries, parseDeliveryListQuery } from './webhook-deliveries';

const WEBHOOK = 'wbh_01J9ZK3M5Q7R8S9T0V1W2X3Y60';
const EVENT = 'evt_01J9ZK3M5Q7R8S9T0V1W2X3Y61';
const DELIVERY = 'whd_01J9ZK3M5Q7R8S9T0V1W2X3Y62';

let api: MockApi;

beforeEach(() => {
  api = mockApi();
});

afterEach(() => {
  api.restore();
});

describe('parseDeliveryListQuery', () => {
  it('reads the status, event and cursor of the URL', () => {
    expect(
      parseDeliveryListQuery({ status: 'failed', 'event-id': EVENT, after: DELIVERY }),
    ).toEqual({
      values: { status: 'failed', 'event-id': EVENT },
      applied: { status: 'failed', 'event-id': EVENT },
      errors: {},
      after: DELIVERY,
    });
  });

  it('applies nothing malformed, and says why', () => {
    const query = parseDeliveryListQuery({ status: 'lost', 'event-id': 'evt_1', after: 'whd_x' });

    expect(query.applied).toEqual({});
    expect(query.after).toBeUndefined();
    expect(query.errors).toEqual({
      status: 'Choose a status from the list.',
      'event-id': 'Enter an event ID, such as evt_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z.',
    });
  });
});

describe('listWebhookDeliveries', () => {
  it("lists one page of the webhook's deliveries with the filters", async () => {
    api.reply(200, { data: [], links: { next: null } });
    const client = createClient({ apiKey: SESSION_TOKEN, baseUrl: API_URL, maxRetries: 0 });

    await listWebhookDeliveries(
      client,
      WEBHOOK,
      parseDeliveryListQuery({ status: 'failed', 'event-id': EVENT, after: DELIVERY }),
    );

    const request = api.last();
    expect(request.path).toBe('/api/v1/webhook-deliveries');
    expect(Object.fromEntries(request.query)).toEqual({
      'filter[webhook-id]': WEBHOOK,
      'filter[status]': 'failed',
      'filter[event-id]': EVENT,
      'page[size]': '25',
      'page[after]': DELIVERY,
    });
  });
});
