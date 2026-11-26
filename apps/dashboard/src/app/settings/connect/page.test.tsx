import { PERMISSIONS, type Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECTION_IDS,
  connection,
  connectionList,
} from '../../../components/connect/connect-fixtures';
import { settings } from '../../../components/operators/test-fixtures';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import ConnectSettingsPage, { metadata } from './page';

vi.mock('./actions', () => ({
  saveConnectSettings: vi.fn(),
}));
vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
  vi.restoreAllMocks();
});

const ADMIN: readonly Permission[] = PERMISSIONS;
/** A read-only role: the two Connect reads and the settings read (C240.1). */
const VIEWER: readonly Permission[] = [
  'connect-connections:read',
  'connect-share-tokens:read',
  'settings:read',
];

const as = (permissions: readonly Permission[]) => api.me({ permissions });
const page = async (searchParams: Record<string, string> = {}) =>
  render(
    <ToastProvider>
      {await ConnectSettingsPage({ searchParams: Promise.resolve(searchParams) })}
    </ToastProvider>,
  );
const rowsOf = (name: string) =>
  within(screen.getByRole('table', { name })).getAllByRole('row').slice(1);

function serve(
  connections = [connection('inbound'), connection('outbound')],
  overrides: Parameters<typeof settings>[0] = {},
) {
  api.on('GET', '/connect/connections', 200, connectionList(connections));
  api.on(
    'GET',
    '/dashboard/settings',
    200,
    settings({
      'share-token-max-seconds': 1_814_400,
      'consent-proof-retention-days': 0,
      'connect-inbound': false,
      ...overrides,
    }),
  );
}

describe('Settings → Connect (C242.1)', () => {
  it('is titled Connect', () => {
    expect(metadata.title).toBe('Connect');
  });

  it('lists the connections in both directions with status, counterparty and policy version', async () => {
    as(ADMIN);
    serve();

    await page();

    expect(screen.getByRole('heading', { level: 1, name: 'Connect' })).toBeInTheDocument();
    const [inbound] = rowsOf('Inbound connections');
    expect(inbound).toHaveTextContent('Example Source');
    expect(inbound).toHaveTextContent('Active');
    expect(inbound).toHaveTextContent('Version 1');
    expect(screen.getByRole('link', { name: 'Example Source' })).toHaveAttribute(
      'href',
      `/settings/connect/connections/${CONNECTION_IDS.inbound}`,
    );
    const [outbound] = rowsOf('Outbound connections');
    expect(outbound).toHaveTextContent('Example Partner');
    expect(api.find('GET', '/connect/connections')?.query.get('page[size]')).toBe('100');
  });

  it('says that the destination’s name is shown once it activates, never guessing it (review P09)', async () => {
    as(ADMIN);
    serve([connection('outbound', { status: 'pending', destinationName: null })]);

    await page();

    const [outbound] = rowsOf('Outbound connections');
    expect(outbound).toHaveTextContent('Named once the destination activates');
    expect(outbound).toHaveTextContent('Pending');
    expect(outbound).toHaveTextContent('Version 1, not accepted yet');
    expect(rowsOf('Inbound connections')[0]).toHaveTextContent('No inbound connection yet.');
  });

  it('lists a self-connection with the outbound ones, named as this organization', async () => {
    as(ADMIN);
    serve([connection('self')]);

    await page();

    expect(rowsOf('Outbound connections')[0]).toHaveTextContent(
      'This organization (self-connection)',
    );
  });

  it('shows the Connect settings with the opt-in, the longest token life and the proof retention', async () => {
    as(ADMIN);
    serve(undefined, { 'connect-inbound': true, 'share-token-max-seconds': 600 });

    await page();

    expect(
      screen.getByRole('checkbox', { name: 'Receive connections from other organizations' }),
    ).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: /Longest share token life/ })).toHaveValue(600);
    expect(screen.getByRole('spinbutton', { name: /Consent proof kept/ })).toHaveValue(0);
  });

  it('shows the settings read only without settings:write, and leaves them out without settings:read', async () => {
    as(VIEWER);
    serve(undefined, { 'connect-inbound': true });

    const { unmount } = await page();

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('Receive connections from other organizations')).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    unmount();

    as(['connect-connections:read']);
    await page();

    expect(screen.queryByText('Receive connections from other organizations')).toBeNull();
    expect(api.all('GET', '/dashboard/settings')).toHaveLength(1);
    expect(rowsOf('Inbound connections')).toHaveLength(1);
  });

  it('links the share tokens for an operator who may read them', async () => {
    as(VIEWER);
    serve();

    await page();

    expect(screen.getByRole('link', { name: 'Share tokens' })).toHaveAttribute(
      'href',
      '/settings/connect/share-tokens',
    );
  });

  it('says Connect is off on this installation when every Connect route answers the one 404 (C231.10)', async () => {
    as(ADMIN);
    serve();
    api.onProblem('GET', '/connect/connections', 404);

    await page();

    expect(screen.getByRole('status')).toHaveTextContent('Connect is off on this installation');
    expect(screen.queryByRole('table', { name: 'Inbound connections' })).toBeNull();
    // The settings still save: the opt-in is the organisation's, the switch the installation's.
    expect(
      screen.getByRole('checkbox', { name: 'Receive connections from other organizations' }),
    ).toBeInTheDocument();
  });

  it('offers the next page of connections when the API has one', async () => {
    as(ADMIN);
    api.on(
      'GET',
      '/connect/connections',
      200,
      connectionList([connection('inbound')], CONNECTION_IDS.inbound),
    );
    serve([connection('inbound')]);
    api.on(
      'GET',
      '/connect/connections',
      200,
      connectionList([connection('inbound')], CONNECTION_IDS.inbound),
    );

    await page();

    expect(screen.getByRole('link', { name: 'Next connections' })).toHaveAttribute(
      'href',
      `/settings/connect?after=${CONNECTION_IDS.inbound}`,
    );
  });

  it('reads the page the cursor names', async () => {
    as(ADMIN);
    serve();

    await page({ after: CONNECTION_IDS.outbound });

    expect(api.find('GET', '/connect/connections')?.query.get('page[after]')).toBe(
      CONNECTION_IDS.outbound,
    );
  });

  it('renders the forbidden panel without connect-connections:read', async () => {
    as(['settings:read']);

    await page();

    expect(screen.getByText(/connect-connections:read/)).toBeInTheDocument();
    expect(api.all('GET', '/connect/connections')).toHaveLength(0);
  });
});
