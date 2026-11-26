import { PERMISSIONS, type Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECTION_IDS,
  SHARE_TOKEN_ID,
  shareToken,
  shareTokenList,
} from '../../../../components/connect/connect-fixtures';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import ShareTokensPage, { metadata } from './page';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const as = (permissions: readonly Permission[] = PERMISSIONS) => api.me({ permissions });
const page = async (searchParams: Record<string, string> = {}) =>
  render(await ShareTokensPage({ searchParams: Promise.resolve(searchParams) }));
const sent = () => api.find('GET', '/connect/share-tokens')?.query;

describe('the share tokens (C242.2)', () => {
  it('is titled Share tokens', () => {
    expect(metadata.title).toBe('Share tokens');
  });

  it('lists the inbound and outbound tokens, newest first as served', async () => {
    as();
    api.on(
      'GET',
      '/connect/share-tokens',
      200,
      shareTokenList([
        shareToken('outbound'),
        shareToken('inbound', {}, 'cnst_01M5CN0000000000000011A201'),
      ]),
    );

    await page();

    expect(screen.getByRole('heading', { level: 1, name: 'Share tokens' })).toBeInTheDocument();
    const rows = within(screen.getByRole('table', { name: 'Share tokens' })).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent(SHARE_TOKEN_ID);
    expect(sent()?.get('page[size]')).toBe('25');
    expect(sent()?.has('filter[direction]')).toBe(false);
  });

  it('sends the direction, status and connection filters, and keeps them in the form', async () => {
    as();
    api.on('GET', '/connect/share-tokens', 200, shareTokenList([]));

    await page({
      direction: 'inbound',
      status: 'created',
      'connection-id': CONNECTION_IDS.inbound,
    });

    expect(sent()?.get('filter[direction]')).toBe('inbound');
    expect(sent()?.get('filter[status]')).toBe('created');
    expect(sent()?.get('filter[connection-id]')).toBe(CONNECTION_IDS.inbound);
    expect(screen.getByRole('combobox', { name: 'Direction' })).toHaveValue('inbound');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('created');
    expect(screen.getByText('No share token matches these filters.')).toBeInTheDocument();
  });

  it('drops a filter value the API would refuse', async () => {
    as();
    api.on('GET', '/connect/share-tokens', 200, shareTokenList([]));

    await page({ direction: 'sideways', status: 'ready', 'connection-id': 'cxn_bad' });

    expect(sent()?.has('filter[direction]')).toBe(false);
    expect(sent()?.has('filter[status]')).toBe(false);
    expect(sent()?.has('filter[connection-id]')).toBe(false);
  });

  it('links the next page with the filters kept', async () => {
    as();
    api.on(
      'GET',
      '/connect/share-tokens',
      200,
      shareTokenList([shareToken('outbound')], SHARE_TOKEN_ID),
    );

    await page({ direction: 'outbound' });

    expect(screen.getByRole('link', { name: 'Next share tokens' })).toHaveAttribute(
      'href',
      `/settings/connect/share-tokens?direction=outbound&after=${SHARE_TOKEN_ID}`,
    );
  });

  it('says Connect is off when the list answers the one 404', async () => {
    as();
    api.onProblem('GET', '/connect/share-tokens', 404);

    await page();

    expect(screen.getByRole('status')).toHaveTextContent('Connect is off on this installation');
  });

  it('renders the forbidden panel without connect-share-tokens:read', async () => {
    as(['connect-connections:read']);

    await page();

    expect(screen.getByText('connect-share-tokens:read')).toBeInTheDocument();
    expect(api.all('GET', '/connect/share-tokens')).toHaveLength(0);
  });
});
