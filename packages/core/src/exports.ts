/**
 * C165, C166 (Phase 9, Workflow 9B Stage 1a, (X)): the vocabularies of exports, saved views and bulk
 * report jobs, shared by the contracts and the tables' CHECKs (`foundation-9b` (X)).
 */
import type { Permission } from './permissions.js';

/** C166.1: what an export covers, one CSV per export (decision 43). */
export const EXPORT_OBJECT_TYPES = Object.freeze([
  'inquiries',
  'verifications',
  'accounts',
  'reports',
  'lists',
  'transactions',
] as const);
export type ExportObjectType = (typeof EXPORT_OBJECT_TYPES)[number];

/** C166.1: CSV only; the public bundle of one file per verification type is one export each. */
export const EXPORT_FORMATS = Object.freeze(['csv'] as const);
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** C166.1: an asynchronous job; a file kept past its 24 hours reads `expired`. */
export const EXPORT_STATUSES = Object.freeze([
  'pending',
  'running',
  'completed',
  'failed',
  'expired',
] as const);
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/**
 * C166.1 (ours, provisional): at most 50,000 rows, refused past it and never truncated
 * (`export_too_large`), lowered if the analytics benchmark passes 2 minutes at the cap; the file is
 * kept 24 hours.
 */
export const EXPORT_LIMITS = Object.freeze({ rows: 50_000, 'retention-hours': 24 } as const);

/** C166.2: the permission of each object type, admin's alone by default (C167.1). */
export const EXPORT_PERMISSIONS: Readonly<Record<ExportObjectType, Permission>> = Object.freeze({
  inquiries: 'inquiries:export',
  verifications: 'verifications:export',
  accounts: 'accounts:export',
  reports: 'reports:export',
  lists: 'lists:export',
  transactions: 'transactions:export',
});

/** C165.1: the lists a saved view can name. */
export const SAVED_VIEW_LISTS = Object.freeze([
  'inquiries',
  'accounts',
  'reports',
  'cases',
  'transactions',
  'api-logs',
  'webhook-deliveries',
  'events',
  'audit-logs',
] as const);
export type SavedViewList = (typeof SAVED_VIEW_LISTS)[number];

/** C166.5: a bulk report job (`rbulk_`, ours); the public `batch-jobs` resource is deferred. */
export const REPORT_BULK_JOB_STATUSES = Object.freeze([
  'pending',
  'running',
  'completed',
  'failed',
] as const);
export type ReportBulkJobStatus = (typeof REPORT_BULK_JOB_STATUSES)[number];

/** C166.6: every row is created or failed with a code, never skipped. */
export const REPORT_BULK_ROW_OUTCOMES = Object.freeze(['created', 'failed'] as const);
export type ReportBulkRowOutcome = (typeof REPORT_BULK_ROW_OUTCOMES)[number];

/**
 * C165.3 (K10; the default taken at the 7B refresh): `matched` is an open list match;
 * `not-matched` a completed screening with no open match (only a completed screening may claim no
 * match, ADR 0005); `unscreened` a pending, partial or errored screening with no open match. An
 * inquiry with no screening row matches none of the three.
 */
export const INQUIRY_LIST_MATCH_FILTERS = Object.freeze([
  'matched',
  'not-matched',
  'unscreened',
] as const);
export type InquiryListMatchFilter = (typeof INQUIRY_LIST_MATCH_FILTERS)[number];
