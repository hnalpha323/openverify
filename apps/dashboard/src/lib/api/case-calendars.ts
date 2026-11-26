/**
 * Business calendar reads of the case console (C133.2, C142.1), under `case-queues:read`. A calendar
 * holds configuration, never a subject's data. Failures are `@openverify/node` errors, which
 * `renderPage` maps.
 */
import 'server-only';
import { caseCalendarDocumentSchema, caseCalendarListDocumentSchema } from '@openverify/contracts';
import { apiRequest } from './client';

export const CASE_CALENDARS_PAGE_SIZE = 25;
/** The calendars a choice offers, from one page. */
export const CASE_CALENDAR_CHOICES = 100;

/** `GET /case-calendars`: one page, newest first. */
export function listCalendars(
  options: { readonly after?: string | undefined; readonly size?: number } = {},
) {
  return apiRequest({
    method: 'GET',
    path: '/case-calendars',
    query: {
      'page[after]': options.after,
      'page[size]': String(options.size ?? CASE_CALENDARS_PAGE_SIZE),
    },
    schema: caseCalendarListDocumentSchema,
  });
}

/** `GET /case-calendars/:id`. */
export function getCalendar(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/case-calendars/${encodeURIComponent(id)}`,
    schema: caseCalendarDocumentSchema,
  });
}
