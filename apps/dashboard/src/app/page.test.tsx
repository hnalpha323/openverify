import { PERMISSIONS } from '@openverify/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../lib/session-cookie';
import { SESSION_TOKEN } from '../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../testing/api-mock';
import { fakeRequest } from '../testing/fake-request';
import { redirectTarget } from '../testing/next-errors';
import RootError from './error';
import RootLayout, { metadata } from './layout';
import NotFound from './not-found';
import HomePage from './page';

vi.mock('next/headers', () => import('../testing/fake-request').then((m) => m.nextHeaders));

const mocks = vi.hoisted(() => ({ connection: vi.fn(() => Promise.resolve()) }));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: mocks.connection,
}));

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

describe('dashboard home page', () => {
  it('opens the inquiries list for an operator who may read it', async () => {
    api.reply(200, meDocument({ permissions: [...PERMISSIONS] }));

    await expect(redirectTarget(HomePage())).resolves.toBe('/inquiries');
  });

  it("opens the first page the operator's role allows", async () => {
    api.reply(200, meDocument({ permissions: ['users:read', 'roles:read'] }));

    await expect(redirectTarget(HomePage())).resolves.toBe('/users');
  });

  it('sends a session that must pass MFA first to the security page', async () => {
    api.reply(200, meDocument({ mfaSatisfied: false }));

    await expect(redirectTarget(HomePage())).resolves.toBe('/account/security');
  });

  it('sends a visitor without a session to sign in', async () => {
    fakeRequest.cookies.clear();

    await expect(redirectTarget(HomePage())).resolves.toBe('/login');
  });
});

describe('root layout', () => {
  it('wraps pages in an English html document', async () => {
    const html = renderToString(await Promise.resolve(RootLayout({ children: <p>Page</p> })));

    expect(html).toMatch(/^<html lang="en">/);
    expect(html).toContain('<p>Page</p>');
    expect(html).toContain('aria-label="Notifications"');
  });

  it('renders every page per request, so the nonce of the console CSP reaches its scripts (C170.1, F20)', async () => {
    mocks.connection.mockClear();

    await Promise.resolve(RootLayout({ children: <p>Page</p> }));

    expect(mocks.connection).toHaveBeenCalledTimes(1);
  });

  it('titles every page after the console', () => {
    expect(metadata.title).toEqual({
      default: 'OpenVerify Dashboard',
      template: '%s · OpenVerify Dashboard',
    });
  });
});

describe('not found page', () => {
  it('says the page does not exist and leads home', () => {
    render(<NotFound />);

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/');
  });
});

describe('root error boundary', () => {
  it('explains the failure and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<RootError error={new Error('internal detail')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('This page could not be loaded.');
    expect(screen.queryByText(/internal detail/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
