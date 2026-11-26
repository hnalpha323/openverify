import {
  DEFAULT_PAGE_SIZE,
  dashboardInquiryDocumentSchema,
  dashboardInquiryListDocumentSchema,
  dashboardListInquiriesQuerySchema,
  filterValues,
  idSchema,
  type ListInquiriesQuery,
} from '@openverify/contracts';
import { inquiryStatusSchema } from '@openverify/core';
import {
  InvalidCursorError,
  getInquiry,
  listInquiries,
  listGovernmentIdExtractions,
  listInquiryVerifications,
  getListScreening,
  listInquiryListScreenings,
  listSelfieCaptures,
  listVerificationFiles,
} from '@openverify/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { piiMaskFor } from '../../auth/pii.js';
import { AppError } from '../../errors.js';
import { problemResponses } from '../../plugins/openapi.js';
import { loadVerificationAttributesOf } from '../../services/attributes/index.js';
import { inquiryListFilters } from '../../services/list-filters/inquiries.js';
import { resolveTransactionRelationships } from '../../services/transactions/relationships.js';
import { selfieCaptureResources, selfieDetailsOf } from '../../services/selfie-captures.js';
import { operatorPrincipal, requireOperator } from './authenticate.js';
import type { DashboardContext } from './context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';
import {
  toFileResource,
  toInquiryResource,
  toVerificationResource,
  verificationRefsByInquiry,
} from './resources.js';

/**
 * The inquiry list query. The contract's inferred type leaves out the `created-at` range that
 * its schema validates, so it is added here.
 */
export type DashboardInquiryQuery = ListInquiriesQuery & {
  'filter[created-at-start]'?: string | undefined;
  'filter[created-at-end]'?: string | undefined;
};

const FILTERS = [
  'filter[status]',
  'filter[reference-id]',
  'filter[account-id]',
  'filter[inquiry-template-id]',
  'filter[tag]',
  'filter[created-at-start]',
  'filter[created-at-end]',
] as const;

/**
 * `links.next` (C1): this list's path with the same filters and page size, continuing after
 * the last item, or `null` on the last page.
 */
export function nextPageLink(
  path: string,
  query: DashboardInquiryQuery,
  size: number,
  next: string | null,
  added: Readonly<Record<string, string | undefined>> = {},
): string | null {
  if (next === null) {
    return null;
  }
  const params = new URLSearchParams();
  for (const filter of FILTERS) {
    const value = query[filter];
    if (value !== undefined) {
      params.set(filter, value);
    }
  }
  for (const [filter, value] of Object.entries(added)) {
    if (value !== undefined) {
      params.set(filter, value);
    }
  }
  params.set('page[size]', String(size));
  params.set('page[after]', next);
  return `${path}?${params.toString()}`;
}

const anyString = z.string();
const toDate = (value: string | undefined) => (value === undefined ? undefined : new Date(value));

/**
 * `GET /inquiries` and `GET /inquiries/:id`, scoped to the session's environment (C4). They
 * need `inquiries:read`; `fields` values and the note are masked without `pii:view` (C15).
 */
export const inquiryRoutes: FastifyPluginAsyncZod<DashboardContext> = (app, { db }) => {
  app.get(
    '/inquiries',
    {
      config: { scopes: ['inquiries:read'] },
      schema: {
        summary: 'List inquiries',
        description:
          "The session environment's inquiries, newest first, with the server API filters (C165.3's " +
          'list-match, list-id, check with check-status and next-step-name included; ' +
          'next-step-name needs `pii:view`, else 403) and cursor pagination. Without `pii:view`, ' +
          'field values and notes are null.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        querystring: dashboardListInquiriesQuerySchema,
        response: {
          200: dashboardInquiryListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    async (request) => {
      const operator = requireOperator(request);
      const { environmentId } = operator;
      const query: DashboardInquiryQuery = request.query;
      const size = query['page[size]'] ?? DEFAULT_PAGE_SIZE;
      const mask = piiMaskFor(operatorPrincipal(operator));
      // C165.3 (Workflow 9C, DA1): the server route's filters, with the operator's PII visibility,
      // so a filter the query schema accepts is never answered with the unfiltered list.
      const added = await inquiryListFilters(db, {
        environmentId,
        query,
        piiVisible: mask.visible,
      });
      const page = await listInquiries(db, environmentId, {
        where: added.where,
        after: query['page[after]'],
        size,
        status: filterValues(query['filter[status]'], inquiryStatusSchema),
        referenceId: query['filter[reference-id]'],
        accountId: filterValues(query['filter[account-id]'], anyString),
        inquiryTemplateId: filterValues(query['filter[inquiry-template-id]'], anyString),
        tag: filterValues(query['filter[tag]'], anyString),
        createdAtStart: toDate(query['filter[created-at-start]']),
        createdAtEnd: toDate(query['filter[created-at-end]']),
      }).catch((error: unknown) => {
        if (error instanceof InvalidCursorError) {
          throw new AppError({
            status: 400,
            detail: 'page[after] does not name an inquiry in this list.',
          });
        }
        throw error;
      });
      const refs = await verificationRefsByInquiry(
        db,
        environmentId,
        page.items.map((inquiry) => inquiry.id),
      );
      // C90.5, V06 (Workflow 7B): the rows `inquiry/list_match_count` is merged from.
      const screenings = await listInquiryListScreenings(
        db,
        environmentId,
        page.items.map((inquiry) => inquiry.id),
      );
      const transactions = await resolveTransactionRelationships(
        db,
        environmentId,
        page.items.map((inquiry) => inquiry.id),
      );
      return {
        data: page.items.map((inquiry) =>
          toInquiryResource(
            inquiry,
            refs.get(inquiry.id) ?? [],
            mask,
            undefined,
            screenings.get(inquiry.id) ?? null,
            transactions.get(inquiry.id),
          ),
        ),
        links: {
          next: nextPageLink(request.routeOptions.url ?? '', query, size, page.next, added.links),
        },
      };
    },
  );

  app.get(
    '/inquiries/:id',
    {
      config: { scopes: ['inquiries:read'] },
      schema: {
        summary: 'Get an inquiry',
        description:
          'The inquiry with its verifications, their checks, file metadata and its selfie ' +
          'captures (C40.1, C47), newest first. Without `pii:view`, field values and the note ' +
          'are null. Without `verifications:read`, `included` is empty and only the ' +
          'verification and capture relationships are listed (Workflow 2D K001).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: z.strictObject({ id: idSchema('inq') }),
        response: {
          200: dashboardInquiryDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) => {
      const operator = requireOperator(request);
      const { environmentId } = operator;
      const inquiry = await getInquiry(db, environmentId, request.params.id);
      if (inquiry === null) {
        throw new AppError({ status: 404, detail: 'No inquiry with this id exists.' });
      }
      const verifications = await listInquiryVerifications(db, environmentId, inquiry.id);
      const mask = piiMaskFor(operatorPrincipal(operator));
      const relationships = verifications.map(({ id, type }) => ({ id, type }));
      const captures = await listSelfieCaptures(db, environmentId, { inquiryId: inquiry.id });
      const captureIds = captures.map((capture) => capture.id);
      const screening = await getListScreening(db, environmentId, inquiry.id);
      // C105.7 (Workflow 7B): the inquiry's, and each included verification's.
      const transactions = await resolveTransactionRelationships(db, environmentId, [
        inquiry.id,
        ...verifications.map((verification) => verification.id),
      ]);
      if (!operator.permissions.has('verifications:read')) {
        // The verifications, their files and captures are the `GET /verifications/:id` and
        // `GET /selfies/:id` views (C23, C40.1).
        return {
          data: toInquiryResource(
            inquiry,
            relationships,
            mask,
            captureIds,
            screening,
            transactions.get(inquiry.id),
          ),
          included: [],
        };
      }
      const files = await listVerificationFiles(
        db,
        environmentId,
        verifications.map((verification) => verification.id),
      );
      const grouped = verifications.map((verification) => ({
        verification,
        files: files.filter((file) => file.verificationId === verification.id),
      }));
      const extractions = await listGovernmentIdExtractions(
        db,
        environmentId,
        verifications.map((verification) => verification.id),
      );
      const attributes = await loadVerificationAttributesOf(db, verifications);
      return {
        data: toInquiryResource(
          inquiry,
          relationships,
          mask,
          captureIds,
          screening,
          transactions.get(inquiry.id),
        ),
        included: [
          ...grouped.map(({ verification, files: own }) =>
            toVerificationResource(
              verification,
              own.map((file) => file.id),
              extractions.get(verification.id) ?? null,
              mask,
              verification.type === 'selfie'
                ? selfieDetailsOf(captures, verification.id)
                : undefined,
              attributes.get(verification.id),
              transactions.get(verification.id),
            ),
          ),
          ...grouped.flatMap(({ verification, files: own }) =>
            own.map((file) => toFileResource(file, verification)),
          ),
          // C40.1, C47: the inquiry's selfie captures, newest first.
          ...(await selfieCaptureResources(db, captures)),
        ],
      };
    },
  );
  return Promise.resolve();
};
