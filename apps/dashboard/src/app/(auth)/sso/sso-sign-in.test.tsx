import { render, screen, within } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SsoSignIn, ssoChoicesFor, ssoNoticeOf } from './sso-sign-in';
import { GET as fromForm } from './start/route';

const mocks = vi.hoisted(() => ({ startSso: vi.fn(), headers: vi.fn() }));

vi.mock('./sso-bff', async (original) => ({
  ...(await original<typeof import('./sso-bff')>()),
  startSso: mocks.startSso,
}));
vi.mock('next/headers', () => ({ headers: mocks.headers }));

const PROVIDER = 'ssop_01JC0000000000000000000001';
const OTHER = 'ssop_01JC0000000000000000000002';

beforeEach(() => {
  mocks.startSso.mockReset();
  mocks.headers.mockResolvedValue(new Headers({ 'user-agent': 'synthetic browser' }));
});

describe('the sign-in page’s single sign-on section (C248.4, C248.8)', () => {
  it('asks for the organization’s sign-in name in a plain GET form', () => {
    render(<SsoSignIn choosing={null} />);
    const section = screen.getByRole('region', { name: 'Single sign-on' });
    const form = section.querySelector('form');
    expect(form?.getAttribute('method')).toBe('get');
    expect(form?.getAttribute('action')).toBe('/sso/start');
    const input = within(section).getByLabelText('Sign-in name');
    expect(input.getAttribute('name')).toBe('organization');
    expect(input.getAttribute('autocomplete')).toBe('organization');
    expect(
      within(section).getByRole('button', { name: 'Continue with single sign-on' }),
    ).toBeVisible();
  });

  it('offers each provider as a plain link that never prefetches', () => {
    render(
      <SsoSignIn
        choosing={{
          organization: 'acme-sso',
          choices: [
            { id: PROVIDER, displayName: 'Workforce' },
            { id: OTHER, displayName: 'Contractors' },
          ],
        }}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Sign in with Workforce', `/sso/acme-sso/start?provider-id=${PROVIDER}`],
      ['Sign in with Contractors', `/sso/acme-sso/start?provider-id=${OTHER}`],
    ]);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('asks the API for the providers only when the sign-in page names an organization', async () => {
    await expect(ssoChoicesFor(undefined)).resolves.toBeNull();
    await expect(ssoChoicesFor('Not_A_Name')).resolves.toBeNull();
    await expect(ssoChoicesFor(['acme-sso', 'other'])).resolves.toBeNull();
    expect(mocks.startSso).not.toHaveBeenCalled();
    mocks.startSso.mockResolvedValueOnce({
      kind: 'choose',
      providers: [{ id: PROVIDER, displayName: 'Workforce' }],
    });
    await expect(ssoChoicesFor('acme-sso')).resolves.toEqual({
      organization: 'acme-sso',
      choices: [{ id: PROVIDER, displayName: 'Workforce' }],
    });
    expect(mocks.startSso).toHaveBeenCalledExactlyOnceWith('acme-sso', {}, 'synthetic browser');
    mocks.startSso.mockResolvedValueOnce({ kind: 'failed', failure: 'unavailable' });
    await expect(ssoChoicesFor('acme-sso')).resolves.toBeNull();
  });

  it('explains each failure in one generic sentence', () => {
    expect(ssoNoticeOf('sso-user-unknown')).toEqual({
      tone: 'warning',
      text: 'Your identity provider’s account does not match a user of this organization. Ask an administrator.',
    });
    expect(ssoNoticeOf('sso-state-invalid')?.text).toBe(
      'The single sign-on attempt could not be completed. Start again.',
    );
    expect(ssoNoticeOf('sso-unavailable')?.tone).toBe('warning');
    expect(ssoNoticeOf('sso-password-disabled')?.text).toBe(
      'This organization signs in with single sign-on only.',
    );
    expect(ssoNoticeOf('mfa-expired')).toBeUndefined();
    expect(ssoNoticeOf(['sso-user-unknown'])).toBeUndefined();
    expect(ssoNoticeOf(undefined)).toBeUndefined();
  });
});

describe('GET /sso/start (C248.8)', () => {
  const get = (query: string) =>
    fromForm(new NextRequest(`http://dashboard.test/sso/start${query}`));

  it('sends a sign-in name on to its start, trimmed and lower-cased', async () => {
    const response = await get('?organization=%20Acme-SSO%20');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://dashboard.test/sso/acme-sso/start');
  });

  it('answers anything else with the sign-in page’s generic sentence', async () => {
    for (const query of ['', '?organization=', '?organization=a', '?organization=..%2Fadmin']) {
      const response = await get(query);
      expect(response.headers.get('location')).toBe(
        'http://dashboard.test/login?reason=sso-not-configured',
      );
    }
  });
});
