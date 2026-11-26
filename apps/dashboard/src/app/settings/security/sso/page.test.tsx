import { PERMISSIONS, type Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allRoles, settings } from '../../../../components/operators/test-fixtures';
import { ToastProvider } from '../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import { isValidElement, type ReactNode } from 'react';
import SsoSettingsPage, { metadata } from './page';
import { OTHER_PROVIDER_ID, PROVIDER_ID, ssoProvider } from './sso-test-fixtures';

vi.mock('./actions', () => ({
  saveSignInName: vi.fn(),
  createSsoProviderAction: vi.fn(),
  updateSsoProviderAction: vi.fn(),
  deleteSsoProviderAction: vi.fn(),
}));
vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
  vi.restoreAllMocks();
});

const as = (permissions: readonly Permission[]) => api.me({ permissions });

function serve(
  providers = [
    ssoProvider(),
    ssoProvider(
      { 'display-name': 'Contractors', enforced: true, 'client-secret-set': false },
      OTHER_PROVIDER_ID,
    ),
  ],
  slug: string | null = 'acme-sso',
  withRoles = true,
) {
  api.on('GET', '/dashboard/settings', 200, settings({ 'organization-slug': slug }));
  api.on('GET', '/dashboard/sso-providers', 200, {
    data: providers,
    links: { self: '/api/v1/dashboard/sso-providers', next: null },
  });
  if (withRoles) {
    api.on('GET', '/dashboard/roles', 200, {
      data: allRoles(),
      links: { self: '/api/v1/dashboard/roles', next: null },
    });
  }
}

/** Every serializable prop value of a tree, walked through elements, arrays and objects. */
function propsOf(node: ReactNode): string {
  const seen = new Set<unknown>();
  const walk = (value: unknown): unknown => {
    if (typeof value === 'function' || typeof value === 'symbol' || seen.has(value)) {
      return null;
    }
    if (isValidElement(value)) {
      seen.add(value);
      return walk(value.props);
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (typeof value === 'object' && value !== null) {
      seen.add(value);
      return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, walk(each)]));
    }
    return value;
  };
  return JSON.stringify(walk(node));
}

const page = async () => render(<ToastProvider>{await SsoSettingsPage()}</ToastProvider>);

describe('Settings → Security → Single sign-on (C248.3, C248.8)', () => {
  it('is titled Single sign-on', () => {
    expect(metadata.title).toBe('Single sign-on');
  });

  it('lists the providers with whether a secret is set, never a secret', async () => {
    as(PERMISSIONS);
    serve();
    await page();
    expect(screen.getByRole('heading', { level: 1, name: 'Single sign-on' })).toBeVisible();
    const rows = within(screen.getByRole('table', { name: 'Identity providers' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Workforce'),
      expect.stringContaining('Contractors'),
    ]);
    expect(rows[0]?.textContent).toContain('Set');
    expect(rows[1]?.textContent).toContain('Not set');
    expect(rows[1]?.textContent).toContain('Refused');
    expect(rows[0]?.textContent).toContain(
      `https://console.example.com/sso/callback/${PROVIDER_ID}`,
    );
    for (const input of document.querySelectorAll<HTMLInputElement>(
      'input[name="client-secret"]',
    )) {
      expect(input.type).toBe('password');
      expect(input.value).toBe('');
    }
    expect(screen.getByRole('textbox', { name: 'Sign-in name' })).toHaveValue('acme-sso');
    expect(screen.getByRole('button', { name: 'Add identity provider' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Re-authenticate with single sign-on' }),
    ).toBeVisible();
    expect(screen.getByText('Change Workforce')).toBeVisible();
  });

  it('sends the browser no client secret in its RSC payload', async () => {
    as(PERMISSIONS);
    serve();
    // Every prop the page's tree holds, server and client components alike, without rendering:
    // a superset of what React's Flight payload carries (the forms are client components
    // outside src/components, which `rscPayloadOf` would call as server components).
    const payload = propsOf(await SsoSettingsPage());
    expect(payload).not.toMatch(/client-secret"\s*:\s*"[^"]/);
    expect(payload).not.toContain('synthetic-client-secret');
    expect(payload).toContain('synthetic-client-id');
  });

  it('says to set a sign-in name before a provider can be added', async () => {
    as(PERMISSIONS);
    serve([], null);
    await page();
    expect(screen.getByText('Set a sign-in name first')).toBeVisible();
    expect(screen.getByText('No identity provider yet.')).toBeVisible();
  });

  it('shows a reader the providers and the name, with no form', async () => {
    as(['settings:read']);
    serve([ssoProvider()], 'acme-sso', false);
    await page();
    expect(screen.getByText('acme-sso')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Change Workforce')).not.toBeInTheDocument();
  });
});
