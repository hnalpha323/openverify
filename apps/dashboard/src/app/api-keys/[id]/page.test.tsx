import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTEGRATION_IDS, apiKeyResource } from '../../../components/integrations/testing-fixtures';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../../testing/api-mock';
import { fakeRequest } from '../../../testing/fake-request';
import { expectNotFound } from '../../../testing/next-errors';
import ApiKeyPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../actions', () => ({
  updateApiKey: vi.fn(),
  expireApiKey: vi.fn(),
  cloneApiKey: vi.fn(),
  rotateApiKey: vi.fn(),
}));

const { apiKey: KEY_ID } = INTEGRATION_IDS;

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T12:00:00.000Z') });
});

afterEach(() => {
  api.restore();
  vi.useRealTimers();
});

const page = (id: string = KEY_ID) => ApiKeyPage({ params: Promise.resolve({ id }) });

async function renderPage() {
  render(<ToastProvider>{await page()}</ToastProvider>);
}

describe('API key page', () => {
  it('shows the key and the changes the role allows', async () => {
    api
      .reply(200, meDocument({ permissions: ['api-keys:read', 'api-keys:write'] }))
      .reply(200, { data: apiKeyResource() });

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'CI deploys' })).toBeVisible();
    const details = screen.getByRole('region', { name: 'Details' });
    expect(details).toHaveTextContent('Active');
    expect(details).toHaveTextContent('ov_sbx_abcd…');
    expect(details).toHaveTextContent('inquiries:read');
    expect(details).toHaveTextContent('webhooks:read');
    expect(details).toHaveTextContent('203.0.113.0/24');
    expect(details).toHaveTextContent('2026-10-01');
    expect(details).toHaveTextContent(KEY_ID);
    expect(screen.getByText('Personal data').nextElementSibling).toHaveTextContent('Visible');
    for (const name of ['Edit', 'Clone', 'Expire']) {
      expect(screen.getByRole('button', { name })).toBeVisible();
    }
    expect(api.last().path).toBe(`/api/v1/api-keys/${KEY_ID}`);
  });

  it('shows a read-only role an expired key without changes', async () => {
    api.reply(200, meDocument({ permissions: ['api-keys:read'] })).reply(200, {
      data: apiKeyResource({
        'allowed-ips': [],
        'expires-at': '2026-10-19T12:00:00.000Z',
        'last-used-at': null,
      }),
    });

    await renderPage();

    const details = screen.getByRole('region', { name: 'Details' });
    expect(details).toHaveTextContent('Expired');
    expect(details).toHaveTextContent('Every address');
    expect(details).toHaveTextContent('Never');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says when the key sees personal data masked (C25.6)', async () => {
    api
      .reply(200, meDocument({ permissions: ['api-keys:read'] }))
      .reply(200, { data: apiKeyResource({ 'pii-masked': true }) });

    await renderPage();

    expect(screen.getByText('Personal data').nextElementSibling).toHaveTextContent(
      'Masked: this key reads field values, notes, IP addresses and user agents as empty, and cannot download files.',
    );
  });

  it("tells an operator who sees personal data that a masked key's copy is masked too (C25.6)", async () => {
    api
      .reply(200, meDocument({ permissions: ['api-keys:read', 'api-keys:write', 'pii:view'] }))
      .reply(200, { data: apiKeyResource({ 'pii-masked': true }) });
    await renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Clone' }));

    expect(screen.getByRole('dialog', { name: 'Clone this API key?' })).toHaveTextContent(
      'Like this key, the copy cannot see personal data.',
    );
  });

  it('is not found for a malformed id', async () => {
    await expectNotFound(page('key_nope'));

    expect(api.requests).toHaveLength(0);
  });

  it('shows the forbidden panel without api-keys:read', async () => {
    api.reply(200, meDocument({ permissions: ['webhooks:read'] }));

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('API key');
  });
});

describe('API key page: Workflow 9C (C169.1 to C169.3)', () => {
  it('shows the note, the attribute blocklist and the age warning in words', async () => {
    api.reply(200, meDocument({ permissions: ['api-keys:read', 'api-keys:write'] })).reply(200, {
      data: apiKeyResource({
        note: 'For the CI pipeline',
        'attribute-blocklist': ['name-first', 'birthdate'],
        'age-warning': true,
        'created-at': '2026-06-01T12:00:00.000Z',
      }),
    });

    await renderPage();

    const details = screen.getByRole('region', { name: 'Details' });
    expect(details).toHaveTextContent('For the CI pipeline');
    expect(details).toHaveTextContent('name-first');
    expect(details).toHaveTextContent('birthdate');
    expect(
      screen.getByText(
        '141 days old: older than the age warning this environment sets. Rotate it and switch your systems to the new token.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeVisible();
  });

  it('says a key without a note or a blocklist has none, and shows no warning for a young key', async () => {
    api.reply(200, meDocument({ permissions: ['api-keys:read'] })).reply(200, {
      data: apiKeyResource({ note: null, 'attribute-blocklist': [], 'age-warning': false }),
    });

    await renderPage();

    const details = screen.getByRole('region', { name: 'Details' });
    expect(details).toHaveTextContent('No note');
    expect(details).toHaveTextContent('Every attribute is served');
    expect(screen.queryByText(/older than the age warning/u)).toBeNull();
  });
});
