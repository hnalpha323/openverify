/**
 * C92, C108: `GET /api/v1/dashboard/network-sources` (`settings:read`), the install's network
 * sources as the console reads them. Network data is public: no session, address or subject.
 */
import 'server-only';
import { dashboardNetworkSourcesSchema, type DashboardNetworkSources } from '@openverify/contracts';
import { apiRequest } from '../../lib/api/client';

export const NETWORK_SOURCES_API_PATH = '/dashboard/network-sources';

/** The sources page, parsed with its frozen contract schema. */
export function getNetworkSources(): Promise<DashboardNetworkSources> {
  return apiRequest({
    method: 'GET',
    path: NETWORK_SOURCES_API_PATH,
    schema: dashboardNetworkSourcesSchema,
  });
}
