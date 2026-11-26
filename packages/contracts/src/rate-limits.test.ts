import { describe, expect, it } from 'vitest';
import {
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_DEFAULTS_PER_MINUTE,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_POLICY_WINDOWS,
  RATE_LIMIT_WINDOW_SECONDS,
  buildRateLimitResource,
  rateLimitListDocumentSchema,
  rateLimitResourceSchema,
} from './rate-limits.js';
import { LATER, LATER_ISO } from './test-support.js';

const rateLimit = {
  type: 'rate-limit',
  id: 'api',
  attributes: {
    name: 'api',
    limit: 300,
    'window-seconds': 60,
    remaining: 287,
    'reset-at': LATER_ISO,
  },
};

describe('rate limits (C12)', () => {
  it('have their policies with their default limits per window (C72.5, C107.3)', () => {
    expect(RATE_LIMIT_POLICIES).toEqual([
      'api',
      'flow-session',
      'flow-ip',
      'one-time-link-redeem',
      'reports',
      // C107.3 (Phase 7, F09): the flow signals per session, the handoff issues per session and
      // per client address, and the graph unmask per principal (reserved for Workflow 7B).
      'flow-signals',
      'flow-handoffs',
      'flow-handoffs-ip',
      'graph-unmask',
      // C107.3 (Workflow 7B): list writes per environment, on-demand matches per key, imports per
      // environment, graph queries per environment.
      'lists-write',
      'lists-match',
      'importers',
      'graph-queries',
      // C143.3 (Workflow 8A): the trigger route per environment and per key, run creation, one
      // subject's runs, and the egress and compute budgets.
      'workflow-triggers',
      'workflow-triggers-key',
      'workflow-runs',
      'workflow-subject',
      'workflow-http',
      'workflow-email',
      'workflow-email-recipient-hour',
      'workflow-email-recipient-day',
      'workflow-email-install',
      'workflow-slack',
      'workflow-code',
      // C143.3 (Workflow 8B, review-8b R15): search per key, creation and exports per environment,
      // attachments per principal.
      'case-search',
      'case-create',
      'case-exports',
      'case-attachments',
      // C174.4 (Workflow 9A): preview, simulate and validate per principal; imports per environment.
      'template-preview',
      'translations-import',
      'internal-embed-policy',
      'theme-assets',
      // C174.4 (Workflow 9B Stage 1b (A)): the aggregates API per principal.
      'analytics',
      // C174.4 (Workflow 9B Stage 1b (U)): invitation resends per invitation.
      'invitations-resend',
      // C174.4 (Workflow 9B Stage 1b (X)): exports and bulk report uploads per environment.
      'exports',
      'report-bulk',
      // C221.7 (Workflow 10B Stage 1b (I)): the integrity routes per inquiry.
      'flow-integrity',
      // C221.7 (Workflow 10C Stage 1a (N)): the sandbox test chip per inquiry.
      'flow-sandbox-chip',
      // C240.3 (Workflow 11A Stage 1a): redemptions and peeks per principal and environment.
      'connect-redeem',
      'connect-peek',
      // C253.7 (Workflow 11B Stage 1a): access exports per environment, failing closed.
      'account-export',
    ]);
    expect(RATE_LIMIT_DEFAULTS).toEqual({
      api: 300,
      'flow-session': 120,
      'flow-ip': 600,
      'one-time-link-redeem': 30,
      reports: 600,
      'flow-signals': 60,
      'flow-handoffs': 5,
      'flow-handoffs-ip': 10,
      'graph-unmask': 60,
      'lists-write': 600,
      'lists-match': 60,
      importers: 10,
      'graph-queries': 30,
      'workflow-triggers': 600,
      'workflow-triggers-key': 60,
      'workflow-runs': 600,
      'workflow-subject': 60,
      'workflow-http': 600,
      'workflow-email': 1_000,
      'workflow-email-recipient-hour': 5,
      'workflow-email-recipient-day': 20,
      'workflow-email-install': 20,
      'workflow-slack': 1,
      'workflow-code': 600,
      'case-search': 120,
      'case-create': 600,
      'case-exports': 10,
      'case-attachments': 60,
      'template-preview': 120,
      'translations-import': 30,
      'internal-embed-policy': 6000,
      'theme-assets': 30,
      analytics: 60,
      'invitations-resend': 5,
      exports: 10,
      'report-bulk': 5,
      'flow-integrity': 5,
      'flow-sandbox-chip': 10,
      'connect-redeem': 60,
      'connect-peek': 60,
      'account-export': 10,
    });
    expect(RATE_LIMIT_DEFAULTS_PER_MINUTE).toBe(RATE_LIMIT_DEFAULTS);
    expect(RATE_LIMIT_WINDOW_SECONDS).toBe(60);
  });

  it('give each policy its window: 60 s by default, an hour for the handoff issues (F09)', () => {
    expect(RATE_LIMIT_POLICY_WINDOWS).toEqual({
      api: 60,
      'flow-session': 60,
      'flow-ip': 60,
      'one-time-link-redeem': 60,
      reports: 60,
      'flow-signals': 60,
      'flow-handoffs': 3600,
      'flow-handoffs-ip': 3600,
      'graph-unmask': 60,
      'lists-write': 60,
      'lists-match': 60,
      importers: 3600,
      'graph-queries': 60,
      'workflow-triggers': 60,
      'workflow-triggers-key': 60,
      'workflow-runs': 60,
      'workflow-subject': 60,
      'workflow-http': 60,
      'workflow-email': 3600,
      'workflow-email-recipient-hour': 3600,
      'workflow-email-recipient-day': 86_400,
      'workflow-email-install': 86_400,
      'workflow-slack': 1,
      'workflow-code': 60,
      'case-search': 60,
      'case-create': 3600,
      'case-exports': 3600,
      'case-attachments': 60,
      'template-preview': 60,
      'translations-import': 3600,
      'internal-embed-policy': 60,
      'theme-assets': 3600,
      analytics: 60,
      'invitations-resend': 3600,
      exports: 3600,
      'report-bulk': 3600,
      'flow-integrity': 3600,
      'flow-sandbox-chip': 3600,
      'connect-redeem': 60,
      'connect-peek': 60,
      'account-export': 3600,
    });
  });

  it('are listed for the caller as rate-limit resources named by policy', () => {
    expect(rateLimitResourceSchema.parse(rateLimit)).toEqual(rateLimit);
    expect(rateLimitListDocumentSchema.parse({ data: [rateLimit], links: { next: null } })).toEqual(
      { data: [rateLimit], links: { next: null } },
    );
  });

  it.each([
    ['an id that is not the name', { id: 'flow-ip' }],
    ['an unknown policy', { id: 'login', attributes: { ...rateLimit.attributes, name: 'login' } }],
    ['more remaining than the limit', { attributes: { ...rateLimit.attributes, remaining: 301 } }],
    ['a zero window', { attributes: { ...rateLimit.attributes, 'window-seconds': 0 } }],
  ])('rejects %s', (_name, change) => {
    expect(rateLimitResourceSchema.safeParse({ ...rateLimit, ...change }).success).toBe(false);
  });

  it('is built from the limiter state', () => {
    expect(
      buildRateLimitResource({
        name: 'api',
        limit: 300,
        windowSeconds: 60,
        remaining: 287,
        resetAt: LATER,
      }),
    ).toEqual(rateLimit);
  });
});
