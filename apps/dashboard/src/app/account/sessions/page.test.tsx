import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../../testing/api-mock';
import { fakeRequest } from '../../../testing/fake-request';
import { SETTINGS_IDS, sessionResource, sessionsDocument } from '../../../testing/routes/settings';
import SessionsPage, { metadata } from './page';

vi.mock('./actions', () => ({ revokeSession: vi.fn(), revokeOtherSessions: vi.fn() }));
vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

async function renderPage() {
  render(<ToastProvider>{await SessionsPage()}</ToastProvider>);
}

describe('my sessions (C168.4)', () => {
  it('lists the caller’s sessions with device, created and last seen, the current one marked', async () => {
    api.reply(200, meDocument({ permissions: [] })).reply(200, sessionsDocument());

    await renderPage();

    expect(metadata.title).toBe('Your sessions');
    expect(screen.getByRole('heading', { level: 1, name: 'Your sessions' })).toBeVisible();
    const table = screen.getByRole('table', { name: 'Your sessions' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const rowAt = (index: number) => {
      const row = rows[index];
      if (row === undefined) {
        throw new Error(`No row ${String(index)}`);
      }
      return within(row);
    };
    const current = rowAt(0);
    expect(current.getByText('Chrome on macOS')).toBeVisible();
    expect(current.getByText('This session')).toBeVisible();
    expect(current.queryByRole('button')).toBeNull();
    const other = rowAt(1);
    expect(other.getByText('Unknown device')).toBeVisible();
    expect(
      other.getByRole('button', {
        name: `Sign out this session (Unknown device, ${SETTINGS_IDS.otherSession})`,
      }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out every other session' })).toBeVisible();
    expect(
      screen.getByText(
        'Adding a second factor on the Security page signs out your other sessions.',
      ),
    ).toBeVisible();
    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/dashboard/sessions' });
  });

  it("shows the identity provider's sign-in methods of an SSO session, as the provider stated them (C248.6, KP11-90)", async () => {
    api.reply(200, meDocument({ permissions: [] })).reply(200, {
      data: [
        sessionResource(SETTINGS_IDS.currentSession, {
          current: true,
          device: 'Chrome on macOS',
          'provider-amr': ['pwd', 'mfa'],
        }),
        sessionResource(SETTINGS_IDS.otherSession, { device: 'Firefox on Linux' }),
      ],
      links: { next: null },
    });

    await renderPage();

    const table = screen.getByRole('table', { name: 'Your sessions' });
    expect(
      within(table).getByRole('columnheader', { name: 'Sign-in methods (identity provider)' }),
    ).toBeVisible();
    const [sso, password] = within(table).getAllByRole('row').slice(1);
    expect(within(sso ?? table).getByText('pwd, mfa')).toBeVisible();
    expect(within(password ?? table).getByText('None stated')).toBeVisible();
  });

  it('asks before signing out every other session', async () => {
    api.reply(200, meDocument({ permissions: [] })).reply(200, sessionsDocument());

    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out every other session' }));

    expect(
      screen.getByRole('dialog', { name: 'Sign out every other session?' }),
    ).toHaveAccessibleDescription(
      'Every session but this one ends at once, on any device. This one stays signed in.',
    );
  });

  it('offers nothing to sign out when this is the only session', async () => {
    const only = sessionsDocument();
    api
      .reply(200, meDocument({ permissions: [] }))
      .reply(200, { ...only, data: only.data.slice(0, 1) });

    await renderPage();

    expect(screen.queryByRole('button', { name: 'Sign out every other session' })).toBeNull();
  });
});
