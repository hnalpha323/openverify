/**
 * `dashboard-signals`' mock routes (Workflow 7C, C108): the network sources page
 * (`GET /dashboard/network-sources`), registered on a `routeApi()` the test made. Paths are after
 * `/api/v1`; every value is synthetic.
 */
import type { DashboardNetworkSources } from '@openverify/contracts';
import type { RouteApi } from '../api-routes';

export const NETWORK_SOURCES_PATH = '/dashboard/network-sources';

/** `GET /dashboard/network-sources` answers `body`. */
export function serveNetworkSources(api: RouteApi, body: DashboardNetworkSources): RouteApi {
  return api.on('GET', NETWORK_SOURCES_PATH, 200, body);
}
