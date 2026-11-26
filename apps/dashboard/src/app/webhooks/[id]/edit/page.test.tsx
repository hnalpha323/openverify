import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTEGRATION_IDS,
  phase1WebhookResource,
  webhookResource,
} from '../../../../components/integrations/testing-fixtures';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../../../testing/api-mock';
import { fakeRequest } from '../../../../testing/fake-request';
import { expectNotFound } from '../../../../testing/next-errors';
import EditWebhookPage, { metadata } from './page';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('../../actions', () => ({ updateWebhook: vi.fn() }));

const { webhook: WEBHOOK } = INTEGRATION_IDS;
const WRITER = meDocument({ permissions: ['webhooks:read', 'webhooks:write'] });

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

const page = (id: string = WEBHOOK) => EditWebhookPage({ params: Promise.resolve({ id }) });

describe('edit webhook page', () => {
  it("offers the webhook's configuration to change", async () => {
    api.reply(200, WRITER).reply(200, { data: webhookResource() });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'Edit webhook' })).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'https://hooks.example.test/openverify' }),
    ).toHaveAttribute('href', `/webhooks/${WEBHOOK}`);
    expect(screen.getByRole('textbox', { name: /Endpoint URL/ })).toHaveValue(
      'https://hooks.example.test/openverify',
    );
    // Within its group: a page-wide role query names all ~84 event checkboxes (about 1 s; it
    // timed out under the full validation's load).
    const inquiry = screen.getByRole('group', { name: 'Inquiry' });
    expect(within(inquiry).getByRole('checkbox', { name: 'inquiry.approved' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Inquiry template IDs' })).toHaveValue(
      INTEGRATION_IDS.template,
    );
    expect(screen.getByText('Authorization. Their values are never shown again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeVisible();
  });

  it('explains that an archived webhook cannot change', async () => {
    api.reply(200, WRITER).reply(200, { data: webhookResource({ status: 'archived' }) });

    render(await page());

    expect(
      screen.getByText('An archived webhook cannot change. Clone it to reuse its configuration.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('shows a webhook without Phase 2 settings with empty fields', async () => {
    api.reply(200, WRITER).reply(200, { data: phase1WebhookResource() });

    render(await page());

    expect(screen.getByRole('textbox', { name: 'Inquiry template IDs' })).toHaveValue('');
    expect(screen.getByText('None.')).toBeVisible();
  });

  it('is not found for a malformed id', async () => {
    await expectNotFound(page('nope'));

    expect(api.requests).toHaveLength(0);
  });

  it('shows the forbidden panel without webhooks:write', async () => {
    api.reply(200, meDocument({ permissions: ['webhooks:read'] }));

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.requests).toHaveLength(1);
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Edit webhook');
  });
});
