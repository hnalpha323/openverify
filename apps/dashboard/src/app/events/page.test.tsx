import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTEGRATION_IDS,
  eventResource,
  listOf,
  nth,
} from '../../components/integrations/testing-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { selfieCapture, selfieEvent } from '../../testing/selfie-fixtures';
import EventsPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const { event: EVENT, inquiry: INQUIRY } = INTEGRATION_IDS;

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
  render(await EventsPage({ searchParams: Promise.resolve(searchParams) }));
}

describe('events page', () => {
  it("lists the environment's events with their subject", async () => {
    api
      .reply(200, meDocument({ permissions: ['events:read'] }))
      .reply(200, listOf([eventResource()]));

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
    const row = nth(within(screen.getByRole('table', { name: 'Events' })).getAllByRole('row'), 1);
    expect(within(row).getByRole('link', { name: EVENT })).toHaveAttribute(
      'href',
      `/events/${EVENT}`,
    );
    expect(row).toHaveTextContent('inquiry.redacted');
    expect(row).toHaveTextContent(`inquiry ${INQUIRY}`);
    expect(row).not.toHaveTextContent('Simulated');
    expect(Object.fromEntries(api.last().query)).toEqual({ 'page[size]': '25' });
  });

  it('says a selfie capture event in words beside its name (C40.8, C47)', async () => {
    api
      .reply(200, meDocument({ permissions: ['events:read'] }))
      .reply(200, listOf([selfieEvent('selfie.processed', selfieCapture(), EVENT)]));

    await renderPage();

    const row = nth(within(screen.getByRole('table', { name: 'Events' })).getAllByRole('row'), 1);
    expect(within(row).getByText('selfie.processed')).toHaveClass('font-mono');
    expect(within(row).getByText('Selfie capture processed')).toBeVisible();
  });

  it('applies the filters of the URL and keeps them in the form', async () => {
    api
      .reply(200, meDocument({ permissions: ['events:read'] }))
      .reply(
        200,
        listOf([eventResource({ simulated: true })], `/api/v1/events?page%5Bafter%5D=${EVENT}`),
      );

    await renderPage({
      name: 'inquiry.redacted',
      'object-id': INQUIRY,
      simulated: 'true',
      'created-at-start': '2026-10-20T00:00',
    });

    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[name]': 'inquiry.redacted',
      'filter[object-id]': INQUIRY,
      'filter[simulated]': 'true',
      'filter[created-at-start]': '2026-10-20T00:00:00.000Z',
      'page[size]': '25',
    });
    const filters = screen.getByRole('search', { name: 'Filter events' });
    expect(within(filters).getByRole('combobox', { name: 'Event' })).toHaveValue(
      'inquiry.redacted',
    );
    expect(within(filters).getByRole('combobox', { name: 'Show' })).toHaveValue('true');
    expect(screen.getByRole('table', { name: 'Events' })).toHaveTextContent('Simulated');
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/events?name=inquiry.redacted&object-id=${INQUIRY}&simulated=true&created-at-start=2026-10-20T00%3A00&after=${EVENT}`,
    );
  });

  it('says why a filter was not applied, and when nothing matches', async () => {
    api.reply(200, meDocument({ permissions: ['events:read'] })).reply(200, listOf([]));

    await renderPage({ 'object-id': 'nobody' });

    expect(screen.getByRole('textbox', { name: 'Object ID' })).toHaveAccessibleDescription(
      'Enter an object ID, such as inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z.',
    );
    expect(screen.getByRole('table', { name: 'Events' })).toHaveTextContent('No events match.');
  });

  it('says when nothing happened yet', async () => {
    api.reply(200, meDocument({ permissions: ['events:read'] })).reply(200, listOf([]));

    await renderPage();

    expect(screen.getByRole('table', { name: 'Events' })).toHaveTextContent('No events yet.');
  });

  it('shows the forbidden panel without events:read', async () => {
    api.reply(200, meDocument({ permissions: ['webhooks:read'] }));

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.requests).toHaveLength(1);
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Events');
  });
});
