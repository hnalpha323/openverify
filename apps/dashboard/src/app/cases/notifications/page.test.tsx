import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { CASE_IDS, notification } from '../../../testing/cases-fixtures';
import { fakeRequest } from '../../../testing/fake-request';
import {
  CASE_REVIEWER,
  NOTIFICATIONS_PATH,
  serveNotifications,
} from '../../../testing/routes/cases';
import NotificationsPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: CASE_REVIEWER });
});

afterEach(() => {
  api.restore();
});

const page = async (params: Record<string, string> = {}) =>
  render(
    <ToastProvider>
      {await NotificationsPage({ searchParams: Promise.resolve(params) })}
    </ToastProvider>,
  );

describe('the operator’s case notifications (C134.4, C142.1)', () => {
  it('lists each notification’s kind in words with a link to its case, and no comment text', async () => {
    expect(metadata.title).toBe('Notifications');
    serveNotifications(api, [
      notification(),
      notification({
        id: CASE_IDS.otherNotification,
        kind: 'mentioned',
        caseId: CASE_IDS.otherCase,
        readAt: '2026-11-03T11:00:00.000Z',
      }),
    ]);

    await page();

    const table = screen.getByRole('table', { name: 'Notifications' });
    const assigned = within(
      within(table)
        .getByRole('rowheader', { name: 'A case was assigned to you' })
        .closest('tr') as HTMLElement,
    );
    expect(assigned.getByRole('link', { name: CASE_IDS.case })).toHaveAttribute(
      'href',
      `/cases/${CASE_IDS.case}`,
    );
    expect(assigned.getByText('Unread')).toBeVisible();
    expect(
      assigned.getByRole('button', {
        name: `Mark as read: A case was assigned to you, ${CASE_IDS.case}`,
      }),
    ).toBeVisible();
    const mentioned = within(
      within(table)
        .getByRole('rowheader', { name: 'You were mentioned in a comment' })
        .closest('tr') as HTMLElement,
    );
    expect(mentioned.getByText(/^Read /u)).toBeVisible();
    expect(mentioned.queryByRole('button')).toBeNull();
    expect(Object.fromEntries(api.find('GET', NOTIFICATIONS_PATH)?.query ?? [])).toEqual({
      'page[size]': '25',
    });
    expect(screen.getByRole('link', { name: 'Unread only' })).toHaveAttribute(
      'href',
      '/cases/notifications?unread=true',
    );
  });

  it('keeps the unread ones with filter[unread]', async () => {
    serveNotifications(api, []);

    await page({ unread: 'true' });

    expect(Object.fromEntries(api.find('GET', NOTIFICATIONS_PATH)?.query ?? [])).toEqual({
      'filter[unread]': 'true',
      'page[size]': '25',
    });
    expect(screen.getByText('No unread notifications.')).toBeVisible();
  });

  it('shows the forbidden panel without cases:read', async () => {
    api.me({ permissions: ['case-queues:read'] });

    await page();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
  });
});
