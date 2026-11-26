import { DASHBOARD_SETTINGS_DEFAULTS, type DashboardSettings } from '@openverify/contracts';
import { PERMISSIONS, type Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIT_IDS,
  USER_IDS,
  auditLog,
  listOf,
  settings,
} from '../../components/operators/test-fixtures';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS, meDocument } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import SettingsPage from './page';

vi.mock('./actions', () => ({ saveSettings: vi.fn() }));
vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const AUDIT = '/dashboard/audit-logs';
let api: RouteApi;

const phase7 = (overrides: Partial<DashboardSettings> = {}) =>
  settings({ ...DASHBOARD_SETTINGS_DEFAULTS, ...overrides });

function signedIn(permissions: readonly Permission[], values = phase7()) {
  api.on('GET', '/dashboard/me', 200, meDocument({ permissions: [...permissions] }));
  api.on('GET', '/dashboard/settings', 200, values);
}

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.on(
    'GET',
    AUDIT,
    200,
    listOf([
      auditLog({
        id: AUDIT_IDS.first,
        action: 'settings.updated',
        actor: { type: 'user', id: USER_IDS.admin },
        'resource-type': 'environment',
        'resource-id': ENVIRONMENTS.sandbox.id,
        metadata: {
          'signal-collection': {
            'session-integrity': 'on',
            'device-recognition': 'exempt',
            'device-recognition-basis': 'Synthetic basis',
          },
        },
      }),
      auditLog({
        id: AUDIT_IDS.second,
        action: 'settings.updated',
        'resource-type': 'environment',
        'resource-id': ENVIRONMENTS.sandbox.id,
        metadata: { 'api-log-retention-days': 7 },
      }),
    ]),
  );
});

afterEach(() => {
  api.restore();
});

async function renderPage() {
  render(<ToastProvider>{await SettingsPage()}</ToastProvider>);
}

describe('the settings page: Phase 7 (C107.7, C108)', () => {
  it('lets a principal with settings:privacy change the collection tiers', async () => {
    signedIn([...PERMISSIONS]);

    await renderPage();

    expect(screen.getByRole('combobox', { name: 'Session integrity' })).toBeVisible();
  });

  it('shows the privacy settings read-only to a principal with settings:write alone', async () => {
    signedIn(['settings:read', 'settings:write']);

    await renderPage();

    expect(screen.queryByRole('combobox', { name: 'Session integrity' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Organization display name' })).toBeVisible();
  });

  it('shows every Phase 7 setting read-only with settings:read alone', async () => {
    signedIn(['settings:read'], phase7({ 'organization-display-name': 'Example Org' }));

    await renderPage();

    const signals = screen.getByRole('region', { name: 'Signals in Sandbox' });
    expect(signals).toHaveTextContent('Session integrity');
    expect(signals).toHaveTextContent('On');
    expect(signals).toHaveTextContent('Off');
    expect(signals).toHaveTextContent('30 days');
    expect(signals).toHaveTextContent('Kept as long as their inquiries');
    expect(screen.getByRole('region', { name: 'Device handoff' })).toHaveTextContent('Example Org');
    expect(screen.getByRole('region', { name: 'Graph in Sandbox' })).toHaveTextContent('Yes');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the audit trail of the collection tier changes with audit-logs:read', async () => {
    signedIn([...PERMISSIONS]);

    await renderPage();

    const trail = screen.getByRole('table', { name: 'Collection tier changes' });
    const row = within(trail).getByRole('rowheader', { name: AUDIT_IDS.first }).closest('tr');
    expect(row).toHaveTextContent('Exempt');
    expect(row).toHaveTextContent('Synthetic basis');
    expect(row).toHaveTextContent(USER_IDS.admin);
    expect(within(trail).queryByRole('rowheader', { name: AUDIT_IDS.second })).toBeNull();
    expect(Object.fromEntries(api.find('GET', AUDIT)?.query ?? [])).toMatchObject({
      'filter[action]': 'settings.updated',
      'filter[resource-id]': ENVIRONMENTS.sandbox.id,
    });
  });

  it('reads no audit trail without audit-logs:read', async () => {
    signedIn(['settings:read', 'settings:write', 'settings:privacy']);

    await renderPage();

    expect(screen.queryByRole('table', { name: 'Collection tier changes' })).toBeNull();
    expect(api.find('GET', AUDIT)).toBeUndefined();
  });
});
