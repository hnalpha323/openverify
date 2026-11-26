import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MFA_CHALLENGE_COOKIE, encodeMfaChallenge } from '../../../lib/mfa-challenge';
import { fakeRequest } from '../../../testing/fake-request';
import { redirectTarget } from '../../../testing/next-errors';
import MfaPage, { metadata } from './page';

vi.mock('../../actions/auth', () => ({
  completeMfa: vi.fn(),
  startWebauthnLogin: vi.fn(),
  finishWebauthnLogin: vi.fn(),
  cancelMfaLogin: vi.fn(),
}));
vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: vi.fn() }));
vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));

const MFA_TOKEN = `ovm_${'M'.repeat(43)}`;

beforeEach(() => {
  fakeRequest.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MFA sign-in page', () => {
  it('offers the factor types the user has, and never shows the mfa-token', async () => {
    fakeRequest.cookies.set(
      MFA_CHALLENGE_COOKIE,
      encodeMfaChallenge({
        token: MFA_TOKEN,
        factors: ['webauthn'],
        expiresAt: Date.now() + 60_000,
      }),
    );

    const { container } = render(await MfaPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Confirm it is you' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use a security key' })).toBeVisible();
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('ovm_');
  });

  it('sends the operator back to sign in without a live challenge', async () => {
    await expect(redirectTarget(MfaPage())).resolves.toBe('/login?reason=mfa-expired');
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Confirm it is you');
  });
});
