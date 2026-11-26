/**
 * C62.10: `GET /api/v1/dashboard/trust-anchors` (`settings:read`), the install-wide CSCA trust
 * store as the console reads it. Holds no personal data.
 */
import 'server-only';
import { dashboardTrustAnchorsSchema, type DashboardTrustAnchors } from '@openverify/contracts';
import { apiRequest } from '../../lib/api/client';

export const TRUST_ANCHORS_API_PATH = '/dashboard/trust-anchors';

/** The trust store, parsed with its frozen contract schema. */
export function getTrustAnchors(): Promise<DashboardTrustAnchors> {
  return apiRequest({
    method: 'GET',
    path: TRUST_ANCHORS_API_PATH,
    schema: dashboardTrustAnchorsSchema,
  });
}
