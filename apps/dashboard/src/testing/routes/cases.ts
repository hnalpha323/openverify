/**
 * `dashboard-cases`' mock routes for the case console (Workflow 8C, C142.1): cases, templates and
 * their versions, queues, assignment and SLA policies, calendars, bulk actions, exports and
 * notifications, registered on a `routeApi()` the test made (the Phase 6 pattern: it stands alone,
 * so no shared testing file changes). Paths are after `/api/v1`; every value is synthetic.
 */
import type {
  CaseAssignmentPolicyResource,
  CaseBulkActionResource,
  CaseCalendarResource,
  CaseExportResource,
  CaseQueueResource,
  CaseResource,
  CaseSlaPolicyResource,
  CaseTemplateResource,
  CaseTemplateVersionResource,
  UserNotificationResource,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { RouteApi } from '../api-routes';
import { casePageOf } from '../cases-fixtures';

export const CASES_PATH = '/cases';
export const CASE_TEMPLATES_PATH = '/case-templates';
export const CASE_TEMPLATE_VERSIONS_PATH = '/case-template-versions';
export const CASE_QUEUES_PATH = '/case-queues';
export const CASE_ASSIGNMENT_POLICIES_PATH = '/case-assignment-policies';
export const CASE_SLA_POLICIES_PATH = '/case-sla-policies';
export const CASE_CALENDARS_PATH = '/case-calendars';
export const CASE_EXPORTS_PATH = '/case-exports';
export const CASE_BULK_ACTIONS_PATH = '/case-bulk-actions';
export const NOTIFICATIONS_PATH = '/dashboard/notifications';

/** The built-in reviewer's case scopes (decision 68), with `pii:view`. */
export const CASE_REVIEWER: readonly Permission[] = [
  'cases:read',
  'cases:write',
  'cases:assign',
  'case-templates:read',
  'case-queues:read',
  'pii:view',
];
/** The built-in developer's case scopes: everything but `cases:export`, and no `pii:view`. */
export const CASE_DEVELOPER: readonly Permission[] = [
  'cases:read',
  'cases:write',
  'cases:assign',
  'cases:redact',
  'case-templates:read',
  'case-templates:write',
  'case-templates:publish',
  'case-queues:read',
  'case-queues:write',
];
/** An admin's case scopes, `cases:export` and `pii:view` among them. */
export const CASE_ADMIN: readonly Permission[] = [...CASE_DEVELOPER, 'cases:export', 'pii:view'];
/** A viewer: the three reads. */
export const CASE_VIEWER: readonly Permission[] = [
  'cases:read',
  'case-templates:read',
  'case-queues:read',
];

const one = <T>(data: T) => ({ data });

export function serveCases(
  api: RouteApi,
  cases: readonly CaseResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', CASES_PATH, 200, casePageOf(cases, next));
}

export function serveCaseTemplates(
  api: RouteApi,
  templates: readonly CaseTemplateResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', CASE_TEMPLATES_PATH, 200, casePageOf(templates, next));
}

export function serveCaseTemplate(api: RouteApi, template: CaseTemplateResource): RouteApi {
  return api.on('GET', `${CASE_TEMPLATES_PATH}/${template.id}`, 200, one(template));
}

export function serveCaseTemplateVersions(
  api: RouteApi,
  versions: readonly CaseTemplateVersionResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', CASE_TEMPLATE_VERSIONS_PATH, 200, casePageOf(versions, next));
}

export function serveCaseTemplateVersion(
  api: RouteApi,
  version: CaseTemplateVersionResource,
): RouteApi {
  return api.on('GET', `${CASE_TEMPLATE_VERSIONS_PATH}/${version.id}`, 200, one(version));
}

export function serveCaseQueues(
  api: RouteApi,
  queues: readonly CaseQueueResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', CASE_QUEUES_PATH, 200, casePageOf(queues, next));
}

export function serveCaseQueue(api: RouteApi, queue: CaseQueueResource): RouteApi {
  return api.on('GET', `${CASE_QUEUES_PATH}/${queue.id}`, 200, one(queue));
}

export function serveAssignmentPolicies(
  api: RouteApi,
  policies: readonly CaseAssignmentPolicyResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', CASE_ASSIGNMENT_POLICIES_PATH, 200, casePageOf(policies, next));
}

export function serveAssignmentPolicy(
  api: RouteApi,
  policy: CaseAssignmentPolicyResource,
): RouteApi {
  return api.on('GET', `${CASE_ASSIGNMENT_POLICIES_PATH}/${policy.id}`, 200, one(policy));
}

export function serveSlaPolicies(
  api: RouteApi,
  policies: readonly CaseSlaPolicyResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', CASE_SLA_POLICIES_PATH, 200, casePageOf(policies, next));
}

export function serveSlaPolicy(api: RouteApi, policy: CaseSlaPolicyResource): RouteApi {
  return api.on('GET', `${CASE_SLA_POLICIES_PATH}/${policy.id}`, 200, one(policy));
}

export function serveCalendars(
  api: RouteApi,
  calendars: readonly CaseCalendarResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', CASE_CALENDARS_PATH, 200, casePageOf(calendars, next));
}

export function serveCalendar(api: RouteApi, calendar: CaseCalendarResource): RouteApi {
  return api.on('GET', `${CASE_CALENDARS_PATH}/${calendar.id}`, 200, one(calendar));
}

export function serveBulkAction(api: RouteApi, action: CaseBulkActionResource): RouteApi {
  return api.on('GET', `${CASE_BULK_ACTIONS_PATH}/${action.id}`, 200, one(action));
}

export function serveCaseExports(
  api: RouteApi,
  exports: readonly CaseExportResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', CASE_EXPORTS_PATH, 200, casePageOf(exports, next));
}

export function serveNotifications(
  api: RouteApi,
  notifications: readonly UserNotificationResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', NOTIFICATIONS_PATH, 200, casePageOf(notifications, next));
}
