/**
 * C165.2, C166.1 (Workflow 9B, `api-exports`): the problems of exports and saved views
 * (`EXPORT_PROBLEM_STATUSES`: `saved_view_pii_filter`, `export_too_large`), with their code and
 * status, and the permission each list a saved view or an export names needs to be read.
 */
import { EXPORT_PROBLEM_STATUSES, type ExportProblemCode } from '@openverify/contracts';
import type { Permission, SavedViewList } from '@openverify/core';
import { AppError, type ProblemFieldError } from '../../errors.js';

/** A problem of `EXPORT_PROBLEM_STATUSES`, with its code; `errors` never echo a value. */
export function exportProblem(
  code: ExportProblemCode,
  detail: string,
  errors?: readonly ProblemFieldError[],
): AppError {
  return new AppError({
    status: EXPORT_PROBLEM_STATUSES[code],
    title: 'Unprocessable Content',
    detail,
    code,
    ...(errors === undefined ? {} : { errors }),
  });
}

/** C165.1: the permission that reads each list a saved view can name (its route's scope). */
export const SAVED_VIEW_LIST_PERMISSIONS: Readonly<Record<SavedViewList, Permission>> =
  Object.freeze({
    inquiries: 'inquiries:read',
    accounts: 'accounts:read',
    reports: 'reports:read',
    cases: 'cases:read',
    transactions: 'transactions:read',
    'api-logs': 'api-logs:read',
    'webhook-deliveries': 'webhooks:read',
    events: 'events:read',
    'audit-logs': 'audit-logs:read',
  });
