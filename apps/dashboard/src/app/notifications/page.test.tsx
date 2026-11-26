import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { preferencesDocument } from '../../testing/routes/settings';
import NotificationsPage, { metadata } from './page';

vi.mock('./actions', () => ({ saveNotificationPreferences: vi.fn() }));
vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('notification settings page (C169.7)', () => {
  it('needs only a session: shows every kind with its two channels as the API answered', async () => {
    api
      .reply(200, meDocument({ permissions: [] }))
      .reply(200, preferencesDocument({ 'webhook-failure': { console: false, email: true } }));

    render(<ToastProvider>{await NotificationsPage()}</ToastProvider>);

    expect(metadata.title).toBe('Notification settings');
    expect(screen.getByRole('heading', { level: 1, name: 'Notification settings' })).toBeVisible();
    const table = screen.getByRole('table', { name: 'Notification channels by kind' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    const webhook = 'A webhook’s failure alert fires (needs webhooks:read)';
    expect(screen.getByRole('checkbox', { name: `${webhook}: in the console` })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: `${webhook}: by email` })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'A case is assigned to you: in the console' }),
    ).toBeChecked();
    expect(
      screen.getByText(/Case notifications and webhook failure alerts follow these choices/u),
    ).toBeVisible();
    expect(screen.getByText(/hold a link to the console only/u)).toBeVisible();
    expect(api.last()).toMatchObject({
      method: 'GET',
      path: '/api/v1/dashboard/notification-preferences',
    });
  });
});
