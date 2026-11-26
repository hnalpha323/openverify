import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { ENVIRONMENTS, meDocument, mockApi, type MockApi } from '../../../testing/api-mock';
import { fakeRequest } from '../../../testing/fake-request';
import NewWebhookPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../actions', () => ({ createWebhook: vi.fn() }));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('new webhook page', () => {
  it('offers the webhook form with every event and API version', async () => {
    api.reply(200, meDocument({ permissions: ['webhooks:read', 'webhooks:write'] }));

    render(await NewWebhookPage());

    expect(screen.getByRole('heading', { level: 1, name: 'New webhook' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Webhooks' })).toHaveAttribute('href', '/webhooks');
    // Within their groups: a page-wide role query names all ~84 event checkboxes (about 1 s each).
    for (const [group, event] of [
      ['Inquiry', 'inquiry.approved'],
      ['Account', 'account.consolidated'],
    ] as const) {
      const events = screen.getByRole('group', { name: group });
      expect(within(events).getByRole('checkbox', { name: event })).toBeVisible();
    }
    expect(screen.getByRole('combobox', { name: 'API version' })).toHaveValue('2026-10-01');
    expect(screen.getByRole('button', { name: 'Create webhook' })).toBeVisible();
    expect(api.requests).toHaveLength(1);
  });

  it('binds the form to the session environment (Workflow 2D F002)', async () => {
    api.reply(
      200,
      meDocument({
        permissions: ['webhooks:read', 'webhooks:write'],
        environment: ENVIRONMENTS.production,
      }),
    );

    render(await NewWebhookPage());

    expect(
      new FormData(
        screen.getByRole('button', { name: 'Create webhook' }).closest('form') ?? undefined,
      ).get('environment-id'),
    ).toBe(ENVIRONMENTS.production.id);
  });

  it('shows the forbidden panel without webhooks:write', async () => {
    api.reply(200, meDocument({ permissions: ['webhooks:read'] }));

    render(await NewWebhookPage());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create webhook' })).not.toBeInTheDocument();
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('New webhook');
  });
});
