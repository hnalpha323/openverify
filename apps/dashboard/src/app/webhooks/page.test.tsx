import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTEGRATION_IDS,
  listOf,
  nth,
  webhookResource,
} from '../../components/integrations/testing-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import WebhooksPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const OTHER = 'wbh_01J9ZK3M5Q7R8S9T0V1W2X3Y69';

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

async function renderPage(searchParams: Record<string, string> = {}) {
  render(await WebhooksPage({ searchParams: Promise.resolve(searchParams) }));
}

describe('webhooks page', () => {
  it('leads to the delivery search (C165.4)', async () => {
    api
      .reply(200, meDocument({ permissions: ['webhooks:read'] }))
      .reply(200, listOf([webhookResource()]));

    await renderPage();

    expect(screen.getByRole('link', { name: 'Search deliveries' })).toHaveAttribute(
      'href',
      '/webhooks/deliveries',
    );
  });

  it("lists the environment's webhooks, with a way to add one", async () => {
    api.reply(200, meDocument({ permissions: ['webhooks:read', 'webhooks:write'] })).reply(
      200,
      listOf([
        webhookResource(),
        webhookResource(
          {
            url: 'https://hooks.example.test/all',
            'enabled-events': ['*'],
            status: 'archived',
          },
          OTHER,
        ),
      ]),
    );

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Webhooks' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'New webhook' })).toHaveAttribute(
      'href',
      '/webhooks/new',
    );
    const table = screen.getByRole('table', { name: 'Webhooks' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    const first = nth(rows, 1);
    expect(
      within(first).getByRole('link', { name: 'https://hooks.example.test/openverify' }),
    ).toHaveAttribute('href', `/webhooks/${INTEGRATION_IDS.webhook}`);
    expect(first).toHaveTextContent('Enabled');
    expect(first).toHaveTextContent('inquiry.approved, inquiry.declined');
    expect(rows[2]).toHaveTextContent('All events');
    expect(rows[2]).toHaveTextContent('Archived');
    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/webhooks' });
    expect(api.last().query.get('page[size]')).toBe('25');
  });

  it('names each webhook beside its endpoint, an unnamed one by its URL (C169.5, DS14; K9-12)', async () => {
    api
      .reply(200, meDocument({ permissions: ['webhooks:read'] }))
      .reply(
        200,
        listOf([
          webhookResource({ name: 'Case system', url: 'https://hooks.example.test/cases' }),
          webhookResource({ name: null, url: 'https://hooks.example.test/unnamed' }, OTHER),
        ]),
      );

    await renderPage();

    const rows = within(screen.getByRole('table', { name: 'Webhooks' })).getAllByRole('row');
    const named = nth(rows, 1);
    expect(within(named).getByRole('link', { name: 'Case system' })).toHaveAttribute(
      'href',
      `/webhooks/${INTEGRATION_IDS.webhook}`,
    );
    expect(within(named).getByRole('rowheader')).toHaveTextContent(
      'Case systemhttps://hooks.example.test/cases',
    );
    expect(
      within(nth(rows, 2)).getByRole('link', { name: 'https://hooks.example.test/unnamed' }),
    ).toHaveAttribute('href', `/webhooks/${OTHER}`);
  });

  it('shortens a long list of events', async () => {
    api.reply(200, meDocument({ permissions: ['webhooks:read'] })).reply(
      200,
      listOf([
        webhookResource({
          'enabled-events': ['inquiry.created', 'inquiry.approved', 'inquiry.declined'],
        }),
      ]),
    );

    await renderPage();

    expect(screen.getByRole('table', { name: 'Webhooks' })).toHaveTextContent(
      'inquiry.created, inquiry.approved and 1 more',
    );
  });

  it('says when there is none yet, without a way to add one for a read-only role', async () => {
    api.reply(200, meDocument({ permissions: ['webhooks:read'] })).reply(200, listOf([]));

    await renderPage();

    expect(screen.getByRole('heading', { name: 'No webhooks yet' })).toBeVisible();
    expect(
      screen.queryByRole('link', { name: /New webhook|Add a webhook/ }),
    ).not.toBeInTheDocument();
  });

  it('offers to add the first one to a role that may', async () => {
    api
      .reply(200, meDocument({ permissions: ['webhooks:read', 'webhooks:write'] }))
      .reply(200, listOf([]));

    await renderPage();

    expect(screen.getByRole('link', { name: 'Add a webhook' })).toHaveAttribute(
      'href',
      '/webhooks/new',
    );
  });

  it("pages with the API's cursor", async () => {
    api
      .reply(200, meDocument({ permissions: ['webhooks:read'] }))
      .reply(
        200,
        listOf(
          [webhookResource()],
          `/api/v1/webhooks?page%5Bsize%5D=25&page%5Bafter%5D=${INTEGRATION_IDS.webhook}`,
        ),
      );

    await renderPage({ after: OTHER });

    expect(api.last().query.get('page[after]')).toBe(OTHER);
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/webhooks?after=${INTEGRATION_IDS.webhook}`,
    );
    expect(screen.getByRole('link', { name: 'First page' })).toHaveAttribute('href', '/webhooks');
  });

  it('shows the forbidden panel without webhooks:read, without listing', async () => {
    api.reply(200, meDocument({ permissions: ['inquiries:read'] }));

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.requests).toHaveLength(1);
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Webhooks');
  });
});
