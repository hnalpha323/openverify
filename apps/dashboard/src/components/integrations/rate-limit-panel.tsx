import type { RateLimitResource } from '@openverify/contracts';
import { Detail } from '../detail';
import { Timestamp } from '../timestamp';

/** What each C12 policy limits, for a caller that has more than one. */
const POLICY_LABELS: Readonly<Record<RateLimitResource['attributes']['name'], string>> = {
  api: 'Server API',
  'flow-session': 'Flow session',
  'flow-ip': 'Flow, per address',
  'one-time-link-redeem': 'One-time links, per address',
  // C72.5 (Phase 6): report creations and runs, shared by every key of the environment.
  reports: 'Reports, per environment',
  // C107.3 (Phase 7): the flow's signal bodies and handoffs, and the graph's unmasks.
  'flow-signals': 'Flow signals, per session',
  'flow-handoffs': 'Device handoffs, per session',
  'flow-handoffs-ip': 'Device handoffs, per address',
  'graph-unmask': 'Graph values shown, per user or key',
  // C107.3 (Workflow 7B): lists, importers and graph queries.
  'lists-write': 'List item writes, per environment',
  'lists-match': 'List matches on demand, per key',
  importers: 'List imports, per environment',
  'graph-queries': 'Graph queries, per environment',
  // C143.3 (Workflow 8A): the workflow trigger route, run creation and the egress budgets.
  'workflow-triggers': 'Workflow triggers, per environment',
  'workflow-triggers-key': 'Workflow triggers, per key',
  'workflow-runs': 'Workflow runs, per environment',
  'workflow-subject': 'Workflow runs, per workflow and subject',
  'workflow-http': 'Workflow HTTPS requests, per environment',
  'workflow-email': 'Workflow email, per environment',
  'workflow-email-recipient-hour': 'Workflow email, per recipient an hour',
  'workflow-email-recipient-day': 'Workflow email, per recipient a day',
  'workflow-email-install': 'Workflow email, per recipient across the install',
  'workflow-slack': 'Workflow Slack messages, per secret',
  'workflow-code': 'Workflow code evaluations, per environment',
  // C143.3 (Workflow 8B): case search, creation, exports and attachments.
  'case-search': 'Case searches, per key',
  'case-create': 'Cases created, per environment',
  'case-exports': 'Case exports, per environment',
  'case-attachments': 'Case attachments, per user or key',
  'template-preview': 'Template previews, simulations and validations, per user or key',
  'translations-import': 'Translation imports, per environment',
  'internal-embed-policy': 'Embed policy lookups by the flow server, per server token',
  'theme-assets': 'Theme asset uploads, per environment',
  // C174.4 (Workflow 9B Stage 1b (A)).
  analytics: 'Analytics reads, per user or key',
  // C174.4 (Workflow 9B Stage 1b (U)).
  'invitations-resend': 'Invitation resends, per invitation',
  // C174.4 (Workflow 9B Stage 1b (X)).
  exports: 'Exports, per environment',
  'report-bulk': 'Bulk report uploads, per environment',
  // C221.7 (Workflow 10B Stage 1b (I)): the flow's device integrity calls.
  'flow-integrity': 'Device integrity, per inquiry',
  // C221.7 (Workflow 10C Stage 1a (N)): the sandbox test chip of an NFC step.
  'flow-sandbox-chip': 'Sandbox test chips, per inquiry',
  // C240.3 (Workflow 11A Stage 1a): Connect; one bucket per user or key in each environment.
  'connect-redeem': 'Share token redemptions, per user or key in each environment',
  'connect-peek': 'Share token peeks, per user or key in each environment',
  // C253.7 (Workflow 11B Stage 1a): the per-account access export.
  'account-export': 'Account access exports, per environment',
};

function Limit({ limit }: { readonly limit: RateLimitResource }) {
  const { attributes } = limit;
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <Detail term="Limit">
        {`${String(attributes.limit)} requests every ${String(attributes['window-seconds'])} seconds`}
      </Detail>
      <Detail term="Left in this window">{String(attributes.remaining)}</Detail>
      <Detail term="Full again (UTC)">
        <Timestamp value={attributes['reset-at']} />
      </Detail>
    </dl>
  );
}

/**
 * The caller's rate limit (C12 `GET /rate-limits`), for information: the `api` limit of the
 * operator's dashboard session. Each API key has its own limit of the same size. `null` when the
 * API could not tell it (its limiter fails open, C12).
 */
export function RateLimitPanel({
  limits,
}: {
  readonly limits: readonly RateLimitResource[] | null;
}) {
  return (
    <section
      aria-labelledby="rate-limit"
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="rate-limit" className="text-lg font-semibold">
          Your rate limit
        </h2>
        <p className="text-sm text-ink-muted">
          Requests to the server API are limited per dashboard session and per API key. This is your
          session&apos;s limit now; each API key has its own limit of the same size. Over it, the
          API answers 429 until the window allows more.
        </p>
      </div>
      {limits === null || limits.length === 0 ? (
        <p className="text-sm">Your rate limit is not available right now.</p>
      ) : limits.length === 1 && limits[0] !== undefined ? (
        <Limit limit={limits[0]} />
      ) : (
        limits.map((limit) => (
          <div key={limit.id} className="flex flex-col gap-2">
            <h3 className="text-base font-semibold">{POLICY_LABELS[limit.attributes.name]}</h3>
            <Limit limit={limit} />
          </div>
        ))
      )}
    </section>
  );
}
