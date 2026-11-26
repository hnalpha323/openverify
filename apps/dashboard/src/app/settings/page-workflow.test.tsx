/**
 * C143.7 (Workflow 8D review R003): the workflow settings, read-only, for an operator with
 * `settings:read` alone, so a reader sees which hosts, ports, recipients, countries and limits decide
 * what a workflow may do. The private networks show only with `settings:privacy` (C124.3); without
 * it the view says they are withheld, never that there are none.
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

const current = (overrides: Partial<DashboardSettings> = {}) =>
  settings({ ...DASHBOARD_SETTINGS_DEFAULTS, ...overrides });

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

/** The value (`<dd>`) of a term (`<dt>`) inside `scope`. */
function term(scope: HTMLElement, name: RegExp): HTMLElement {
  const dt = within(scope)
    .getAllByText(name)
    .find((element) => element.tagName === 'DT');
  const dd = dt?.nextElementSibling;
  if (!(dd instanceof HTMLElement)) {
    throw new Error(`no term ${String(name)}`);
  }
  return dd;
}

const VALUES = current({
  'workflow-run-retention-days': 45,
  'workflow-in-flight-cap': 200,
  'case-retention-days': null,
  'workflow-http-ports': [8443, 9443],
  'workflow-http-hosts': null,
  'workflow-http-private-cidrs': ['10.20.0.0/16'],
  'workflow-email-recipients': [],
  'workflow-sms-countries': ['GB', 'IE'],
  'workflow-link-hosts': ['help.example.com'],
});

describe('the workflow settings, read-only (C143.7, Workflow 8D review R003)', () => {
  it('shows each workflow setting to a reader with settings:read alone, and no control', async () => {
    signedIn(['settings:read'], VALUES);

    await renderPage();

    const section = screen.getByRole('region', { name: 'Workflows in Sandbox' });
    expect(term(section, /^Run values/)).toHaveTextContent('45');
    expect(term(section, /^Steps in flight at once/)).toHaveTextContent('200');
    expect(term(section, /^Resolved cases/)).toHaveTextContent('Kept until redacted');
    expect(term(section, /^Extra HTTPS ports/)).toHaveTextContent('8443, 9443');
    expect(term(section, /^HTTPS hosts/)).toHaveTextContent('Off: any public host');
    expect(term(section, /^Email recipients allowed/)).toHaveTextContent('None');
    expect(term(section, /^SMS countries/)).toHaveTextContent('GB, IE');
    expect(term(section, /^Link hosts/)).toHaveTextContent('help.example.com');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
  });

  it('withholds the private networks without settings:privacy, saying so rather than "none"', async () => {
    signedIn(['settings:read'], VALUES);

    await renderPage();

    const section = screen.getByRole('region', { name: 'Workflows in Sandbox' });
    expect(section).not.toHaveTextContent('10.20.0.0/16');
    expect(term(section, /^Private networks/)).toHaveTextContent(
      'Shown with the settings:privacy permission',
    );
  });

  it('shows the private networks with settings:privacy', async () => {
    signedIn(['settings:read', 'settings:privacy'], VALUES);

    await renderPage();

    const section = screen.getByRole('region', { name: 'Workflows in Sandbox' });
    expect(term(section, /^Private networks/)).toHaveTextContent('10.20.0.0/16');
  });

  it('shows nothing of the workflow settings a server does not report', async () => {
    signedIn(['settings:read'], settings());

    await renderPage();

    expect(screen.queryByRole('region', { name: 'Workflows in Sandbox' })).toBeNull();
  });
});
