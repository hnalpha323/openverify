import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTEGRATION_IDS, apiLogResource } from '../../../components/integrations/testing-fixtures';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../../testing/api-mock';
import { fakeRequest } from '../../../testing/fake-request';
import { expectNotFound } from '../../../testing/next-errors';
import ApiLogPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));

const { apiLog: LOG, apiKey: CALLER } = INTEGRATION_IDS;

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

const page = (id: string = LOG) => ApiLogPage({ params: Promise.resolve({ id }) });

describe('API log page', () => {
  it('shows the request and its bodies as formatted JSON', async () => {
    api
      .reply(200, meDocument({ permissions: ['api-logs:read', 'api-keys:read', 'pii:view'] }))
      .reply(200, { data: apiLogResource({ query: { include: 'verifications' } }) });

    render(await page());

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: `POST /api/v1/inquiries/${INTEGRATION_IDS.inquiry}/approve`,
      }),
    ).toBeVisible();
    const details = screen.getByRole('region', { name: 'Request' });
    expect(details).toHaveTextContent('200');
    expect(details).toHaveTextContent('/api/v1/inquiries/:id/approve');
    expect(details).toHaveTextContent('42 ms');
    expect(details).toHaveTextContent('req-synthetic-0002');
    expect(details).toHaveTextContent('idem-synthetic-1');
    expect(details).toHaveTextContent('203.0.113.7');
    expect(details).toHaveTextContent('synthetic-agent/1.0');
    expect(screen.getByRole('link', { name: CALLER })).toHaveAttribute(
      'href',
      `/api-keys/${CALLER}`,
    );
    expect(screen.getByRole('region', { name: 'Query' }).textContent).toBe(
      '{\n  "include": "verifications"\n}',
    );
    expect(screen.getByRole('region', { name: 'Request body' })).toHaveTextContent(
      '"comment": "synthetic"',
    );
    expect(screen.getByRole('region', { name: 'Response body' })).toHaveTextContent('"age": 42');
    expect(api.last().path).toBe(`/api/v1/api-logs/${LOG}`);
  });

  it('shows what the API masked as Hidden to a role without pii:view', async () => {
    api.reply(200, meDocument({ permissions: ['api-logs:read'] })).reply(200, {
      data: apiLogResource({
        'ip-address': null,
        'user-agent': null,
        'response-body': { data: { attributes: { fields: { age: null } } } },
      }),
    });

    render(await page());

    const details = screen.getByRole('region', { name: 'Request' });
    expect(details).toHaveTextContent('Hidden');
    expect(details).not.toHaveTextContent('203.0.113.7');
    expect(screen.getByRole('region', { name: 'Response body' })).toHaveTextContent('Hidden');
    expect(screen.getByRole('region', { name: 'Response body' })).not.toHaveTextContent('42');
    expect(screen.getByText(CALLER)).toBeVisible();
    expect(screen.queryByRole('link', { name: CALLER })).not.toBeInTheDocument();
  });

  it('shows the size and start of a body too large to keep whole', async () => {
    api.reply(200, meDocument({ permissions: ['api-logs:read'] })).reply(200, {
      data: apiLogResource({
        'response-body': { truncated: true, 'byte-length': 80_000, preview: '{"data":[' },
        'request-body': null,
        'api-key-id': null,
        'user-id': INTEGRATION_IDS.user,
        route: null,
        'idempotency-key': null,
      }),
    });

    render(await page());

    expect(
      screen.getByText(
        'Too large to keep whole: 80,000 bytes. The start of it follows, with personal data masked.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'Response body (start)' }).textContent).toBe(
      '{"data":[',
    );
    expect(screen.getByRole('region', { name: 'Request' })).toHaveTextContent(INTEGRATION_IDS.user);
  });

  it('is not found for a malformed id', async () => {
    await expectNotFound(page('alog_nope'));

    expect(api.requests).toHaveLength(0);
  });

  it('shows the forbidden panel without api-logs:read', async () => {
    api.reply(200, meDocument({ permissions: ['events:read'] }));

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('API log');
  });
});
