/**
 * `dashboard-documents`' own mock routes (Workflow 5C): the verification page of a document or
 * chip verification (`GET /verifications/:id` and its inquiry from the dashboard API) and the
 * chip trust store (`GET /dashboard/trust-anchors`), registered on a `routeApi()` the test made.
 * Paths are after `/api/v1`; every value is synthetic.
 */
import type {
  DashboardTrustAnchors,
  FileResource,
  VerificationResource,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { RouteApi } from '../api-routes';
import { LIFECYCLE_IDS, T1, inquiryDocument } from '../lifecycle-fixtures';

/** A reviewer: the checks, the inquiry it belongs to, and personal data. */
export const DOCUMENTS_REVIEWER: readonly Permission[] = [
  'verifications:read',
  'inquiries:read',
  'pii:view',
];
/** A viewer: the checks and the inquiry, no personal data. */
export const DOCUMENTS_VIEWER: readonly Permission[] = ['verifications:read', 'inquiries:read'];

export const TRUST_ANCHORS_PATH = '/dashboard/trust-anchors';

export interface ServeOptions {
  /** The verification the inquiry document carries; the answer itself by default. */
  readonly seen?: VerificationResource;
  /** Other resources of the inquiry: its files, a selfie verification. */
  readonly included?: readonly (VerificationResource | FileResource)[];
  readonly redacted?: boolean;
}

/**
 * `GET /verifications/:id` answers `verification`, and `GET /dashboard/inquiries/:id` its inquiry
 * (the lifecycle fixture's), carrying `seen` and `included` in place of its own verifications.
 */
export function serveDocumentsVerification(
  api: RouteApi,
  verification: VerificationResource,
  { seen = verification, included = [], redacted = false }: ServeOptions = {},
): RouteApi {
  api.on('GET', `/verifications/${verification.id}`, 200, { data: verification });
  const inquiry = inquiryDocument(redacted ? { 'redacted-at': T1 } : {});
  return api.on('GET', `/dashboard/inquiries/${LIFECYCLE_IDS.inquiry}`, 200, {
    ...inquiry,
    included: [seen, ...included],
  });
}

/** `GET /dashboard/trust-anchors` answers `body`. */
export function serveTrustAnchors(api: RouteApi, body: DashboardTrustAnchors): RouteApi {
  return api.on('GET', TRUST_ANCHORS_PATH, 200, body);
}
