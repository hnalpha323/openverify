import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { ENVIRONMENTS, meDocument, mockApi, type MockApi } from '../../../testing/api-mock';
import { fakeRequest } from '../../../testing/fake-request';
import NewApiKeyPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../actions', () => ({ createApiKey: vi.fn() }));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('new API key page', () => {
  it("offers only the scopes the operator's role holds, and says a masked key stays masked", async () => {
    api.reply(
      200,
      meDocument({
        permissions: ['api-keys:read', 'api-keys:write', 'inquiries:read', 'users:read'],
      }),
    );

    render(await NewApiKeyPage());

    expect(screen.getByRole('heading', { level: 1, name: 'New API key' })).toBeVisible();
    const scopes = screen.getByRole('group', { name: 'Scopes' });
    expect(
      within(scopes)
        .getAllByRole('checkbox')
        .map((box) => box.getAttribute('value')),
    ).toEqual(['inquiries:read', 'api-keys:read', 'api-keys:write']);
    expect(screen.getByRole('status')).toHaveTextContent('This key will not see personal data');
    expect(api.requests).toHaveLength(1);
  });

  it('binds the form to the session environment (Workflow 2D F002)', async () => {
    api.reply(
      200,
      meDocument({
        permissions: ['api-keys:read', 'api-keys:write'],
        environment: ENVIRONMENTS.production,
      }),
    );

    render(await NewApiKeyPage());

    expect(
      new FormData(
        screen.getByRole('button', { name: 'Create API key' }).closest('form') ?? undefined,
      ).get('environment-id'),
    ).toBe(ENVIRONMENTS.production.id);
  });

  it('says nothing about masking to a role with pii:view', async () => {
    api.reply(200, meDocument({ permissions: ['api-keys:read', 'api-keys:write', 'pii:view'] }));

    render(await NewApiKeyPage());

    expect(screen.queryByText(/will not see personal data/)).not.toBeInTheDocument();
  });

  it('shows the forbidden panel without api-keys:write', async () => {
    api.reply(200, meDocument({ permissions: ['api-keys:read'] }));

    render(await NewApiKeyPage());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('New API key');
  });
});
