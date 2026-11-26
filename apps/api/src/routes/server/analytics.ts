/**
 * C164.8 (Workflow 9B): the read-only aggregates API under `/api/v1/analytics` (`analytics:read`),
 * always one environment (sandbox and production never mix, A13), each read counted first by the
 * `analytics` policy (60 a minute per principal, C174.4). Frozen by `foundation-9b` (Stage 1b (A));
 * built by `api-analytics` (`services/analytics/service.ts`): suppression applied after every
 * filter, freshness and the reporting zone named, the per-reviewer distribution of the cases answer
 * only for holders of `users:write` (review P20). A filter a report's rollups cannot apply is 400.
 */
import {
  analyticsCasesDocumentSchema,
  analyticsCasesQuerySchema,
  analyticsChecksDocumentSchema,
  analyticsChecksQuerySchema,
  analyticsFunnelDocumentSchema,
  analyticsFunnelQuerySchema,
  analyticsInquiriesDocumentSchema,
  analyticsInquiriesQuerySchema,
  analyticsSignalsDocumentSchema,
  analyticsSignalsQuerySchema,
  analyticsVerificationsDocumentSchema,
  analyticsVerificationsQuerySchema,
} from '@openverify/contracts';
import type { AnalyticsReport } from '@openverify/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { enforceRoutePolicy, principalSubject } from '../../plugins/rate-limit.js';
import { readAnalyticsAnswer, type AnalyticsQuery } from '../../services/analytics/service.js';
import type { ApiDependencies } from '../../services/context.js';

const TAGS = ['analytics'];

interface AnalyticsRead {
  report: AnalyticsReport;
  path: string;
  summary: string;
  description: string;
  querystring: z.ZodType;
  document: z.ZodType;
}

/** C164.1-C164.6: one read per answer, in the order of `ANALYTICS_REPORTS`. */
const READS: readonly AnalyticsRead[] = [
  {
    report: 'inquiries',
    path: '/analytics/inquiries',
    summary: 'Read inquiry analytics',
    description:
      'C164.1: created, started, finished, outcomes, expirations, time to finish and how inquiries ' +
      'were decided, by cohort day in the reporting zone; `filter[tag]` by a tag’s name.',
    querystring: analyticsInquiriesQuerySchema,
    document: analyticsInquiriesDocumentSchema,
  },
  {
    report: 'funnel',
    path: '/analytics/funnel',
    summary: 'Read the flow funnel',
    description:
      'C164.2: per template version and step, the inquiries that entered, exited and revisited, the ' +
      'transitions and the top 20 paths, from the server’s step record.',
    querystring: analyticsFunnelQuerySchema,
    document: analyticsFunnelDocumentSchema,
  },
  {
    report: 'verifications',
    path: '/analytics/verifications',
    summary: 'Read verification analytics',
    description:
      'C164.3: attempts by type, capture method and country, with the per-attempt and the ' +
      'per-person pass rates, each with its denominator.',
    querystring: analyticsVerificationsQuerySchema,
    document: analyticsVerificationsDocumentSchema,
  },
  {
    report: 'checks',
    path: '/analytics/checks',
    summary: 'Read check analytics',
    description:
      'C164.4: per check, runs by status (errored, not configured and pending each their own), ' +
      'reasons, requirement, tier and stage; a check that never ran says so.',
    querystring: analyticsChecksQuerySchema,
    document: analyticsChecksDocumentSchema,
  },
  {
    report: 'cases',
    path: '/analytics/cases',
    summary: 'Read case analytics',
    description:
      'C164.5: cases on their own creation day: created, resolved, resolution time and SLA; the ' +
      'per-reviewer distribution only for holders of `users:write`.',
    querystring: analyticsCasesQuerySchema,
    document: analyticsCasesDocumentSchema,
  },
  {
    report: 'signals',
    path: '/analytics/signals',
    summary: 'Read signal analytics',
    description:
      'C164.6: per signal, its values in the registry’s fixed bins, `not-evaluated` for a null, ' +
      'with tier and stage.',
    querystring: analyticsSignalsQuerySchema,
    document: analyticsSignalsDocumentSchema,
  },
];

export const analyticsRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, deps) => {
  for (const read of READS) {
    app.get(
      read.path,
      {
        config: { scopes: ['analytics:read'] },
        schema: {
          summary: read.summary,
          description: `${read.description} Counted by the \`analytics\` policy.`,
          tags: TAGS,
          querystring: read.querystring,
          response: { 200: read.document, ...problemResponses(400, 401, 403, 429) },
        },
      },
      async (request) => {
        const principal = requirePrincipal(request);
        await enforceRoutePolicy(
          deps.rateLimiter,
          'analytics',
          principalSubject(principal),
          'Too many analytics reads; retry later.',
        );
        return readAnalyticsAnswer(deps, read.report, request.query as AnalyticsQuery, {
          environmentId: principal.environmentId,
          mayReadAssignees: principal.permissions.has('users:write'),
        });
      },
    );
  }
  return Promise.resolve();
};
