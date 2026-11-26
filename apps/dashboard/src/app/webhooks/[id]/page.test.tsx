import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTEGRATION_IDS,
  deliveryResource,
  listOf,
  nth,
  phase1WebhookResource,
  webhookResource,
} from '../../../components/integrations/testing-fixtures';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../../testing/api-mock';
import { fakeRequest } from '../../../testing/fake-request';
import { expectNotFound } from '../../../testing/next-errors';
import WebhookPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../actions', () => ({
  enableWebhook: vi.fn(),
  disableWebhook: vi.fn(),
  archiveWebhook: vi.fn(),
  cloneWebhook: vi.fn(),
  rotateWebhookSecret: vi.fn(),
  simulateWebhookEvent: vi.fn(),
  replayWebhookEvents: vi.fn(),
}));

const { webhook: WEBHOOK, delivery: DELIVERY, event: EVENT } = INTEGRATION_IDS;
const WRITER = ['webhooks:read', 'webhooks:write', 'events:read'] as const;

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

function page(searchParams: Record<string, string> = {}, id: string = WEBHOOK) {
  return WebhookPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(searchParams),
  });
}

async function renderPage(searchParams: Record<string, string> = {}) {
  render(<ToastProvider>{await page(searchParams)}</ToastProvider>);
}

describe('webhook page', () => {
  it('shows the configuration, the changes the role allows, and the deliveries', async () => {
    api
      .reply(200, meDocument({ permissions: [...WRITER] }))
      .reply(200, { data: webhookResource() })
      .reply(200, listOf([deliveryResource()]));

    await renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'https://hooks.example.test/openverify' }),
    ).toBeVisible();
    const details = screen.getByRole('region', { name: 'Configuration' });
    expect(details).toHaveTextContent('Enabled');
    expect(details).toHaveTextContent('inquiry.approved');
    expect(details).toHaveTextContent('2026-10-01');
    expect(details).toHaveTextContent('…Zz9_');
    expect(details).toHaveTextContent('Authorization');
    expect(details).toHaveTextContent(INTEGRATION_IDS.template);
    expect(details).toHaveTextContent('fields');
    for (const name of ['Disable', 'Rotate secret', 'Clone', 'Archive']) {
      expect(screen.getByRole('button', { name })).toBeVisible();
    }
    expect(screen.getByRole('button', { name: 'Send test event' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeVisible();

    const table = screen.getByRole('table', { name: 'Deliveries' });
    const row = nth(within(table).getAllByRole('row'), 1);
    expect(within(row).getByRole('link', { name: DELIVERY })).toHaveAttribute(
      'href',
      `/webhooks/${WEBHOOK}/deliveries/${DELIVERY}`,
    );
    expect(row).toHaveTextContent('inquiry.approved');
    expect(row).toHaveTextContent('Failed');
    expect(row).toHaveTextContent('2');
    expect(row).toHaveTextContent('No response');

    expect(api.requests[1]).toMatchObject({ path: `/api/v1/webhooks/${WEBHOOK}` });
    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[webhook-id]': WEBHOOK,
      'page[size]': '25',
    });
  });

  it('keeps the deliveries filter in the URL and pages with it', async () => {
    api
      .reply(200, meDocument({ permissions: ['webhooks:read'] }))
      .reply(200, { data: webhookResource() })
      .reply(
        200,
        listOf(
          [deliveryResource({ status: 'succeeded' })],
          `/api/v1/webhook-deliveries?page%5Bafter%5D=${DELIVERY}`,
        ),
      );

    await renderPage({ status: 'succeeded', 'event-id': EVENT });

    const filters = screen.getByRole('search', { name: 'Filter deliveries' });
    expect(within(filters).getByRole('combobox', { name: 'Status' })).toHaveValue('succeeded');
    expect(within(filters).getByRole('textbox', { name: 'Event ID' })).toHaveValue(EVENT);
    expect(api.last().query.get('filter[status]')).toBe('succeeded');
    expect(api.last().query.get('filter[event-id]')).toBe(EVENT);
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/webhooks/${WEBHOOK}?status=succeeded&event-id=${EVENT}&after=${DELIVERY}`,
    );
  });

  it('says why a filter value was not applied', async () => {
    api
      .reply(200, meDocument({ permissions: ['webhooks:read'] }))
      .reply(200, { data: webhookResource() })
      .reply(200, listOf([]));

    await renderPage({ 'event-id': 'evt_nope' });

    expect(screen.getByRole('textbox', { name: 'Event ID' })).toHaveAccessibleDescription(
      'Enter an event ID, such as evt_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z.',
    );
    expect(api.last().query.get('filter[event-id]')).toBeNull();
    expect(screen.getByRole('table', { name: 'Deliveries' })).toHaveTextContent(
      'No deliveries match.',
    );
  });

  it('shows a read-only role the configuration and deliveries, without changes', async () => {
    api
      .reply(200, meDocument({ permissions: ['webhooks:read'] }))
      .reply(200, { data: webhookResource({ status: 'disabled' }) })
      .reply(200, listOf([deliveryResource({ status: 'pending', attempts: [] })]));

    await renderPage();

    expect(screen.getByRole('region', { name: 'Configuration' })).toHaveTextContent('Disabled');
    for (const name of [
      'Enable',
      'Rotate secret',
      'Clone',
      'Archive',
      'Send test event',
      'Replay',
    ]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Deliveries' })).toHaveTextContent('Pending');
  });

  it('shows a webhook without Phase 2 settings plainly', async () => {
    api
      .reply(200, meDocument({ permissions: ['webhooks:read'] }))
      .reply(200, { data: phase1WebhookResource({ 'enabled-events': ['*'] }) })
      .reply(200, listOf([]));

    await renderPage();

    const details = screen.getByRole('region', { name: 'Configuration' });
    expect(details).toHaveTextContent('All events');
    expect(within(details).getAllByText('None').length).toBeGreaterThanOrEqual(3);
  });

  it('is not found for a malformed id, without calling the API', async () => {
    await expectNotFound(page({}, 'wbh_nope'));

    expect(api.requests).toHaveLength(0);
  });

  it('is not found when the API does not know the webhook', async () => {
    api.reply(200, meDocument({ permissions: ['webhooks:read'] })).replyProblem(404);

    await expectNotFound(page());
  });

  it('shows the forbidden panel without webhooks:read', async () => {
    api.reply(200, meDocument({ permissions: ['events:read'] }));

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.requests).toHaveLength(1);
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Webhook');
  });
});

describe('webhook page: Workflow 9C (C169.5, C169.6)', () => {
  it('names the webhook, describes it, and says when the previous secret stops signing and its alert', async () => {
    api
      .reply(200, meDocument({ permissions: [...WRITER] }))
      .reply(200, {
        data: webhookResource({
          name: 'Fulfilment',
          description: 'Approvals to fulfilment.',
          'failure-alert': { enabled: true, threshold: 3, 'window-minutes': 15 },
          'previous-secret-expires-at': '2099-10-21T04:40:00.000Z',
        }),
      })
      .reply(200, { data: [], links: { next: null } });

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Fulfilment' })).toBeVisible();
    const configuration = screen.getByRole('region', { name: 'Configuration' });
    expect(configuration).toHaveTextContent('Approvals to fulfilment.');
    expect(configuration).toHaveTextContent('On: after 3 failed first attempts within 15 minutes');
    expect(
      screen.getByText(
        'The previous signing secret keeps signing until Oct 21, 2099, 4:40 AM (UTC). Until then every delivery carries a signature for each secret, so receivers must accept either.',
      ),
    ).toBeVisible();
  });

  it('says a webhook without an alert has none, and keeps the URL as the title of an unnamed one', async () => {
    api
      .reply(200, meDocument({ permissions: [...WRITER] }))
      .reply(200, { data: webhookResource({ name: null, 'failure-alert': null }) })
      .reply(200, { data: [], links: { next: null } });

    await renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('https://');
    expect(screen.getByRole('region', { name: 'Configuration' })).toHaveTextContent(
      'Failure alertOff',
    );
  });
});
