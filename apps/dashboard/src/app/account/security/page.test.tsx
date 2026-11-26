import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { CREATED_AT, SESSION_TOKEN } from '../../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../../testing/api-mock';
import { fakeRequest } from '../../../testing/fake-request';
import { ToastProvider } from '../../../components/toasts';
import SecurityError from './error';
import Loading from './loading';
import SecurityPage, { metadata } from './page';

vi.mock('../../actions/account-security', () => ({
  startTotpEnrolment: vi.fn(),
  confirmTotpEnrolment: vi.fn(),
  startWebauthnEnrolment: vi.fn(),
  finishWebauthnEnrolment: vi.fn(),
  removeMfaFactor: vi.fn(),
  regenerateCodes: vi.fn(),
  signInAgain: vi.fn(),
}));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration: vi.fn() }));
vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));

const active = {
  type: 'mfa-factor',
  id: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
  attributes: {
    kind: 'totp',
    name: 'Phone',
    status: 'active',
    'created-at': CREATED_AT,
    'confirmed-at': CREATED_AT,
    'last-used-at': null,
  },
};

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
  vi.restoreAllMocks();
});

async function renderPage() {
  render(<ToastProvider>{await SecurityPage()}</ToastProvider>);
}

describe('account security page', () => {
  it("lists the operator's factors, with ways to add, remove and regenerate", async () => {
    api.reply(200, meDocument()).reply(200, { data: [active], links: { next: null } });

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Account security' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Second factors' })).toHaveTextContent('Phone');
    expect(screen.getByRole('button', { name: 'Add an authenticator app' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add a security key' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove Phone' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Regenerate recovery codes' })).toBeVisible();
  });

  it('says the organization requires a factor when this session has none (C15)', async () => {
    api
      .reply(200, meDocument({ mfaSatisfied: false }))
      .reply(200, { data: [], links: { next: null } });

    await renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your organization requires a second factor',
    );
    expect(screen.getByRole('button', { name: 'Add an authenticator app' })).toBeVisible();
    expect(screen.getByText('No second factor yet.')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Regenerate recovery codes' }),
    ).not.toBeInTheDocument();
  });

  it('asks a session from before the enrolment to sign in again with the factor (2B F002)', async () => {
    api
      .reply(200, meDocument({ mfaSatisfied: false }))
      .reply(200, { data: [active], links: { next: null } });

    await renderPage();

    expect(
      screen.getByRole('heading', { name: 'Sign in again with your second factor' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Add an authenticator app' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Phone' })).not.toBeInTheDocument();
  });

  it('leads to the operator’s sessions and says that adding a factor signs the others out (C168.4)', async () => {
    api.reply(200, meDocument()).reply(200, { data: [active], links: { next: null } });

    await renderPage();

    expect(screen.getByRole('link', { name: 'See and end your sessions' })).toHaveAttribute(
      'href',
      '/account/sessions',
    );
    expect(
      screen.getByText(
        'Adding a second factor on the Security page signs out your other sessions.',
      ),
    ).toBeVisible();
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Account security');
  });
});

describe('account security loading and error states', () => {
  it('announces that the settings are loading', () => {
    render(<Loading />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your security settings…');
  });

  it('explains a failure and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<SecurityError error={new Error('internal')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your security settings could not be loaded.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
