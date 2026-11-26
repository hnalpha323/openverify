/**
 * Inquiry reads of the inquiry pages (C4, C10, C23): the dashboard API's list and detail, which
 * mask PII for an operator without `pii:view` (C15), and the inquiry's timeline from the Events
 * API (`GET /events?filter[inquiry-id]=`, scope `events:read`, C25.7). Failures are
 * `@openverify/node` errors, which `renderPage` maps.
 */
import 'server-only';
import {
  dashboardInquiryDocumentSchema,
  eventListDocumentSchema,
  inquiryListDocumentSchema,
  type DashboardInquiryDocument,
  type InquiryListDocument,
} from '@openverify/contracts';
import { inquiryApiFilters, type InquiryFilters } from '../inquiry-query';
import { apiRequest } from './client';

/** Inquiries per list page. */
export const INQUIRY_PAGE_SIZE = 25;
/** Events per timeline page. */
export const TIMELINE_PAGE_SIZE = 50;

/**
 * `GET /inquiries` (the server API, as the session): one page, newest first, after the inquiry
 * `after`. The server route applies every C165.3 filter; the dashboard route accepts the new ones
 * but ignores them (Workflow 9C), and both answer the same masked list.
 */
export function listInquiries(
  filters: InquiryFilters,
  after?: string,
): Promise<InquiryListDocument> {
  return apiRequest({
    method: 'GET',
    path: '/inquiries',
    query: {
      ...inquiryApiFilters(filters),
      'page[after]': after,
      'page[size]': String(INQUIRY_PAGE_SIZE),
    },
    schema: inquiryListDocumentSchema,
  });
}

/**
 * `GET /dashboard/inquiries/:id`: the inquiry with its verifications, checks and files. The API
 * includes those only for an operator with `verifications:read`; otherwise it lists their ids
 * (Workflow 2D K001).
 */
export function getInquiry(id: string): Promise<DashboardInquiryDocument> {
  return apiRequest({
    method: 'GET',
    path: `/dashboard/inquiries/${encodeURIComponent(id)}`,
    schema: dashboardInquiryDocumentSchema,
  });
}

/**
 * `GET /events?filter[inquiry-id]=<inquiry>` (C25.7): the events of the inquiry, its
 * verifications and its sessions, newest first.
 */
export function listInquiryEvents(id: string, after?: string) {
  return apiRequest({
    method: 'GET',
    path: '/events',
    query: {
      'filter[inquiry-id]': id,
      'page[size]': String(TIMELINE_PAGE_SIZE),
      'page[after]': after,
    },
    schema: eventListDocumentSchema,
  });
}
