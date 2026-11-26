import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../../testing/api-mock';
import { fakeRequest } from '../../../testing/fake-request';
import DeliverySearchPage, { metadata } from './page';

vi.mock('./actions', () => ({ searchDeliveries: vi.fn() }));
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

describe('delivery search page (C165.4)', () => {
  it('offers the builder to a reader of webhooks', async () => {
    api.reply(200, meDocument({ permissions: ['webhooks:read'] }));

    render(await DeliverySearchPage());

    expect(metadata.title).toBe('Search deliveries');
    expect(screen.getByRole('search', { name: 'Search webhook deliveries' })).toBeVisible();
  });

  it('shows the forbidden panel without webhooks:read', async () => {
    api.reply(200, meDocument({ permissions: ['inquiries:read'] }));

    render(await DeliverySearchPage());

    expect(screen.queryByRole('search')).toBeNull();
  });
});
