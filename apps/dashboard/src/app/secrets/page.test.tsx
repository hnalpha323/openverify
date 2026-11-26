import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { rscPayloadOf } from '../../testing/rsc-payload';
import { serveWorkflowSecrets } from '../../testing/routes/workflows';
import { workflowSecret } from '../../testing/workflow-fixtures';
import SecretsPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const OTHER = 'wsec_01MB0000000000000000000002';
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const show = async (permissions: Permission[]) => {
  api.me({ permissions });
  render(<ToastProvider>{await SecretsPage()}</ToastProvider>);
};

const secrets = () => [
  workflowSecret(),
  workflowSecret(
    {
      key: 'signing_key',
      description: null,
      'allowed-hosts': ['api.example.com', 'api.example.org'],
      'environment-value': null,
    },
    OTHER,
  ),
];

const rowOf = (key: string) => {
  const row = screen.getByRole('rowheader', { name: key }).closest('tr');
  if (row === null) {
    throw new Error(`no row for ${key}`);
  }
  return within(row);
};

describe('the secrets page (C125, C141.7)', () => {
  it('is titled Secrets', () => {
    expect(metadata.title).toBe('Secrets');
  });

  it('lists each secret by key with its hosts and only the last four of its value', async () => {
    serveWorkflowSecrets(api, secrets());

    await show(['secrets:read']);

    expect(screen.getByRole('table', { name: 'Secrets' })).toBeVisible();
    const token = rowOf('slack_token');
    expect(token.getByText('hooks.example.com')).toBeVisible();
    expect(token.getByText('Synthetic token')).toBeVisible();
    expect(token.getByText('Ends in k9Zq (version 2)')).toBeVisible();
    const signing = rowOf('signing_key');
    expect(signing.getByText('api.example.com, api.example.org')).toBeVisible();
    expect(signing.getByText('No value in this environment')).toBeVisible();
    expect(signing.getByText('None')).toBeVisible();
  });

  it('offers no change without secrets:write', async () => {
    serveWorkflowSecrets(api, secrets());

    await show(['secrets:read']);

    expect(screen.queryByRole('form', { name: 'Create a secret' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Set the value|Rotate|Delete/ })).toBeNull();
  });

  it('offers creating a secret, setting or rotating its value and deleting it with secrets:write', async () => {
    serveWorkflowSecrets(api, secrets());

    await show(['secrets:read', 'secrets:write']);

    expect(screen.getByRole('form', { name: 'Create a secret' })).toBeVisible();
    expect(
      rowOf('slack_token').getByRole('button', { name: 'Rotate the value of slack_token' }),
    ).toBeVisible();
    expect(
      rowOf('signing_key').getByRole('button', { name: 'Set the value of signing_key' }),
    ).toBeVisible();
    expect(rowOf('signing_key').getByRole('button', { name: 'Delete signing_key' })).toBeVisible();
  });

  it('says so when the environment has no secret', async () => {
    serveWorkflowSecrets(api, []);

    await show(['secrets:read']);

    expect(screen.getByText('No secret yet.')).toBeVisible();
  });

  it('sends the browser the last four only, never more of a value', async () => {
    serveWorkflowSecrets(api, secrets());
    api.me({ permissions: ['secrets:read', 'secrets:write'] });

    const payload = await rscPayloadOf(await SecretsPage());

    expect(payload).toContain('k9Zq');
    expect(payload).not.toContain('secret-value');
  });

  it('shows where each value may go, and offers editing a key with secrets:write (C125.2)', async () => {
    serveWorkflowSecrets(api, secrets());

    await show(['secrets:read', 'secrets:write']);

    expect(rowOf('slack_token').getByRole('button', { name: 'Edit slack_token' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Secrets' })).toHaveTextContent(
      'Headers: authorization. Body: none.',
    );
  });
});
