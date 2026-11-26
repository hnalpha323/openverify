// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTEGRATION_IDS } from '../../../components/integrations/testing-fixtures';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../../testing/api-mock';
import { fakeRequest } from '../../../testing/fake-request';
import { deliverySearchDocument } from '../../../testing/routes/settings';
import { searchDeliveries } from './actions';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

const query = () => {
  const data = new FormData();
  data.set('combine', 'and');
  data.append('clause-attribute', 'status');
  data.append('clause-negate', 'is');
  data.append('clause-operator', 'eq');
  data.append('clause-value', 'failed');
  return data;
};

describe('searchDeliveries (C165.4)', () => {
  it('posts the search and answers the deliveries with the next cursor', async () => {
    api
      .reply(200, meDocument({ permissions: ['webhooks:read'] }))
      .reply(
        200,
        deliverySearchDocument(
          '/api/v1/webhook-deliveries/search?page%5Bafter%5D=whd_01J9ZK3M5Q7R8S9T0V1W2X3Y63',
        ),
      );

    const result = await searchDeliveries(null, query());

    expect(result).toMatchObject({
      ok: true,
      data: {
        deliveries: [{ id: INTEGRATION_IDS.delivery }],
        next: 'whd_01J9ZK3M5Q7R8S9T0V1W2X3Y63',
      },
    });
    expect(api.last()).toMatchObject({ method: 'POST', path: '/api/v1/webhook-deliveries/search' });
  });

  it('needs webhooks:read, and calls nothing without it', async () => {
    api.reply(200, meDocument({ permissions: ['inquiries:read'] }));

    await expect(searchDeliveries(null, query())).resolves.toMatchObject({ ok: false });
    expect(api.requests).toHaveLength(1);
  });
});
