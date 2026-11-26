import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LoginPage, { metadata } from './page';

const mocks = vi.hoisted(() => ({ login: vi.fn(), logout: vi.fn() }));

vi.mock('../actions/auth', () => mocks);

const page = async (searchParams: Record<string, string> = {}) =>
  render(await LoginPage({ searchParams: Promise.resolve(searchParams) }));

describe('login page', () => {
  it('renders the sign-in form under the page heading', async () => {
    await page();

    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to OpenVerify' })).toBeVisible();
    expect(screen.getByLabelText('Email')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('submits to the login server action', async () => {
    mocks.login.mockResolvedValueOnce({ error: 'invalid_credentials' });
    await page();

    await userEvent.type(screen.getByLabelText('Email'), 'operator@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(mocks.login).toHaveBeenCalledOnce();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email or password is incorrect.',
    );
  });

  it.each([
    ['mfa-attempts', 'Too many wrong codes. Sign in again.'],
    ['mfa-expired', 'The sign-in took too long. Sign in again.'],
    ['mfa-invalid', 'That sign-in is no longer valid. Sign in again.'],
    ['mfa-reauth', 'Sign in again with your second factor.'],
    // C245.2 (Workflow 11B): the API ended the session; `/login/signed-out` cleared the cookie.
    ['session-idle', 'You were signed out after inactivity. Sign in again.'],
    ['session-absolute', 'Your session reached its time limit. Sign in again.'],
    ['invitation-accepted', 'Your account is ready. Sign in with your email and new password.'],
    [
      'no-environment-role',
      'Your account holds no role in any environment of this organization, so the console cannot open. Ask an administrator of your organization to give you a role.',
    ],
    [
      'signout-incomplete',
      'You are signed out in this browser, but OpenVerify could not end the session on the server. It stops working when it expires. To end it now, sign in and sign out again.',
    ],
  ])('explains why the operator is back here (%s)', async (reason, message) => {
    await page({ reason });

    expect(screen.getByText(message)).toBeVisible();
  });

  it('says in words when the account holds no role in any environment, never which roles exist (C167.2; K9-9)', async () => {
    mocks.login.mockResolvedValueOnce({ error: 'no_environment_role' });
    await page();

    await userEvent.type(screen.getByLabelText('Email'), 'operator@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your account holds no role in any environment of this organization, so the console cannot open. Ask an administrator of your organization to give you a role.',
    );
  });

  it('ignores an unknown reason', async () => {
    await page({ reason: '<script>' });

    expect(screen.queryByText(/<script>/)).not.toBeInTheDocument();
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Sign in');
  });
});
