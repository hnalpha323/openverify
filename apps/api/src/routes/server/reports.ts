/**
 * C72.1 (Phase 6): the report routes under `/api/v1`: create, list, fetch, redact, tags, dismiss,
 * review, pause, resume, run and history. The schemas and scopes are frozen (Workflow 6A Stage 1b,
 * `foundation-6`); `api-reports` owns this file and built the handlers (its `services/reports/`).
 * Every report attribute marked PII is masked without `pii:view`
 * (C70.3), and every route that changes a redacted report answers 410 `report_redacted` (H23).
 */
import {
  addTagBodySchema,
  createReportBodySchema,
  dismissReportBodySchema,
  idSchema,
  listReportsQuerySchema,
  pauseReportBodySchema,
  removeTagBodySchema,
  reportDocumentSchema,
  reportHistoryDocumentSchema,
  reportHistoryQuerySchema,
  reportListDocumentSchema,
  resumeReportBodySchema,
  reviewReportBodySchema,
  runReportBodySchema,
  setTagsBodySchema,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePiiView } from '../../auth/pii.js';
import { ReportProblemError } from '../../errors.js';
import { mediaQueryProblem } from '../../jobs/report-types/media-screening.js';
import { problemResponses } from '../../plugins/openapi.js';
import { authorizePrincipal, requirePrincipal } from '../../plugins/principal-auth.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  awaitInitialRun,
  changeReportMonitoring,
  changeReportTags,
  createReportResource,
  getReportResource,
  listReportResources,
  reportHistory,
  redactReportResource,
  reportResourceOf,
  REPORTS_PATH,
} from '../../services/reports/reports.js';
import { dismissReportMatches, reviewReportMatches } from '../../services/reports/review.js';
import { REPORT_SYNC_LIMITS, type CreateReportBody } from '@openverify/contracts';
import { actingOf } from './inquiries.js';

const TAGS = ['reports'];
const params = z.object({ id: idSchema('rep') });

const QUERY_POINTER = ['data', 'attributes', 'query'];

/**
 * C81.2 (V10), C81.3 (H13): a media query the schema takes but the search cannot screen: a name
 * with no letter or digit left for the GDELT phrase, or a business name that is one generic word
 * once its legal form is stripped. Answered 422 `report_query_invalid` at the name's pointer, so
 * no report answers "no match" for a search it could not make; a completion report's run errors
 * `insufficient_input` for the same query.
 */
function assertScreenableMedia(body: CreateReportBody): void {
  const { type, attributes } = body.data;
  if (type !== 'report/adverse-media' && type !== 'report/business-adverse-media') {
    return;
  }
  const query = attributes.query as Readonly<Record<string, unknown>>;
  const problem = mediaQueryProblem(type === 'report/adverse-media' ? 'person' : 'business', query);
  if (problem === 'empty' || problem === 'generic') {
    const member = query.term === undefined ? 'name-first' : 'term';
    throw new ReportProblemError(
      'report_query_invalid',
      'The name cannot be screened for adverse media.',
      {
        errors: [
          {
            location: 'body',
            pointer: `/data/attributes/query/${member}`,
            detail:
              problem === 'generic'
                ? 'is one generic word once its legal form is stripped'
                : 'keeps no letter or digit to search for',
          },
        ],
      },
    );
  }
}

/**
 * C72.1: the create body. A body whose only problems lie under `/data/attributes/query` answers
 * 422 `report_query_invalid` with a pointer to each; any other problem keeps the 400.
 */
function createBodyOf(request: FastifyRequest): CreateReportBody {
  const parsed = createReportBodySchema.safeParse(request.body);
  if (parsed.success) {
    assertScreenableMedia(parsed.data);
    return parsed.data;
  }
  const issues = parsed.error.issues;
  const inQuery = (path: readonly PropertyKey[]) =>
    QUERY_POINTER.every((part, index) => path[index] === part);
  if (issues.length > 0 && issues.every((issue) => inQuery(issue.path))) {
    throw new ReportProblemError(
      'report_query_invalid',
      'The query does not fit the report type.',
      {
        errors: issues.map((issue) => ({
          location: 'body',
          pointer: `/${issue.path.map((part) => String(part)).join('/')}`,
          detail: issue.message,
        })),
      },
    );
  }
  throw request.validationError ?? parsed.error;
}

/** C72.2 (P05, V14): linking needs the linked resource's scope, checked before any lookup. */
function linkingScopes(body: CreateReportBody): Permission[] {
  const scopes: Permission[] = [];
  if (body.data.attributes['inquiry-id'] !== undefined) {
    scopes.push('inquiries:write');
  }
  if (
    body.data.attributes['account-id'] !== undefined ||
    body.meta?.['auto-create-account-reference-id'] !== undefined
  ) {
    scopes.push('accounts:read');
  }
  return scopes;
}

/** C72.1 report routes, under `/api/v1`. */
export const reportRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/reports',
    {
      config: { scopes: ['reports:write'] },
      schema: {
        summary: 'Create a report',
        description:
          'C72.1: validates the `query` against the type (422 `report_query_invalid` with ' +
          'pointers), pins the published version of `report-template-id` (422 ' +
          '`report_template_not_published`, `report_type_mismatch`, `watchlist_sources_empty`), ' +
          'links the account (`account-id`, needs `accounts:read`; else ' +
          '`meta.auto-create-account-reference-id`, which needs `accounts:read` whenever present; ' +
          'else a new account unless `meta.auto-create-account` is false) and the inquiry ' +
          '(`inquiry-id`, ours, needs `inquiries:write`), and creates the report `pending` with ' +
          'its first run. A redacted inquiry or account answers 410 `redacted`; a recurring ' +
          'report beyond the environment cap 422 `report_recurring_limit`; creations beyond the ' +
          'environment rate 429. `meta.processing-mode: sync` waits up to 10 s for the first ' +
          'run (at most 20 waiting requests per environment); `async`, the default, answers at ' +
          'once. The deprecated `reference-id` is refused.',
        tags: TAGS,
        body: createReportBodySchema,
        response: {
          201: reportDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422, 429),
        },
      },
      // The handler tells a query problem (422) from any other (400).
      attachValidation: true,
    },
    async (request, reply) => {
      const body = createBodyOf(request);
      const principal = requirePrincipal(request);
      authorizePrincipal(principal, linkingScopes(body));
      const acting = actingOf(request);
      let report = await createReportResource(
        deps,
        acting,
        body,
        principal.kind === 'user' ? 'dashboard' : 'api',
      );
      if (body.meta?.['processing-mode'] === 'sync') {
        report = await awaitInitialRun(deps.db, report, {
          waitMs: REPORT_SYNC_LIMITS.waitSeconds * 1000,
          pollMs: 250,
          maxWaiting: REPORT_SYNC_LIMITS.maxWaitingPerEnvironment,
        });
      }
      return reply
        .code(201)
        .header('location', `${REPORTS_PATH}/${report.id}`)
        .send({ data: await reportResourceOf(deps.db, report, acting.mask) });
    },
  );

  app.get(
    '/reports',
    {
      config: { scopes: ['reports:read'] },
      schema: {
        summary: 'List reports, newest first',
        description:
          'C72.1: filters on the template, status, `has-match` (`false` lists only `ready` ' +
          'reports: an errored report was not screened, C69.4), account, inquiry, the ' +
          "account's reference id, tag and type; cursor pagination.",
        tags: TAGS,
        querystring: listReportsQuerySchema,
        response: { 200: reportListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => {
      const acting = actingOf(request);
      return listReportResources(deps, acting.ctx.environmentId, request.query, acting.mask);
    },
  );

  app.get(
    '/reports/:id',
    {
      config: { scopes: ['reports:read'] },
      schema: {
        summary: 'Fetch a report',
        description:
          'Its status, errors, coverage, provenance and the type-specific results; `has-match` ' +
          'reads as "no match" only beside `ready` (C69.4).',
        tags: TAGS,
        params,
        response: { 200: reportDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => {
      const acting = actingOf(request);
      return {
        data: await getReportResource(
          deps,
          acting.ctx.environmentId,
          request.params.id,
          acting.mask,
        ),
      };
    },
  );

  app.delete(
    '/reports/:id',
    {
      config: { scopes: ['reports:redact'] },
      schema: {
        summary: 'Redact a report',
        description:
          'C73.5: nulls the query, the results, every match snapshot and index and every ' +
          "action's details, cancels monitoring, stubs the report's earlier events and fires " +
          '`report/<type>.redacted` once. Scores, statuses and counts stay. The answer is the ' +
          'redacted report.',
        tags: TAGS,
        params,
        response: { 200: reportDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await redactReportResource(deps, actingOf(request), request.params.id),
    }),
  );

  const tagRoute = (
    action: 'add-tag' | 'remove-tag' | 'set-tags',
    summary: string,
    body: typeof addTagBodySchema | typeof setTagsBodySchema,
  ) =>
    app.post(
      `/reports/:id/${action}`,
      {
        config: { scopes: ['reports:write'] },
        schema: {
          summary,
          description: 'Tags emit no report event (parity).',
          tags: TAGS,
          params,
          body,
          response: {
            200: reportDocumentSchema,
            ...problemResponses(400, 401, 403, 404, 410, 422),
          },
        },
      },
      async (request) => {
        const meta = (request.body as { meta: Record<string, unknown> }).meta;
        const operation =
          action === 'set-tags'
            ? { kind: 'set' as const, tags: meta['tag-names'] as string[] }
            : {
                kind: action === 'add-tag' ? ('add' as const) : ('remove' as const),
                tag: meta['tag-name'] as string,
              };
        return {
          data: await changeReportTags(deps, actingOf(request), request.params.id, operation),
        };
      },
    );
  tagRoute('add-tag', 'Add a tag to a report', addTagBodySchema);
  tagRoute('remove-tag', 'Remove a tag from a report', removeTagBodySchema);
  tagRoute('set-tags', "Replace a report's tags", setTagsBodySchema);

  app.post(
    '/reports/:id/dismiss',
    {
      config: { scopes: ['reports:review'] },
      schema: {
        summary: "Dismiss a report's matches",
        description:
          'C75.2: dismisses every open match, or those of `entity-id` (one article with ' +
          '`dismiss-type: media`), with a required reason; they leave `has-match`, join the ' +
          '`ignore-list` and stay suppressed while their evidence is unchanged. 409 ' +
          '`report_not_reviewable` for a pending report or an errored one without a match; 404 ' +
          '`report_match_not_found`; 410 `report_redacted`. 403 without `pii:view` (a user ' +
          'without it, or an API key minted masked): the matches are personal data, and nobody ' +
          'decides on evidence hidden from them. Fires `.dismissed`.',
        tags: TAGS,
        params,
        body: dismissReportBodySchema,
        response: {
          200: reportDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422),
        },
      },
    },
    async (request) => {
      requirePiiView(requirePrincipal(request));
      return {
        data: await dismissReportMatches(
          deps,
          actingOf(request),
          request.params.id,
          request.body.data.attributes,
        ),
      };
    },
  );

  app.post(
    '/reports/:id/review',
    {
      config: { scopes: ['reports:review'] },
      schema: {
        summary: "Review a report's matches",
        description:
          'C75.5: `all_records` reviews every open match; `record` the match `record-token` ' +
          'names. `false_positive` needs a comment and dismisses. 409 `report_not_reviewable`, ' +
          '`report_match_superseded` (a dismissed match whose entry has a newer row); 404 ' +
          '`report_match_not_found`; 410 `report_redacted`. 403 without `pii:view`, as for a ' +
          'dismissal. Fires `.reviewed`, and `.dismissed` for a false positive.',
        tags: TAGS,
        params,
        body: reviewReportBodySchema,
        response: {
          200: reportDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422),
        },
      },
    },
    async (request) => {
      requirePiiView(requirePrincipal(request));
      return {
        data: await reviewReportMatches(
          deps,
          actingOf(request),
          request.params.id,
          request.body.data.attributes,
        ),
      };
    },
  );

  const monitoringRoute = (
    action: 'pause' | 'resume' | 'run',
    summary: string,
    description: string,
    body: typeof pauseReportBodySchema,
  ) =>
    app.post(
      `/reports/:id/${action}`,
      {
        config: { scopes: ['reports:write'] },
        schema: {
          summary,
          description,
          tags: TAGS,
          params,
          body,
          response: {
            200: reportDocumentSchema,
            ...problemResponses(400, 401, 403, 404, 409, 410, 429),
          },
        },
      },
      async (request) => ({
        data: await changeReportMonitoring(deps, actingOf(request), request.params.id, action),
      }),
    );
  monitoringRoute(
    'pause',
    "Pause a report's monitoring",
    'C74.5: needs an upcoming run (409 `report_no_scheduled_run`); 409 `report_not_recurrable` ' +
      'for a type that does not recur.',
    pauseReportBodySchema,
  );
  monitoringRoute(
    'resume',
    "Resume a report's monitoring",
    'C74.5: needs a paused report (409 `report_no_scheduled_run`). When a selected source ' +
      'applied a change during the pause, a run is due at once; otherwise the next interval ' +
      'boundary.',
    resumeReportBodySchema,
  );
  monitoringRoute(
    'run',
    'Run a report now',
    'C74.5: a `manual` run, allowed while paused; recurrable types only (409 ' +
      '`report_not_recurrable`). Counts toward the environment rate (429).',
    runReportBodySchema,
  );

  app.get(
    '/reports/:id/history',
    {
      config: { scopes: ['reports:read'] },
      schema: {
        summary: "A report's runs and actions, newest first",
        description:
          'C74.2: runs with their type, status, match counts and notes, and actions with their ' +
          'actor; `reason` and `comment` are masked without `pii:view`.',
        tags: TAGS,
        params,
        querystring: reportHistoryQuerySchema,
        response: { 200: reportHistoryDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => {
      const acting = actingOf(request);
      return reportHistory(
        deps,
        acting.ctx.environmentId,
        request.params.id,
        request.query,
        acting.mask,
      );
    },
  );

  done();
};
