/**
 * Assignment and SLA policy reads of the case console (C132.2, C133.1, C142.1), under
 * `case-queues:read`. A policy holds configuration and operator ids, never a subject's data.
 * Failures are `@openverify/node` errors, which `renderPage` maps.
 */
import 'server-only';
import {
  caseAssignmentPolicyDocumentSchema,
  caseAssignmentPolicyListDocumentSchema,
  caseSlaPolicyDocumentSchema,
  caseSlaPolicyListDocumentSchema,
} from '@openverify/contracts';
import { apiRequest } from './client';

export const CASE_POLICIES_PAGE_SIZE = 25;
/** The policies a choice offers, from one page. */
export const CASE_POLICY_CHOICES = 100;

/** `GET /case-assignment-policies`: one page, newest first. */
export function listAssignmentPolicies(
  options: { readonly after?: string | undefined; readonly size?: number } = {},
) {
  return apiRequest({
    method: 'GET',
    path: '/case-assignment-policies',
    query: {
      'page[after]': options.after,
      'page[size]': String(options.size ?? CASE_POLICIES_PAGE_SIZE),
    },
    schema: caseAssignmentPolicyListDocumentSchema,
  });
}

/** `GET /case-assignment-policies/:id`. */
export function getAssignmentPolicy(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/case-assignment-policies/${encodeURIComponent(id)}`,
    schema: caseAssignmentPolicyDocumentSchema,
  });
}

/** `GET /case-sla-policies`: one page, newest first. */
export function listSlaPolicies(
  options: { readonly after?: string | undefined; readonly size?: number } = {},
) {
  return apiRequest({
    method: 'GET',
    path: '/case-sla-policies',
    query: {
      'page[after]': options.after,
      'page[size]': String(options.size ?? CASE_POLICIES_PAGE_SIZE),
    },
    schema: caseSlaPolicyListDocumentSchema,
  });
}

/** `GET /case-sla-policies/:id`. */
export function getSlaPolicy(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/case-sla-policies/${encodeURIComponent(id)}`,
    schema: caseSlaPolicyDocumentSchema,
  });
}
