import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTEGRATION_IDS,
  deliveryResource,
} from '../../../../../components/integrations/testing-fixtures';
import { SESSION_COOKIE } from '../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../../../../testing/api-mock';
import { fakeRequest } from '../../../../../testing/fake-request';
import { expectNotFound } from '../../../../../testing/next-errors';
import DeliveryPage, { metadata } from './page';

vi.mock('next/headers', () =>
  import('../../../../../testing/fake-request').then((m) => m.nextHeaders),
);

const { webhook: WEBHOOK, delivery: DELIVERY, event: EVENT } = INTEGRATION_IDS;

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

const page = (id: string = WEBHOOK, deliveryId: string = DELIVERY) =>
  DeliveryPage({ params: Promise.resolve({ id, deliveryId }) });

describe('delivery page', () => {
  it('shows the delivery and every attempt', async () => {
    api
      .reply(200, meDocument({ permissions: ['webhooks:read', 'events:read'] }))
      .reply(200, { data: deliveryResource({ 'next-attempt-at': '2026-10-20T05:05:00.000Z' }) });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: `Delivery ${DELIVERY}` })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Webhook' })).toHaveAttribute(
      'href',
      `/webhooks/${WEBHOOK}`,
    );
    expect(screen.getByRole('link', { name: EVENT })).toHaveAttribute('href', `/events/${EVENT}`);
    expect(screen.getByText('Failed')).toBeVisible();
    expect(screen.getByText('inquiry.approved')).toBeVisible();
    expect(screen.getByText('Oct 20, 2026, 5:05 AM')).toBeVisible();

    const attempts = screen.getByRole('table', { name: 'Attempts' });
    const [, first, second] = within(attempts).getAllByRole('row');
    expect(first).toHaveTextContent('1');
    expect(first).toHaveTextContent('500');
    expect(first).toHaveTextContent('120 ms');
    expect(second).toHaveTextContent('No response');
    expect(second).toHaveTextContent('The request timed out.');
    expect(api.last().path).toBe(`/api/v1/webhook-deliveries/${DELIVERY}`);
  });

  it('names the event without a link for a role that cannot read events', async () => {
    api
      .reply(200, meDocument({ permissions: ['webhooks:read'] }))
      .reply(200, { data: deliveryResource({ status: 'pending', attempts: [] }) });

    render(await page());

    expect(screen.getByText(EVENT)).toBeVisible();
    expect(screen.queryByRole('link', { name: EVENT })).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Attempts' })).toHaveTextContent('No attempt yet.');
  });

  it("is not found when the delivery is another webhook's", async () => {
    api
      .reply(200, meDocument({ permissions: ['webhooks:read'] }))
      .reply(200, { data: deliveryResource({ 'webhook-id': INTEGRATION_IDS.clonedWebhook }) });

    await expectNotFound(page());
  });

  it('is not found for malformed ids, without calling the API', async () => {
    await expectNotFound(page(WEBHOOK, 'whd_nope'));
    await expectNotFound(page('wbh_nope', DELIVERY));

    expect(api.requests).toHaveLength(0);
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Webhook delivery');
  });
});
