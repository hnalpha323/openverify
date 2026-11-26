/**
 * C251.3 (Workflow 11B, `quotas`; a named borrowed edit of Phase 9's settings page): the settings
 * page shows the queue panel of the session's environment to every reader of the settings, with the
 * caps the server reports.
 */
import { DASHBOARD_SETTINGS_DEFAULTS, type DashboardSettings } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../../components/operators/test-fixtures';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import SettingsPage from './page';

vi.mock('./actions', () => ({ saveSettings: vi.fn() }));
vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

function signedIn(permissions: readonly Permission[], values: DashboardSettings) {
  api.on('GET', '/dashboard/me', 200, meDocument({ permissions: [...permissions] }));
  api.on('GET', '/dashboard/settings', 200, values);
}

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

async function renderPage() {
  render(<ToastProvider>{await SettingsPage()}</ToastProvider>);
}

describe('the settings page’s queue panel (C251.3)', () => {
  it.each([
    ['a reader', ['settings:read']],
    ['a writer', ['settings:read', 'settings:write']],
  ] as const)('shows %s each queue’s cap', async (_who, permissions) => {
    signedIn(
      permissions,
      settings({
        ...DASHBOARD_SETTINGS_DEFAULTS,
        'queue-in-flight-caps': { 'report-run': 4 },
        'workflow-in-flight-cap': 30,
      }),
    );

    await renderPage();

    const table = screen.getByRole('table', { name: 'Queues in Sandbox' });
    const row = (name: string) =>
      within(table).getByRole('rowheader', { name }).closest('tr') as HTMLElement;
    expect(within(row('Report runs')).getAllByRole('cell')[1]).toHaveTextContent('4');
    expect(within(row('Workflow steps')).getAllByRole('cell')[1]).toHaveTextContent('30');
    expect(within(row('Report runs')).getAllByRole('cell')[0]).toHaveTextContent('Not reported');
  });
});
