import { PERMISSIONS } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { SESSION_COOKIE } from '../lib/session-cookie';
import { SESSION_TOKEN } from '../testing/api-fixtures';
import { ENVIRONMENTS, meDocument, mockApi, type MockApi } from '../testing/api-mock';
import { fakeRequest } from '../testing/fake-request';
import { redirectTarget } from '../testing/next-errors';
import { ConsoleLayout, switchableEnvironments } from './console-layout';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(() => Promise.resolve()),
  switchEnvironment: vi.fn(),
  pathname: '/inquiries',
}));

vi.mock('../app/actions/auth', () => ({ logout: mocks.logout }));
vi.mock('../app/actions/environment', () => ({ switchEnvironment: mocks.switchEnvironment }));
vi.mock('next/headers', () => import('../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => mocks.pathname,
}));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

async function renderLayout() {
  render(
    await ConsoleLayout({
      children: (
        <main>
          <h1>Page content</h1>
        </main>
      ),
    }),
  );
}

describe('ConsoleLayout', () => {
  it('says on every page when the script policy is only reported, not enforced (C170.5)', async () => {
    vi.stubEnv('OPENVERIFY_DASHBOARD_CSP_MODE', 'report-only');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    api.reply(200, meDocument({ permissions: [...PERMISSIONS] }));

    await renderLayout();

    expect(screen.getByRole('status', { name: 'Script policy' })).toHaveTextContent(
      'Script policy not enforced.',
    );
  });

  it('shows no script policy banner while the policy is enforced (C170.5)', async () => {
    api.reply(200, meDocument({ permissions: [...PERMISSIONS] }));

    await renderLayout();

    expect(screen.queryByRole('status', { name: 'Script policy' })).toBeNull();
  });

  it('frames every page with the environment banner, the header and the navigation', async () => {
    api.reply(200, meDocument({ permissions: [...PERMISSIONS] }));

    await renderLayout();

    expect(screen.getByRole('status', { name: 'Environment' })).toHaveTextContent('Sandbox');
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'OpenVerify Dashboard' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(within(banner).getByText('Synthetic Operator')).toBeVisible();
    expect(within(banner).getByRole('link', { name: 'Security' })).toHaveAttribute(
      'href',
      '/account/security',
    );
    expect(within(banner).getByRole('link', { name: 'Notification settings' })).toHaveAttribute(
      'href',
      '/notifications',
    );
    expect(screen.getByRole('navigation', { name: 'Console' })).toBeVisible();
    expect(screen.getByRole('main')).toHaveTextContent('Page content');
  });

  it('names an operator without a name by their email', async () => {
    api.reply(200, meDocument({ name: null }));

    await renderLayout();

    expect(within(screen.getByRole('banner')).getByText('operator@example.test')).toBeVisible();
  });

  it('lets keyboard users skip to the page content', async () => {
    api.reply(200, meDocument());

    await renderLayout();

    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#content');
    expect(document.getElementById('content')).toContainElement(screen.getByRole('main'));
  });

  it('shows only the navigation the role allows', async () => {
    api.reply(200, meDocument({ permissions: ['inquiries:read', 'accounts:read'] }));

    await renderLayout();

    const nav = screen.getByRole('navigation', { name: 'Console' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Inquiries', 'Accounts', 'Account types']);
  });

  it('shows no navigation to a session that must pass MFA first', async () => {
    api.reply(200, meDocument({ permissions: [...PERMISSIONS], mfaSatisfied: false }));

    await renderLayout();

    expect(screen.queryByRole('navigation', { name: 'Console' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Security' })).toBeVisible();
  });

  it('signs out through the logout server action', async () => {
    api.reply(200, meDocument());
    await renderLayout();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(mocks.logout).toHaveBeenCalledOnce();
  });

  it('offers production to an operator allowed into it, when the API names it', async () => {
    api.reply(
      200,
      meDocument({
        permissions: ['inquiries:read', 'environments:production'],
        environments: [ENVIRONMENTS.sandbox, ENVIRONMENTS.production],
      }),
    );

    await renderLayout();

    expect(screen.getByRole('button', { name: 'Switch to production' })).toBeVisible();
  });

  it('sends the operator to sign in without a session', async () => {
    fakeRequest.cookies.clear();

    await expect(redirectTarget(ConsoleLayout({ children: null }))).resolves.toBe('/login');
  });
});

describe('switchableEnvironments', () => {
  const both = [ENVIRONMENTS.sandbox, ENVIRONMENTS.production];

  it('offers the other environments the operator may enter', () => {
    expect(
      switchableEnvironments({
        environment: ENVIRONMENTS.sandbox,
        environments: both,
        permissions: new Set(['environments:production']),
      }),
    ).toEqual([ENVIRONMENTS.production]);
  });

  it('never offers production without environments:production (a reviewer cannot switch)', () => {
    expect(
      switchableEnvironments({
        environment: ENVIRONMENTS.sandbox,
        environments: both,
        permissions: new Set(['inquiries:read']),
      }),
    ).toEqual([]);
  });

  it('always offers the way back to the sandbox', () => {
    expect(
      switchableEnvironments({
        environment: ENVIRONMENTS.production,
        environments: both,
        permissions: new Set(),
      }),
    ).toEqual([ENVIRONMENTS.sandbox]);
  });
});
