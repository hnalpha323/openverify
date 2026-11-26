import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './page';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  startSso: vi.fn(),
  headers: vi.fn(),
}));

vi.mock('../actions/auth', () => ({ login: mocks.login, logout: mocks.logout }));
vi.mock('../(auth)/sso/sso-bff', async (original) => ({
  ...(await original<typeof import('../(auth)/sso/sso-bff')>()),
  startSso: mocks.startSso,
}));
vi.mock('next/headers', () => ({ headers: mocks.headers }));

const PROVIDER = 'ssop_01JC0000000000000000000001';

const page = async (searchParams: Record<string, string> = {}) =>
  render(await LoginPage({ searchParams: Promise.resolve(searchParams) }));

beforeEach(() => {
  mocks.startSso.mockReset();
  mocks.headers.mockResolvedValue(new Headers());
});

describe('login page: single sign-on (C248.4, C248.8; sso-oidc’s named borrowed edit)', () => {
  it('offers single sign-on by sign-in name under the password form, asking the API nothing', async () => {
    await page();
    const section = screen.getByRole('region', { name: 'Single sign-on' });
    expect(within(section).getByLabelText('Sign-in name')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(mocks.startSso).not.toHaveBeenCalled();
  });

  it('lists the providers of an organization that has several', async () => {
    mocks.startSso.mockResolvedValueOnce({
      kind: 'choose',
      providers: [
        { id: PROVIDER, displayName: 'Workforce' },
        { id: 'ssop_01JC0000000000000000000002', displayName: 'Contractors' },
      ],
    });
    await page({ sso: 'acme-sso' });
    expect(screen.getByRole('link', { name: 'Sign in with Workforce' }).getAttribute('href')).toBe(
      `/sso/acme-sso/start?provider-id=${PROVIDER}`,
    );
  });

  it('explains why a single sign-on came back, in one generic sentence', async () => {
    await page({ reason: 'sso-user-unknown' });
    expect(
      screen.getByText(
        'Your identity provider’s account does not match a user of this organization. Ask an administrator.',
      ),
    ).toBeVisible();
  });
});
