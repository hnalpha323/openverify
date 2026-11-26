import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTEGRATION_IDS,
  deliveryResource,
  eventResource,
  listOf,
} from '../../../components/integrations/testing-fixtures';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN, inquiryResource } from '../../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../../testing/api-mock';
import { fakeRequest } from '../../../testing/fake-request';
import { expectNotFound } from '../../../testing/next-errors';
import { selfieEvent, supersededCapture } from '../../../testing/selfie-fixtures';
import EventPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));

const { event: EVENT, inquiry: INQUIRY, webhook: WEBHOOK, delivery: DELIVERY } = INTEGRATION_IDS;

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

const page = (id: string = EVENT) => EventPage({ params: Promise.resolve({ id }) });

const approved = (fields: Record<string, string | number | null>, note: string | null) =>
  eventResource({
    name: 'inquiry.approved',
    simulated: true,
    payload: { data: inquiryResource({ status: 'approved', fields, note }) },
  });

describe('event page', () => {
  it('says a selfie capture event in words under its name (C40.8, C47)', async () => {
    api
      .reply(200, meDocument({ permissions: ['events:read'] }))
      .reply(200, { data: selfieEvent('selfie.errored', supersededCapture(), EVENT) });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'selfie.errored' })).toBeVisible();
    expect(screen.getByText('Selfie capture errored')).toBeVisible();
  });

  it('shows the event, its subject, payload and deliveries', async () => {
    api
      .reply(
        200,
        meDocument({
          permissions: ['events:read', 'inquiries:read', 'webhooks:read', 'pii:view'],
        }),
      )
      .reply(200, { data: approved({ name_first: 'Synthetic' }, 'Looks fine') })
      .reply(200, listOf([deliveryResource({ status: 'succeeded' })]));

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'inquiry.approved' })).toBeVisible();
    const details = screen.getByRole('region', { name: 'Details' });
    expect(details).toHaveTextContent(EVENT);
    expect(details).toHaveTextContent('Yes');
    expect(within(details).getByRole('link', { name: INQUIRY })).toHaveAttribute(
      'href',
      `/inquiries/${INQUIRY}`,
    );
    const payload = screen.getByRole('region', { name: 'Payload' });
    expect(payload).toHaveTextContent('"name_first": "Synthetic"');
    expect(payload).toHaveTextContent('"note": "Looks fine"');

    const deliveries = screen.getByRole('table', { name: 'Webhook deliveries' });
    expect(within(deliveries).getByRole('link', { name: DELIVERY })).toHaveAttribute(
      'href',
      `/webhooks/${WEBHOOK}/deliveries/${DELIVERY}`,
    );
    expect(within(deliveries).getByRole('link', { name: WEBHOOK })).toHaveAttribute(
      'href',
      `/webhooks/${WEBHOOK}`,
    );
    expect(deliveries).toHaveTextContent('Succeeded');
    expect(api.last().query.get('filter[event-id]')).toBe(EVENT);
  });

  it('shows what the API masked as Hidden, without deliveries for a role without webhooks:read', async () => {
    api
      .reply(200, meDocument({ permissions: ['events:read'] }))
      .reply(200, { data: approved({ name_first: null }, null) });

    render(await page());

    const payload = screen.getByRole('region', { name: 'Payload' });
    expect(within(payload).getAllByText('Hidden')).toHaveLength(2);
    expect(
      within(screen.getByRole('region', { name: 'Details' })).getByText(INQUIRY),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: INQUIRY })).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Webhook deliveries' })).not.toBeInTheDocument();
    expect(api.requests).toHaveLength(2);
  });

  it('says when the subject was redacted', async () => {
    api
      .reply(200, meDocument({ permissions: ['events:read', 'webhooks:read'] }))
      .reply(200, { data: eventResource() })
      .reply(200, listOf([]));

    render(await page());

    const details = screen.getByRole('region', { name: 'Details' });
    expect(details).toHaveTextContent('Redacted');
    expect(details).toHaveTextContent('No');
    expect(screen.getByRole('table', { name: 'Webhook deliveries' })).toHaveTextContent(
      'No webhook received this event.',
    );
  });

  it('is not found for a malformed id', async () => {
    await expectNotFound(page('evt_nope'));

    expect(api.requests).toHaveLength(0);
  });

  it('shows the forbidden panel without events:read', async () => {
    api.reply(200, meDocument({ permissions: ['webhooks:read'] }));

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Event');
  });
});
