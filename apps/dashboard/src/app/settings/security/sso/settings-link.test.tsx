import { PERMISSIONS, type Permission } from '@openverify/core';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../../../../components/operators/test-fixtures';
import { ToastProvider } from '../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import SettingsPage from '../../page';

vi.mock('../../actions', () => ({ saveSettings: vi.fn() }));
vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.on('GET', '/dashboard/settings', 200, settings());
});

afterEach(() => {
  api.restore();
});

const page = async (permissions: readonly Permission[]) => {
  api.me({ permissions });
  return render(<ToastProvider>{await SettingsPage()}</ToastProvider>);
};

/**
 * The settings page's link to Settings → Security → Single sign-on (C248.3; sso-oidc's named
 * borrowed edit of Phase 9's settings page), so the console reaches the page from a seeded state.
 */
describe('the settings page links Settings → Security → Single sign-on', () => {
  it('for every operator who may read settings', async () => {
    await page(['settings:read']);
    expect(screen.getByRole('link', { name: 'Single sign-on' })).toHaveAttribute(
      'href',
      '/settings/security/sso',
    );
  });

  it('beside the Connect settings link', async () => {
    await page(PERMISSIONS.filter((permission) => permission !== 'audit-logs:read'));
    expect(screen.getByRole('link', { name: 'Single sign-on' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Connect settings' })).toBeVisible();
  });
});
