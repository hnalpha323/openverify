/**
 * The Analytics section's reads (C164.8, C164.9): `GET /api/v1/analytics/<report>` with the
 * operator's session, under `analytics:read` and the `analytics` policy (60 a minute per
 * principal). Every answer is suppressed by the API; the console draws its tables, charts and
 * captions from that answer only (C164.7) and never computes a figure the API did not serve.
 * Failures are `@openverify/node` errors, which `renderPage` maps.
 */
import 'server-only';
import {
  analyticsCasesDocumentSchema,
  analyticsChecksDocumentSchema,
  analyticsFunnelDocumentSchema,
  analyticsInquiriesDocumentSchema,
  analyticsSignalsDocumentSchema,
  analyticsVerificationsDocumentSchema,
} from '@openverify/contracts';
import type { AnalyticsReport } from '@openverify/core';
import type { z } from 'zod';
import { apiRequest } from './client';

/** The contract schema of each answer. */
export const ANALYTICS_DOCUMENT_SCHEMAS = Object.freeze({
  inquiries: analyticsInquiriesDocumentSchema,
  funnel: analyticsFunnelDocumentSchema,
  verifications: analyticsVerificationsDocumentSchema,
  checks: analyticsChecksDocumentSchema,
  cases: analyticsCasesDocumentSchema,
  signals: analyticsSignalsDocumentSchema,
});

export type AnalyticsDocuments = {
  readonly [Report in AnalyticsReport]: z.output<(typeof ANALYTICS_DOCUMENT_SCHEMAS)[Report]>;
};

/** One answer, `query` as the route takes it (`filter[from]`, `bucket`, ...). */
export function readAnalytics<Report extends AnalyticsReport>(
  report: Report,
  query: Readonly<Record<string, string>>,
): Promise<AnalyticsDocuments[Report]> {
  return apiRequest({
    method: 'GET',
    path: `/analytics/${report}`,
    query,
    schema: ANALYTICS_DOCUMENT_SCHEMAS[report],
  }) as Promise<AnalyticsDocuments[Report]>;
}
