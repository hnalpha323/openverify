import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN, listDocument } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { expectNotFound, redirectTarget } from '../../testing/next-errors';
import { SESSION_COOKIE } from '../session-cookie';
import { ForbiddenError } from './errors';
import { renderPage } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('renderPage', () => {
  it('renders the page with the session and the API client when the operator may see it', async () => {
    api
      .replyTo('GET /dashboard/me', 200, meDocument({ permissions: ['inquiries:read'] }))
      .replyTo('GET /inquiries', 200, listDocument([]));

    render(
      await renderPage({ permissions: ['inquiries:read'] }, async ({ session, api: client }) => {
        const page = await client.inquiries.list();
        return (
          <p>
            {session.user.email}: {page.data.length} inquiries
          </p>
        );
      }),
    );

    expect(screen.getByText('operator@example.test: 0 inquiries')).toBeVisible();
  });

  it('renders the forbidden panel, without running the page, when a permission is missing', async () => {
    api.replyTo('GET /dashboard/me', 200, meDocument({ permissions: ['inquiries:read'] }));
    const page = vi.fn();

    render(await renderPage({ permissions: ['users:read'] }, page));

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(page).not.toHaveBeenCalled();
  });

  it('sends a session that has not satisfied required MFA to the security page', async () => {
    api.replyTo('GET /dashboard/me', 200, meDocument({ mfaSatisfied: false }));

    await expect(redirectTarget(renderPage({}, () => <p>Page</p>))).resolves.toBe(
      '/account/security',
    );
  });

  it('lets such a session through to the pages that allow it', async () => {
    api.replyTo('GET /dashboard/me', 200, meDocument({ mfaSatisfied: false }));

    render(await renderPage({ allowWithoutMfa: true }, () => <p>Security</p>));

    expect(screen.getByText('Security')).toBeVisible();
  });

  it.each([
    ['a 403 from the API', () => api.replyProblemTo('GET /inquiries', 403, 'forbidden')],
    ['a ForbiddenError', () => api],
  ])('renders the forbidden panel for %s while rendering', async (_case, answer) => {
    api.replyTo('GET /dashboard/me', 200, meDocument());
    answer();

    render(
      await renderPage({}, async ({ api: client }) => {
        if (_case === 'a ForbiddenError') {
          throw new ForbiddenError(['pii:view']);
        }
        await client.inquiries.list();
        return <p>Never</p>;
      }),
    );

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
  });

  it('sends the operator to sign in when the session ends while rendering', async () => {
    api.replyTo('GET /dashboard/me', 200, meDocument()).replyProblemTo('GET /inquiries', 401);

    await expect(
      redirectTarget(
        renderPage({}, async ({ api: client }) => {
          await client.inquiries.list();
          return null;
        }),
      ),
    ).resolves.toBe('/login');
  });

  it('sends a 401 mfa-required to the security page', async () => {
    api
      .replyTo('GET /dashboard/me', 200, meDocument())
      .replyProblemTo('GET /inquiries', 401, 'mfa-required');

    await expect(
      redirectTarget(
        renderPage({}, async ({ api: client }) => {
          await client.inquiries.list();
          return null;
        }),
      ),
    ).resolves.toBe('/account/security');
  });

  it('renders not found for a 404', async () => {
    api
      .replyTo('GET /dashboard/me', 200, meDocument())
      .replyProblemTo('GET /inquiries/inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z', 404);

    await expectNotFound(
      renderPage({}, async ({ api: client }) => {
        await client.inquiries.retrieve('inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z');
        return null;
      }),
    );
  });

  it('lets any other failure reach the error boundary', async () => {
    api.replyTo('GET /dashboard/me', 200, meDocument()).replyProblemTo('GET /inquiries', 500);

    await expect(
      renderPage({}, async ({ api: client }) => {
        await client.inquiries.list();
        return null;
      }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it('sends the operator to sign in without a session', async () => {
    fakeRequest.cookies.clear();

    await expect(redirectTarget(renderPage({}, () => null))).resolves.toBe('/login');
  });
});
