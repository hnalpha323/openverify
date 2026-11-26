import { z } from 'zod';

/** JSON:API `type` of every resource: Phase 1 (contract C1), then Phase 2 (C9). */
export const RESOURCE_TYPES = [
  'inquiry',
  'inquiry-template',
  'inquiry-session',
  'verification/government-id',
  'verification/selfie',
  'file',
  'event',
  'webhook',
  'api-key',
  'user',
  'account',
  'account-type',
  'role',
  'user-audit-log',
  'api-log',
  'inquiry-template-version',
  'webhook-delivery',
  'mfa-factor',
  'rate-limit',
  // Phase 4 (C40.1).
  'selfie',
  // Phase 5 (C50.1, C50.6): the nine new verification types.
  'verification/document',
  'verification/database',
  'verification/aamva',
  'verification/phone-number',
  'verification/email-address',
  'verification/government-id-nfc',
  'verification/crypto-wallet',
  'verification/database-business',
  'verification/business-website',
  // Phase 6 (C70): the nine report types, report templates and versions, history runs and actions.
  'report/watchlist',
  'report/business-watchlist',
  'report/crypto-address-watchlist',
  'report/politically-exposed-person',
  'report/adverse-media',
  'report/business-adverse-media',
  'report/email-address',
  'report/phone-number',
  'report/address-lookup',
  'report-template',
  'report-template-version',
  'report-run',
  'report-action',
  // Phase 7 (C91.2, C91.3, C106.1): devices, networks and the ip-address report.
  'device',
  'network',
  'report/ip-address',
  // Phase 7, Workflow 7B (C97, C99, C100, C106.2): lists, items, importers, matches and the
  // custom-list report.
  'list/browser-fingerprint',
  'list/device-fingerprint',
  'list/country',
  'list/email-address',
  'list/face',
  'list/geolocation',
  'list/government-id-number',
  'list/field',
  'list/ip-address',
  'list/name',
  'list/phone-number',
  'list/selfie-background',
  'list/string',
  'list-item/browser-fingerprint',
  'list-item/device-fingerprint',
  'list-item/country',
  'list-item/email-address',
  'list-item/face',
  'list-item/geolocation',
  'list-item/government-id-number',
  'list-item/field',
  'list-item/ip-address',
  'list-item/name',
  'list-item/phone-number',
  'list-item/selfie-background',
  'list-item/string',
  'importer/list-item/browser-fingerprint',
  'importer/list-item/device-fingerprint',
  'importer/list-item/country',
  'importer/list-item/email-address',
  'importer/list-item/geolocation',
  'importer/list-item/government-id-number',
  'importer/list-item/field',
  'importer/list-item/ip-address',
  'importer/list-item/name',
  'importer/list-item/phone-number',
  'importer/list-item/string',
  'list-match',
  'report/custom-list',
  // Workflow 7B (C104, C105): transactions.
  'transaction',
  'transaction-type',
  'transaction-type-version',
  'transaction-label',
  // Owner decision 8 after 7B: one row of a transaction's status history.
  'transaction-status-change',
  // K7C-2: one relation of a transaction.
  'transaction-relation',
  // Workflow 7B (C102): the graph.
  'graph-query',
  'graph-query-template',
  'graph-query-template-version',
  // K7B-2 (C101.6): an account's component, served beside the account.
  'account-graph-component',
  // Phase 8 (C121.1): a run is named as an actor and a creator from Workflow 8A's common commits;
  // the rest join in (E), below.
  'workflow-run',
  // Workflow 8A (C112, C117, C118.7, C122.4, C140.5).
  'workflow',
  'workflow-version',
  'workflow-version-diff',
  'workflow-deployment',
  'workflow-run-step',
  'workflow-run-file',
  'workflow-trigger-delivery',
  'scheduled-run',
  'account-action',
  'workflow-action',
  'workflow-recipe',
  // Workflow 8A (C128.1): an automated decision's record.
  'decision',
  // Workflow 8A (C125): a secret's metadata; a value is no resource.
  'workflow-secret',
  // Workflow 8B (C120.1, C140.1): a case action, named as a run's creator from the common commits.
  'case-action',
  // Workflow 8B (C129): cases, their templates and comments, what the timeline and a case's held
  // objects read, a bulk action, and a console notification.
  'case',
  'case-template',
  'case-template-version',
  'case-comment',
  'case-history-entry',
  'case-held-object',
  'case-bulk-action',
  'case-queue',
  'user-notification',
  // Workflow 8B (C132, C133): assignment and SLA policies, and business calendars.
  'case-assignment-policy',
  'case-sla-policy',
  'case-calendar',
  // Workflow 8B (C138): an export, read by its creator alone.
  'case-export',
  // Workflow 9A (C154, C156, C162.7): a deployment, the translations of a template, a simulation
  // preset, and the answers of validate, diff, preview, simulate and used-by.
  'deployment',
  'inquiry-template-translations',
  'simulation-preset',
  'inquiry-template-version-validation',
  'inquiry-template-version-diff',
  'inquiry-template-preview',
  'inquiry-template-simulation',
  'inquiry-template-usage',
  // Workflow 9A (C160): a theme set, one of its revisions, and an asset.
  'theme-set',
  'theme-set-revision',
  'theme-asset',
  // Workflow 11A (C230-C236): a connection and a share token (the public types), and ours, a
  // consent record. A peek's `connect/source-data/<subtype>` is a member of a share token, never a
  // resource of its own.
  'connect/connection',
  'connect/share-token',
  'consent-record',
] as const;

export const resourceTypeSchema = z.enum(RESOURCE_TYPES);
export type ResourceType = z.infer<typeof resourceTypeSchema>;
