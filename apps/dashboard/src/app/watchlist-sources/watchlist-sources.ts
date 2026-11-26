/**
 * C72.3: `GET /api/v1/dashboard/watchlist-sources` (`watchlists:read`), the install-wide sources
 * and this environment's template warnings as the console reads them. Holds no list value and no
 * screened subject.
 */
import 'server-only';
import {
  dashboardWatchlistSourcesSchema,
  type DashboardWatchlistSources,
} from '@openverify/contracts';
import { apiRequest } from '../../lib/api/client';

export const WATCHLIST_SOURCES_API_PATH = '/dashboard/watchlist-sources';

/** The sources page, parsed with its frozen contract schema. */
export function getWatchlistSources(): Promise<DashboardWatchlistSources> {
  return apiRequest({
    method: 'GET',
    path: WATCHLIST_SOURCES_API_PATH,
    schema: dashboardWatchlistSourcesSchema,
  });
}
