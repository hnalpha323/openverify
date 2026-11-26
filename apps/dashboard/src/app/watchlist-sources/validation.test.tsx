/**
 * C254.2 (Workflow 11B, ingestion-11b; decision 39): the sources page shows, for each source, the
 * last validation and how it was made (the publisher's 304, or a download whose SHA-256 was
 * compared) and the last full verification, so an operator sees when a conditional source was last
 * proved by the platform itself, not only by its publisher's "not modified". A source that does not
 * opt in downloads at every check. The page carries only what the API returned, from the one
 * sources route. Every value is synthetic.
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatUtc } from '../../components/timestamp';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { SOURCE_STATES, watchlistSources } from '../../testing/report-config-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import { CONFIG_VIEWER, serveWatchlistSources } from '../../testing/routes/report-config';
import WatchlistSourcesPage from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const VALIDATED_AT = '2026-11-13T11:30:00.000Z';
const FULL_CHECK_AT = '2026-11-12T23:10:00.000Z';
const DOWNLOADED_AT = '2026-11-13T10:05:00.000Z';

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

/** Three sources: one the publisher validated, one compared by digest, one that opts out. */
function sources() {
  return watchlistSources({
    sources: [
      {
        ...SOURCE_STATES.fresh,
        id: 'uk-sanctions-list',
        conditional: true,
        'last-validated-at': VALIDATED_AT,
        'validated-by': 'http-304',
        'last-full-check-at': FULL_CHECK_AT,
      },
      {
        ...SOURCE_STATES.fresh,
        id: 'eu-fsf',
        conditional: false,
        'last-validated-at': DOWNLOADED_AT,
        'validated-by': 'sha256',
        'last-full-check-at': DOWNLOADED_AT,
      },
      { ...SOURCE_STATES.fresh, id: 'ofac-sdn' },
    ],
  });
}

const rowOf = (id: string) => {
  const table = screen.getByRole('table', { name: 'Watchlist sources' });
  const row = within(table)
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryByText(id) !== null);
  if (row === undefined) throw new Error(`no row for ${id}`);
  return within(row);
};

describe('the sources page’s validations (C254.2)', () => {
  it('shows the last validation, how it was made, and the last full verification', async () => {
    api.me({ permissions: CONFIG_VIEWER });
    serveWatchlistSources(api, sources());

    render(await WatchlistSourcesPage());

    const table = screen.getByRole('table', { name: 'Watchlist sources' });
    expect(
      within(table).getByRole('columnheader', { name: 'Last validation (UTC)' }),
    ).toBeVisible();
    expect(
      within(table).getByRole('columnheader', { name: 'Last full verification (UTC)' }),
    ).toBeVisible();

    const uk = rowOf('uk-sanctions-list');
    expect(uk.getByText(formatUtc(VALIDATED_AT))).toBeVisible();
    expect(uk.getByText('Not modified, the publisher’s 304')).toBeVisible();
    expect(uk.getByText(formatUtc(FULL_CHECK_AT))).toBeVisible();

    const eu = rowOf('eu-fsf');
    expect(eu.getByText('Downloaded, SHA-256 compared')).toBeVisible();
    expect(eu.getAllByText(formatUtc(DOWNLOADED_AT))).toHaveLength(2);

    const ofac = rowOf('ofac-sdn');
    expect(ofac.getByText('Every check downloads')).toBeVisible();
    expect(ofac.getAllByText('Never')).not.toHaveLength(0);
  });

  it('carries the validation members in its RSC payload, from the one sources route', async () => {
    api.me({ permissions: ['watchlists:read'] });
    serveWatchlistSources(api, sources());

    const payload = await rscPayloadOf(await WatchlistSourcesPage());

    expect(payload).toContain(VALIDATED_AT);
    expect(payload).toContain(FULL_CHECK_AT);
    expect(payload).toContain('Not modified, the publisher’s 304');
    expect(payload).toContain('Downloaded, SHA-256 compared');
    expect(api.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /dashboard/me',
      'GET /dashboard/watchlist-sources',
    ]);
  });
});
