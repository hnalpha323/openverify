import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { rscPayloadOf } from '../../testing/rsc-payload';
import { NETWORK_SOURCES_PATH, serveNetworkSources } from '../../testing/routes/network';
import { SOURCE_SHA256, networkSources } from '../../testing/signals-fixtures';
import NetworkSourcesError from './error';
import Loading from './loading';
import NetworkSourcesPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

describe('the network sources page route (C92, C108)', () => {
  it('reads the sources with settings:read and shows them read-only', async () => {
    api.me({ permissions: ['settings:read'] });
    serveNetworkSources(api, networkSources());

    render(await NetworkSourcesPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Network sources' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Network sources' })).toBeVisible();
    expect(api.find('GET', NETWORK_SOURCES_PATH)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('carries only what the one sources route returned in its RSC payload', async () => {
    api.me({ permissions: ['settings:read'] });
    serveNetworkSources(api, networkSources());

    const payload = await rscPayloadOf(await NetworkSourcesPage());

    expect(payload).toContain(SOURCE_SHA256);
    expect(payload).not.toMatch(/\b(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d+\b/);
    expect(api.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /dashboard/me',
      `GET ${NETWORK_SOURCES_PATH}`,
    ]);
  });

  it('is forbidden without settings:read, without reading the sources', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await NetworkSourcesPage());

    expect(screen.getByText('You do not have access')).toBeVisible();
    expect(api.find('GET', NETWORK_SOURCES_PATH)).toBeUndefined();
  });

  it('is titled for the browser tab, with its loading and error states', () => {
    expect(metadata.title).toBe('Network sources');
    render(<Loading />);
    expect(screen.getByText('Loading the network sources…')).toBeInTheDocument();
  });

  it('explains a failure plainly', () => {
    render(<NetworkSourcesError error={new Error('internal detail')} retry={vi.fn()} />);

    expect(screen.getByText('The network sources could not be loaded.')).toBeVisible();
    expect(screen.queryByText('internal detail')).toBeNull();
  });
});
