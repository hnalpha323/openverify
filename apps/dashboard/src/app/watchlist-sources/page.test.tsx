import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLayout } from '../../components/console-layout';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import {
  KEYS_VERSION,
  MEDIA_ATTRIBUTION,
  syntheticSha256,
  watchlistSources,
} from '../../testing/report-config-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import {
  CONFIG_VIEWER,
  WATCHLIST_SOURCES_PATH,
  serveWatchlistSources,
} from '../../testing/routes/report-config';
import WatchlistSourcesError from './error';
import WatchlistSourcesLayout from './layout';
import Loading from './loading';
import WatchlistSourcesPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

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

describe('the watchlist sources page (C72.3, C76, C86)', () => {
  it('reads the sources with watchlists:read and shows them read-only', async () => {
    api.me({ permissions: CONFIG_VIEWER });
    serveWatchlistSources(api, watchlistSources());

    render(await WatchlistSourcesPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Watchlist sources' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Watchlist sources' })).toBeVisible();
    expect(api.find('GET', WATCHLIST_SOURCES_PATH)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    // The template ids link their pages for a principal that reads templates.
    expect(
      within(
        screen.getByRole('table', {
          name: 'Templates whose pinned lists differ from the enabled sources',
        }),
      ).getByRole('link'),
    ).toBeVisible();
  });

  it('carries only what the API returned in its RSC payload, from the one sources route', async () => {
    api.me({ permissions: ['watchlists:read'] });
    serveWatchlistSources(api, watchlistSources());

    const payload = await rscPayloadOf(await WatchlistSourcesPage());

    expect(payload).toContain(syntheticSha256('ofac-sdn'));
    expect(payload).toContain('Synthetic attribution line of ofac-sdn');
    // Owner decisions 17 and 18: the API's own members, as it served them, and nothing else.
    expect(payload).toContain('Synthetic sanctions screening');
    expect(payload).toContain(MEDIA_ATTRIBUTION);
    expect(payload).toContain(KEYS_VERSION);
    expect(payload).toContain('12.5 scheduled adverse-media runs a day in this environment');
    expect(payload).not.toContain('When adverse media is bound to gdelt-doc');
    expect(payload).not.toContain('across the install');
    expect(api.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /dashboard/me',
      `GET ${WATCHLIST_SOURCES_PATH}`,
    ]);
  });

  it('reads the sandbox lists for the session’s environment: not screened in production', async () => {
    api.me({
      permissions: CONFIG_VIEWER,
      environment: ENVIRONMENTS.production,
    });
    serveWatchlistSources(api, watchlistSources());

    render(await WatchlistSourcesPage());

    expect(screen.getByRole('table', { name: 'Watchlist sources' })).toHaveTextContent(
      'Sandbox list, not screened here',
    );
  });

  it('names a template without linking it for a principal without report-templates:read', async () => {
    api.me({ permissions: ['watchlists:read'] });
    serveWatchlistSources(api, watchlistSources());

    render(await WatchlistSourcesPage());

    expect(
      within(
        screen.getByRole('table', {
          name: 'Templates whose pinned lists differ from the enabled sources',
        }),
      ).queryByRole('link'),
    ).toBeNull();
  });

  it('shows the forbidden panel without watchlists:read, without reading the sources', async () => {
    api.me({ permissions: ['report-templates:read', 'reports:read'] });

    render(await WatchlistSourcesPage());

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(screen.getByTestId('forbidden-panel')).toHaveTextContent('watchlists:read');
    expect(api.find('GET', WATCHLIST_SOURCES_PATH)).toBeUndefined();
  });

  it('shows the forbidden panel when the API refuses the sources', async () => {
    api.me({ permissions: ['watchlists:read'] });
    api.onProblem('GET', WATCHLIST_SOURCES_PATH, 403, 'forbidden');

    render(await WatchlistSourcesPage());

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
  });

  it('sends the operator to sign in when the session has ended', async () => {
    api.me({ permissions: ['watchlists:read'] });
    api.onProblem('GET', WATCHLIST_SOURCES_PATH, 401);

    await expect(redirectTarget(WatchlistSourcesPage())).resolves.toBe('/login');
  });

  it('is titled for the browser tab and sits in the console layout', () => {
    expect(metadata.title).toBe('Watchlist sources');
    expect(WatchlistSourcesLayout).toBe(ConsoleLayout);
  });
});

describe('the watchlist sources loading and error states', () => {
  it('announces that the sources are loading', () => {
    render(<Loading />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading the watchlist sources…');
  });

  it('explains a failure without internals and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<WatchlistSourcesError error={new Error('socket hang up')} retry={retry} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The watchlist sources could not be loaded.');
    expect(within(alert).queryByText(/socket/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
