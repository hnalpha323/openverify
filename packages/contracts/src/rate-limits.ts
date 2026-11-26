/**
 * Rate limits (contract C12): GCRA limits in Valkey. `GET /api/v1/rate-limits` lists the
 * caller's limits as `rate-limit` resources whose id is the policy name.
 */
import { z } from 'zod';
import { listDocumentSchema, timestampSchema, toTimestamp } from './json-api.js';

export const RATE_LIMIT_POLICIES = [
  'api',
  'flow-session',
  'flow-ip',
  'one-time-link-redeem',
  // C72.5 (Phase 6, P09): report creations and runs, per environment.
  'reports',
  // C107.3 (Phase 7, F09): flow signal bodies per session; handoff issues per session and per
  // client address (two rules of the one C96.3 limit); graph unmasks per principal (Workflow 7B).
  'flow-signals',
  'flow-handoffs',
  'flow-handoffs-ip',
  'graph-unmask',
  // C107.3 (Workflow 7B): list item writes per environment, on-demand matches per key, imports per
  // environment and graph queries per environment. Each route owner enforces its policy.
  'lists-write',
  'lists-match',
  'importers',
  'graph-queries',
  // C143.3 (Workflow 8A): the trigger route per environment and per key, run creation per environment
  // and per (workflow, subject), and the egress and compute budgets. Each route or action owner
  // enforces its policy, with the fail mode C143.3 states: the egress and compute budgets fail
  // closed, and the two defer-mode limiters defer.
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
  // C143.3 (Workflow 8B, review-8b R15): the search per key, creation and exports per environment and
  // attachments per principal. Each route or action owner enforces its policy, with C143.3's fail
  // mode: the routes follow C12, and `case-create` defers for a step, never failing open.
  'case-search',
  'case-create',
  'case-exports',
  'case-attachments',
  // C174.4 (Workflow 9A Stage 1b (T)): preview, simulate and validate per principal (validate runs
  // every async publish hook, review P35), and translation imports per environment. Each route owner
  // enforces its policy before it answers (`enforceRoutePolicy`), as C12 says: fail open.
  'template-preview',
  'translations-import',
  // C157.2, C174.4 (Workflow 9A Stage 1b (F); reviews P05, F03): the internal embed-policy lookup per
  // flow-server token, a capacity ceiling only: the flow server limits each client address first.
  'internal-embed-policy',
  // C160.6, C174.4 (Workflow 9A Stage 1b (H)): theme asset uploads per environment (each is
  // re-encoded synchronously through the vision rendition endpoint).
  'theme-assets',
  // C164.8, C174.4 (Workflow 9B Stage 1b (A)): the aggregates API per principal (an API key or a
  // user). The analytics routes enforce it before they answer (`enforceRoutePolicy`): fail open.
  'analytics',
  // C168.1, C174.4 (Workflow 9B Stage 1b (U); review P35): invitation resends per invitation (the
  // invited user), so a link cannot be sent to one address over and over. `api-access`'s route
  // enforces it before it answers (`enforceRoutePolicy`): fail open.
  'invitations-resend',
  // C166.4, C174.4 (Workflow 9B Stage 1b (X)): exports asked for per environment. The export route
  // counts it after the object type's permission and before anything else: fail open.
  'exports',
  // C166.5, C174.4 (Workflow 9B Stage 1b (X); review P35): bulk report uploads per environment,
  // counted by the upload route before anything else: fail open.
  'report-bulk',
  // C211.3, C221.7 (Workflow 10B Stage 1b (I)): the integrity challenge and token routes together,
  // per inquiry, counted by the flow scope with `flow-session`, before the body: fail open.
  'flow-integrity',
  // C208.1, C221.7 (Workflow 10C Stage 1a (N)): the sandbox test chip route, per inquiry, counted
  // by the flow scope with `flow-session`, before the body: fail open. `client-unable` stays under
  // `flow-session` alone.
  'flow-sandbox-chip',
  // C240.3 (Workflow 11A Stage 1a; verification V11): redemptions and peeks, each with one bucket
  // per principal and environment pair (an API key has one; a user session has one for each
  // environment it acts in). The route owner enforces each before it answers. `connect-redeem`
  // fails open, as C12 says; `connect-peek` fails closed (503 `connect_peek_unavailable`, C233.5).
  'connect-redeem',
  'connect-peek',
  // C253.7 (Workflow 11B Stage 1a; review P16): access exports per environment, counted by the
  // export's create route before anything else. It fails closed (503 `account_export_unavailable`):
  // one key exporting every account in turn is the platform's widest exfiltration path.
  'account-export',
] as const;
export const rateLimitPolicySchema = z.enum(RATE_LIMIT_POLICIES);
export type RateLimitPolicy = z.infer<typeof rateLimitPolicySchema>;

/**
 * Default requests per window ({@link RATE_LIMIT_POLICY_WINDOWS}): `api` per API key or user
 * session (`OPENVERIFY_RATE_LIMIT_API_PER_MINUTE`), `flow-session` per session token, `flow-ip` per
 * client IP on the flow API, `one-time-link-redeem` per client IP, and `reports` (C72.5, ours,
 * provisional) per environment: report creations and `run` calls, which a developer cannot
 * multiply by minting keys (`OPENVERIFY_RATE_LIMIT_REPORTS_PER_MINUTE`). Phase 7 (C107.3, ours,
 * provisional): `flow-signals` 60 a minute per session; `flow-handoffs` 5 an hour per session and
 * `flow-handoffs-ip` 10 an hour per client IP; `graph-unmask` 60 a minute per principal;
 * `lists-write` 600 a minute per environment; `lists-match` 60 a minute per key; `importers` 10 an
 * hour per environment; `graph-queries` 30 a minute per environment. The handoff send budget of
 * C96.3 is its own counter, which fails closed. Phase 8 (C143.3, ours, provisional): `workflow-runs`
 * has no number in C143.3, so it takes `workflow-http`'s 600 a minute per environment, with a basis
 * of no faster than an environment's trigger route; `workflow-slack` is 1 a second, and its action
 * allows a burst of 3. C143.3's case policies, provisional: `case-search` 120 a minute per key;
 * `case-create` 600 an hour per environment, well above a review team's pace and low enough to stop a
 * loop flooding queues (H30); `case-exports` 10 an hour per environment; `case-attachments` 60 a
 * minute per principal.
 */
export const RATE_LIMIT_DEFAULTS = Object.freeze({
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
  // C174.4 (ours, provisional): a console page reads up to six answers, so 60 a minute lets a reader
  // move through the section without letting a script sweep filter combinations quickly (C164.7).
  analytics: 60,
  // C174.4 (ours, provisional): an operator resends a lost or expired link a few times at most; five
  // an hour per invitation stops a loop mailing one person while leaving room for a typo.
  'invitations-resend': 5,
  // C174.4 (ours, provisional): an export reads up to 50,000 rows in a job, so ten an hour per
  // environment covers an operator's day of exports and bounds the load a key could queue.
  exports: 10,
  // C174.4 (ours, provisional; review P35): each upload creates up to 1,000 reports, so five an hour
  // per environment is 5,000 reports an hour at most from bulk uploads.
  'report-bulk': 5,
  // C221.7 (provisional): one challenge and one token per inquiry is the norm (C211.3, decision 34:
  // the default Cloud quota is 10,000 a day), so five an hour per inquiry leaves room for a retry
  // and an expired challenge while a loop cannot spend the operator's quota.
  'flow-integrity': 5,
  // C221.7 (provisional): a read takes one sandbox chip, and a person retries a few times (the
  // step's attempts, each up to nine challenges); ten an hour per inquiry covers a test session.
  'flow-sandbox-chip': 10,
  // C240.3 (provisional, ours): a destination redeems about one share per onboarding, so 60 a
  // minute per principal and environment is far above an integration's pace and bounds a loop.
  'connect-redeem': 60,
  // C240.3 (provisional, ours): a peek precedes a redemption, so it takes the same 60 a minute; the
  // per-token cap of ten (C233.5) is what stops a peek being a way to watch a person's data.
  'connect-peek': 60,
  // C253.7 (provisional, ours): an operator answers a few access requests a day; ten an hour per
  // environment covers a backlog and bounds what one key can take.
  'account-export': 10,
} as const satisfies Record<RateLimitPolicy, number>);
/**
 * The defaults before policies had their own window: every Phase 1-6 policy's window is a
 * minute, so its value is per minute. Kept for its callers; the value is per policy window.
 */
export const RATE_LIMIT_DEFAULTS_PER_MINUTE = RATE_LIMIT_DEFAULTS;
/** The window of the Phase 1-6 policies, and the default of {@link RATE_LIMIT_POLICY_WINDOWS}. */
export const RATE_LIMIT_WINDOW_SECONDS = 60;
/** C107.3 (F09): each policy's window in seconds; an hour for the handoff issues and imports. */
export const RATE_LIMIT_POLICY_WINDOWS = Object.freeze({
  api: RATE_LIMIT_WINDOW_SECONDS,
  'flow-session': RATE_LIMIT_WINDOW_SECONDS,
  'flow-ip': RATE_LIMIT_WINDOW_SECONDS,
  'one-time-link-redeem': RATE_LIMIT_WINDOW_SECONDS,
  reports: RATE_LIMIT_WINDOW_SECONDS,
  'flow-signals': RATE_LIMIT_WINDOW_SECONDS,
  'flow-handoffs': 3600,
  'flow-handoffs-ip': 3600,
  'graph-unmask': RATE_LIMIT_WINDOW_SECONDS,
  'lists-write': RATE_LIMIT_WINDOW_SECONDS,
  'lists-match': RATE_LIMIT_WINDOW_SECONDS,
  importers: 3600,
  'graph-queries': RATE_LIMIT_WINDOW_SECONDS,
  'workflow-triggers': RATE_LIMIT_WINDOW_SECONDS,
  'workflow-triggers-key': RATE_LIMIT_WINDOW_SECONDS,
  'workflow-runs': RATE_LIMIT_WINDOW_SECONDS,
  'workflow-subject': RATE_LIMIT_WINDOW_SECONDS,
  'workflow-http': RATE_LIMIT_WINDOW_SECONDS,
  'workflow-email': 3600,
  'workflow-email-recipient-hour': 3600,
  'workflow-email-recipient-day': 86_400,
  'workflow-email-install': 86_400,
  'workflow-slack': 1,
  'workflow-code': RATE_LIMIT_WINDOW_SECONDS,
  'case-search': RATE_LIMIT_WINDOW_SECONDS,
  'case-create': 3600,
  'case-exports': 3600,
  'case-attachments': RATE_LIMIT_WINDOW_SECONDS,
  'template-preview': RATE_LIMIT_WINDOW_SECONDS,
  'translations-import': 3600,
  'internal-embed-policy': RATE_LIMIT_WINDOW_SECONDS,
  'theme-assets': 3600,
  analytics: RATE_LIMIT_WINDOW_SECONDS,
  'invitations-resend': 3600,
  exports: 3600,
  'report-bulk': 3600,
  'flow-integrity': 3600,
  'flow-sandbox-chip': 3600,
  'connect-redeem': RATE_LIMIT_WINDOW_SECONDS,
  'connect-peek': RATE_LIMIT_WINDOW_SECONDS,
  'account-export': 3600,
} as const satisfies Record<RateLimitPolicy, number>);

/**
 * C233.5, C253.7 (Workflow 11B Stage 1a; orchestrator decision 16): the route policies that fail
 * closed when the limiter's store does not answer, each through the one shared helper
 * (`enforceFailClosedPolicy`, `apps/api/src/plugins/rate-limit.ts`) with its route's 503. Every other
 * policy fails open (C12, H18). The login limiter is not a policy (C246) and fails closed on its own.
 */
export const RATE_LIMIT_FAIL_CLOSED_POLICIES = Object.freeze([
  'connect-peek',
  'account-export',
] as const satisfies readonly RateLimitPolicy[]);
export type FailClosedRateLimitPolicy = (typeof RATE_LIMIT_FAIL_CLOSED_POLICIES)[number];

export const rateLimitAttributesSchema = z
  .strictObject({
    name: rateLimitPolicySchema,
    limit: z.int().min(1),
    'window-seconds': z.int().min(1),
    remaining: z.int().min(0),
    'reset-at': timestampSchema,
  })
  .refine((attributes) => attributes.remaining <= attributes.limit, {
    message: 'remaining cannot exceed the limit',
    path: ['remaining'],
  });

export const rateLimitResourceSchema = z
  .strictObject({
    type: z.literal('rate-limit'),
    id: rateLimitPolicySchema,
    attributes: rateLimitAttributesSchema,
  })
  .refine((resource) => resource.id === resource.attributes.name, {
    message: 'the id is the policy name',
    path: ['id'],
  });
export type RateLimitResource = z.infer<typeof rateLimitResourceSchema>;

export const rateLimitListDocumentSchema = listDocumentSchema(rateLimitResourceSchema);

export interface RateLimitRecord {
  name: RateLimitPolicy;
  limit: number;
  windowSeconds: number;
  remaining: number;
  resetAt: Date;
}

/**
 * Builds the rate-limit resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildRateLimitResource(record: RateLimitRecord): RateLimitResource {
  return rateLimitResourceSchema.parse({
    type: 'rate-limit',
    id: record.name,
    attributes: {
      name: record.name,
      limit: record.limit,
      'window-seconds': record.windowSeconds,
      remaining: record.remaining,
      'reset-at': toTimestamp(record.resetAt),
    },
  });
}
