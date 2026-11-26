import {
  API_SCOPES as CORE_API_SCOPES,
  CHECK_REGISTRY,
  INQUIRY_EVENT_BY_STATUS,
  INQUIRY_STATUSES,
  VERIFICATION_STATUSES,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { IMPORTER_LIST_KINDS, LIST_KINDS } from '@openverify/core';
import { ENVIRONMENT_KINDS, environmentKindSchema } from './environments.js';
import {
  ACCOUNT_EVENT_NAMES,
  CASE_COMMENT_EVENT_NAMES,
  CASE_EVENT_NAMES,
  CASE_TEMPLATE_EVENT_NAMES,
  REPORT_EVENT_NAMES,
  SELFIE_EVENT_NAMES,
  EVENT_NAMES,
  INQUIRY_EVENT_NAMES,
  GRAPH_QUERY_EVENT_NAMES,
  LIST_EVENT_NAMES,
  WORKFLOW_EVENT_NAMES,
  WORKFLOW_RUN_EVENT_NAMES,
  WORKFLOW_VERSION_EVENT_NAMES,
  LIST_MATCH_EVENT_NAMES,
  TRANSACTION_EVENT_NAMES,
  TRANSACTION_TYPE_EVENT_NAMES,
  INQUIRY_SESSION_EVENT_NAMES,
  VERIFICATION_EVENT_BY_STATUS,
  VERIFICATION_EVENT_NAMES,
  eventNameSchema,
  eventSubject,
  inquiryEventForStatus,
  isEventName,
  verificationEventForStatus,
  type EventName,
} from './event-names.js';
import {
  IMAGE_UNREADABLE_REASON,
  NOT_IMPLEMENTED_REASON,
  PHASE1_CHECK_REASONS,
  PHASE1_CHECKS,
} from './phase1-checks.js';
import { RESOURCE_TYPES, resourceTypeSchema } from './resource-types.js';
import { API_SCOPES, apiScopeSchema } from './scopes.js';

describe('RESOURCE_TYPES (C1, C9)', () => {
  it('lists every Phase 1 resource type, then the Phase 2 ones', () => {
    expect(RESOURCE_TYPES).toEqual([
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
      'selfie',
      // Phase 5 (C50.1).
      'verification/document',
      'verification/database',
      'verification/aamva',
      'verification/phone-number',
      'verification/email-address',
      'verification/government-id-nfc',
      'verification/crypto-wallet',
      'verification/database-business',
      'verification/business-website',
      // Phase 6 (C70): the nine report types, report templates and versions, runs and actions.
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
      // Phase 7 (C91.2, C91.3, C106.1).
      'device',
      'network',
      'report/ip-address',
      // Phase 7, Workflow 7B (C97, C99, C100, C106.2): lists, items, importers, matches and the
      // custom-list report.
      ...LIST_KINDS.map((kind) => `list/${kind}`),
      ...LIST_KINDS.map((kind) => `list-item/${kind}`),
      ...IMPORTER_LIST_KINDS.map((kind) => `importer/list-item/${kind}`),
      'list-match',
      'report/custom-list',
      // Workflow 7B (C104, C105): transactions.
      'transaction',
      'transaction-type',
      'transaction-type-version',
      'transaction-label',
      // Owner decision 8 after 7B.
      'transaction-status-change',
      // K7C-2.
      'transaction-relation',
      // Workflow 7B (C102): the graph.
      'graph-query',
      'graph-query-template',
      'graph-query-template-version',
      // K7B-2 (C101.6).
      'account-graph-component',
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
      'decision',
      'workflow-secret',
      'case-action',
      // Workflow 8B (C129).
      'case',
      'case-template',
      'case-template-version',
      'case-comment',
      'case-history-entry',
      'case-held-object',
      'case-bulk-action',
      'case-queue',
      'user-notification',
      // Workflow 8B (C132, C133).
      'case-assignment-policy',
      'case-sla-policy',
      'case-calendar',
      // Workflow 8B (C138).
      'case-export',
      // Workflow 9A (C154, C156, C162.7).
      'deployment',
      'inquiry-template-translations',
      'simulation-preset',
      'inquiry-template-version-validation',
      'inquiry-template-version-diff',
      'inquiry-template-preview',
      'inquiry-template-simulation',
      'inquiry-template-usage',
      // Workflow 9A (C160).
      'theme-set',
      'theme-set-revision',
      'theme-asset',
      // Workflow 11A (C230-C236).
      'connect/connection',
      'connect/share-token',
      'consent-record',
    ]);
    expect(resourceTypeSchema.safeParse('report/screening').success).toBe(false);
    expect(resourceTypeSchema.safeParse('verification/selfie').success).toBe(true);
    expect(resourceTypeSchema.safeParse('account-type').success).toBe(true);
    expect(resourceTypeSchema.safeParse('verification/document').success).toBe(true);
    expect(resourceTypeSchema.safeParse('verification/business').success).toBe(false);
  });
});

describe('API_SCOPES (C2, C12)', () => {
  it('lists the scopes the server API enforces, Phase 1 first', () => {
    expect(API_SCOPES).toEqual([
      'inquiries:read',
      'inquiries:write',
      'inquiry-templates:read',
      'inquiry-templates:write',
      'verifications:read',
      'webhooks:read',
      'webhooks:write',
      'events:read',
      'accounts:read',
      'accounts:write',
      'accounts:redact',
      'inquiries:redact',
      'inquiry-sessions:read',
      'inquiry-sessions:write',
      'inquiry-templates:publish',
      'api-keys:read',
      'api-keys:write',
      'api-logs:read',
      'audit-logs:read',
      // C55.11 (Phase 5): the sandbox SMS sink.
      'sandbox:read',
      // C72.2 (Phase 6): reports, report templates and the watchlist sources.
      'reports:read',
      'reports:write',
      'reports:review',
      'reports:redact',
      'report-templates:read',
      'report-templates:write',
      'report-templates:publish',
      'watchlists:read',
      'lists:read',
      'lists:write',
      'importers:read',
      'importers:write',
      'graph:read',
      'graph:write',
      'transactions:read',
      'transactions:write',
      'transactions:redact',
      'transaction-types:write',
      'workflows:read',
      'workflows:write',
      'workflows:publish',
      'workflows:trigger',
      'workflow-runs:read',
      'workflow-runs:write',
      'workflow-runs:redact',
      'secrets:read',
      'secrets:write',
      'devices:write',
      'cases:read',
      'cases:write',
      'cases:assign',
      'cases:redact',
      'cases:export',
      'case-templates:read',
      'case-templates:write',
      'case-templates:publish',
      'case-queues:read',
      'case-queues:write',
      'theme-sets:read',
      'theme-sets:write',
      'deployments:read',
      // C167.1 (Workflow 9B): analytics, and an export permission per object type.
      'analytics:read',
      'inquiries:export',
      'verifications:export',
      'accounts:export',
      'reports:export',
      'lists:export',
      'transactions:export',
      // C240.1 (Workflow 11A): Connect.
      'connect-connections:read',
      'connect-connections:write',
      'connect-share-tokens:read',
      'connect-share-tokens:write',
      'connect-share-tokens:redeem',
      'connect-share-tokens:peek',
      'connect-consent-records:attest',
      // C253.1 (Workflow 11B Stage 1a): the access export, admin's alone.
      'account-access:export',
    ]);
    expect(apiScopeSchema.safeParse('inquiry.write').success).toBe(false);
  });

  it('is the core list, so permissions and scopes cannot drift apart', () => {
    expect(API_SCOPES).toBe(CORE_API_SCOPES);
  });
});

describe('ENVIRONMENT_KINDS (C12, C19)', () => {
  it('are sandbox and production', () => {
    expect(ENVIRONMENT_KINDS).toEqual(['sandbox', 'production']);
    expect(environmentKindSchema.safeParse('staging').success).toBe(false);
  });
});

describe('EVENT_NAMES (C5, C17)', () => {
  it('lists the Phase 1 events first, then every C17 event', () => {
    expect(EVENT_NAMES).toEqual([
      'inquiry.created',
      'inquiry.started',
      'inquiry.completed',
      'inquiry.failed',
      'verification.created',
      'verification.submitted',
      'verification.passed',
      'verification.failed',
      'inquiry.approved',
      'inquiry.declined',
      'inquiry.marked-for-review',
      'inquiry.expired',
      'inquiry.transitioned',
      'inquiry.updated-tags',
      'inquiry.redacted',
      // C128.6 (Workflow 8A): ours, so a reopen never reads as a fresh review.
      'inquiry.reopened',
      'inquiry-session.started',
      'inquiry-session.expired',
      'inquiry-session.canceled',
      'verification.canceled',
      'verification.skipped',
      'account.created',
      'account.updated-fields',
      'account.updated-tags',
      'account.tag-added',
      'account.tag-removed',
      'account.added-relation',
      'account.removed-relation',
      'account.consolidated',
      'account.consolidated-with',
      'account.archived',
      'account.restored',
      'account.status-updated',
      'account.redacted',
      'selfie.created',
      'selfie.submitted',
      'selfie.processed',
      'selfie.errored',
      // Phase 6 (C70.4): every report event, in REPORT_TYPES order.
      ...REPORT_EVENT_NAMES,
      // C99.3 (Workflow 7B): ours, the one list event.
      'list-match.created',
      // C105.3, C104.6 (Workflow 7B).
      'transaction.created',
      'transaction.status-updated',
      'transaction.updated-fields',
      'transaction.labeled',
      'transaction.redacted',
      'transaction.added-relation',
      'transaction.removed-relation',
      'transaction-type.deleted-field',
      'transaction-type.converted-field',
      // C102.5 (Workflow 7B).
      'graph-query.submitted',
      'graph-query.completed',
      'graph-query.errored',
      'graph-query.cancelled',
      'graph-query.timed-out',
      'graph-query.reran',
      // C112.7, C127.12 (Workflow 8A).
      'workflow.published',
      'workflow.paused',
      'workflow-version.published',
      'workflow-run.created',
      'workflow-run.resumed',
      'workflow-run.errored',
      'workflow-run.completed',
      'workflow-run.canceled',
      'list.updated',
      'case.created',
      'case.assigned',
      'case.resolved',
      'case.reopened',
      'case.status-updated',
      'case.queue-updated',
      'case.updated-fields',
      'case.updated-tags',
      'case.sla-expired',
      'case.exported',
      'case.redacted',
      'case.updated',
      'case.print-initiated',
      'case-comment.created',
      'case-template.deleted-field',
      // C154.8 (Workflow 9A).
      'inquiry-template-version.created',
      'inquiry-template-version.published',
      'deployment.completed',
      // C239.1 (Workflow 11A): connections, share tokens, consent records.
      'connect/connection.created',
      'connect/connection.activated',
      'connect/connection.deactivated',
      'connect/connection.reactivated',
      'connect/connection.share-policy-changed',
      'connect/share-token.outbound-created',
      'connect/share-token.inbound-created',
      'connect/share-token.outbound-redeemed',
      'connect/share-token.inbound-redeemed',
      'connect/share-token.expired',
      'connect/share-token.failed',
      'connect/share-token.consent-withdrawn',
      'connect/share-token.source-redacted',
      'consent-record.created',
      'consent-record.declined',
      'consent-record.withdrawn',
    ]);
    expect(REPORT_EVENT_NAMES).toHaveLength(54);
    expect(REPORT_EVENT_NAMES.slice(0, 6)).toEqual([
      'report/watchlist.ready',
      'report/watchlist.errored',
      'report/watchlist.matched',
      'report/watchlist.dismissed',
      'report/watchlist.reviewed',
      'report/watchlist.redacted',
    ]);
    expect(REPORT_EVENT_NAMES.slice(-9)).toEqual([
      // C106.1 (Phase 7): the three events the none review model derives.
      'report/ip-address.ready',
      'report/ip-address.errored',
      'report/ip-address.redacted',
      // C106.2 (Workflow 7B): a type reviewed match by match has the six derived events.
      'report/custom-list.ready',
      'report/custom-list.errored',
      'report/custom-list.matched',
      'report/custom-list.dismissed',
      'report/custom-list.reviewed',
      'report/custom-list.redacted',
    ]);
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
    expect(eventNameSchema.safeParse('inquiry.needs_review').success).toBe(false);
  });

  it('groups the names by subject', () => {
    expect(
      [
        ...INQUIRY_EVENT_NAMES,
        ...INQUIRY_SESSION_EVENT_NAMES,
        ...VERIFICATION_EVENT_NAMES,
        ...ACCOUNT_EVENT_NAMES,
        ...SELFIE_EVENT_NAMES,
        ...REPORT_EVENT_NAMES,
        ...LIST_MATCH_EVENT_NAMES,
        ...TRANSACTION_EVENT_NAMES,
        ...TRANSACTION_TYPE_EVENT_NAMES,
        ...GRAPH_QUERY_EVENT_NAMES,
        ...WORKFLOW_EVENT_NAMES,
        ...WORKFLOW_VERSION_EVENT_NAMES,
        ...WORKFLOW_RUN_EVENT_NAMES,
        ...LIST_EVENT_NAMES,
        ...CASE_EVENT_NAMES,
        ...CASE_COMMENT_EVENT_NAMES,
        ...CASE_TEMPLATE_EVENT_NAMES,
        // C154.8 (Workflow 9A): INQUIRY_TEMPLATE_VERSION_EVENT_NAMES and DEPLOYMENT_EVENT_NAMES.
        'inquiry-template-version.created',
        'inquiry-template-version.published',
        'deployment.completed',
        // C239.1 (Workflow 11A): listed name by name above; `phase11a-common.test.ts` holds the
        // three groups.
        ...EVENT_NAMES.filter(
          (name) => name.startsWith('connect/') || name.startsWith('consent-record.'),
        ),
      ].sort(),
    ).toEqual([...EVENT_NAMES].sort());
    expect(eventSubject('list-match.created')).toBe('list-match');
    expect(eventSubject('transaction.labeled')).toBe('transaction');
    expect(eventSubject('transaction-type.deleted-field')).toBe('transaction-type');
    for (const name of REPORT_EVENT_NAMES) {
      expect(eventSubject(name as EventName)).toBe('report');
    }
    for (const name of INQUIRY_EVENT_NAMES) {
      expect(eventSubject(name)).toBe('inquiry');
    }
    for (const name of INQUIRY_SESSION_EVENT_NAMES) {
      expect(eventSubject(name)).toBe('inquiry-session');
    }
    for (const name of VERIFICATION_EVENT_NAMES) {
      expect(eventSubject(name)).toBe('verification');
    }
    for (const name of ACCOUNT_EVENT_NAMES) {
      expect(eventSubject(name)).toBe('account');
    }
  });

  it('names each event <subject>.<kebab-case action>, a report subject with its type (C70.4)', () => {
    for (const name of EVENT_NAMES) {
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      expect(name).toMatch(/^[a-z]+(?:-[a-z]+)*(?:\/[a-z]+(?:-[a-z]+)*)?\.[a-z]+(?:-[a-z]+)*$/);
      // C239.4 (Workflow 11A): `connect/` is the second family whose head holds a slash.
      expect(name.includes('/')).toBe(name.startsWith('report/') || name.startsWith('connect/'));
    }
  });

  it('reuses the inquiry event names of the core state machine for every status', () => {
    for (const status of INQUIRY_STATUSES) {
      expect(EVENT_NAMES).toContain(INQUIRY_EVENT_BY_STATUS[status]);
      expect(inquiryEventForStatus(status)).toBe(INQUIRY_EVENT_BY_STATUS[status]);
    }
  });

  it('maps verification statuses to their events (core table)', () => {
    expect(VERIFICATION_EVENT_BY_STATUS).toEqual({
      initiated: 'verification.created',
      submitted: 'verification.submitted',
      passed: 'verification.passed',
      failed: 'verification.failed',
      canceled: 'verification.canceled',
      skipped: 'verification.skipped',
    });
    for (const status of VERIFICATION_STATUSES) {
      const expected =
        (VERIFICATION_EVENT_BY_STATUS as Record<string, string | undefined>)[status] ?? null;
      expect(verificationEventForStatus(status)).toBe(expected);
      if (expected !== null) {
        expect(EVENT_NAMES).toContain(expected);
      }
    }
  });

  it('recognises event names, for example when reading stored events', () => {
    expect(isEventName('verification.passed')).toBe(true);
    expect(isEventName('inquiry.expired')).toBe(true);
    expect(isEventName('account.consolidated-with')).toBe(true);
    expect(isEventName('inquiry.deleted')).toBe(false);
    expect(isEventName('toString')).toBe(false);
  });

  it('refuses a subject for an unknown name', () => {
    expect(() => eventSubject('case.agent-reviewed' as EventName)).toThrow(TypeError);
    expect(() => eventSubject('report/screening.ready' as EventName)).toThrow(TypeError);
    expect(() => eventSubject('verification/selfie.passed' as EventName)).toThrow(TypeError);
    expect(isEventName('report/watchlist.submitted')).toBe(false);
  });

  it('ignores prototype keys', () => {
    expect(inquiryEventForStatus('constructor' as never)).toBeNull();
    expect(verificationEventForStatus('toString' as never)).toBeNull();
  });
});

describe('PHASE1_CHECKS (C7)', () => {
  it('enables exactly the C7 checks', () => {
    expect(PHASE1_CHECKS).toEqual({
      government_id: [
        'id_blur_detection',
        'id_glare_detection',
        'id_portrait_detection',
        'id_double_side_detection',
      ],
      selfie: [
        'selfie_image_quality_detection',
        'selfie_multiple_faces_detection',
        'selfie_id_comparison',
      ],
    });
  });

  it('names registered checks of the right verification type', () => {
    for (const [type, checks] of Object.entries(PHASE1_CHECKS)) {
      for (const id of checks) {
        expect(CHECK_REGISTRY.find((check) => check.id === id)?.verificationType).toBe(type);
      }
    }
  });

  it('documents snake_case reason codes for every Phase 1 check', () => {
    expect(Object.keys(PHASE1_CHECK_REASONS).sort()).toEqual(
      [...PHASE1_CHECKS.government_id, ...PHASE1_CHECKS.selfie].sort(),
    );
    for (const reasons of Object.values(PHASE1_CHECK_REASONS)) {
      expect(reasons.length).toBeGreaterThan(0);
      for (const reason of reasons) {
        // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
        expect(reason).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
      }
    }
    expect(NOT_IMPLEMENTED_REASON).toBe('not_implemented');
    expect(IMAGE_UNREADABLE_REASON).toBe('image_unreadable');
  });
});
