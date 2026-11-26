/**
 * C66: the mock API routes the records evidence tests (database, AAMVA, business registry,
 * business website) serve a verification page with, through `routeApi()` (`testing/api-routes.ts`):
 * `GET /verifications/:id` answers the verification, and `GET /dashboard/inquiries/:id` the
 * inquiry it belongs to, carrying `seen` (by default the same verification). A test may serve the
 * verification masked and the inquiry unmasked: whatever the inquiry carries, the page must show
 * only what the verification answer says (C53.7). Every value is synthetic.
 */
import type { Permission } from '@openverify/core';
import type { Phase5Verification } from '../../components/evidence';
import type { RouteApi } from '../api-routes';
import { T1, inquiryDocument } from '../lifecycle-fixtures';

/** A reviewer: the checks, the inquiry and personal data. */
export const RECORDS_REVIEWER: readonly Permission[] = [
  'verifications:read',
  'inquiries:read',
  'pii:view',
];

/** A viewer: the checks and the inquiry, without personal data. */
export const RECORDS_VIEWER: readonly Permission[] = ['verifications:read', 'inquiries:read'];

export interface RecordsRouteOptions {
  /** What the inquiry document carries for the verification; the answer itself by default. */
  readonly seen?: Phase5Verification;
  /** The inquiry was redacted (C16). */
  readonly redacted?: boolean;
  readonly permissions?: readonly Permission[];
}

/** Serves `verification`'s page and its inquiry to an operator holding `permissions`. */
export function serveRecordsVerification(
  api: RouteApi,
  verification: Phase5Verification,
  options: RecordsRouteOptions = {},
): void {
  api.me({ permissions: options.permissions ?? RECORDS_REVIEWER });
  api.on('GET', `/verifications/${verification.id}`, 200, { data: verification });
  const inquiry = inquiryDocument(options.redacted === true ? { 'redacted-at': T1 } : {});
  api.on('GET', `/dashboard/inquiries/${verification.relationships.inquiry.data.id}`, 200, {
    ...inquiry,
    included: [...inquiry.included, options.seen ?? verification],
  });
}
