/**
 * C251.3 (Phase 11, Workflow 11B Stage 2, `quotas`): the console's queue panel. For each queue that
 * holds this environment's work under a cap (C251.1), how many of its jobs are queued or running
 * against its cap. The caps come from the settings the page already reads (`queue-in-flight-caps`,
 * served at most the install ceiling, and Phase 8's `workflow-in-flight-cap`); a queue the
 * environment never set shows the default. The in-flight counts come only from a server that
 * reports them; without one the panel says "Not reported", never a zero it did not read.
 *
 * A server component: the browser receives the rendered names and numbers, never the settings
 * object it was given.
 */
import {
  QUEUE_IN_FLIGHT_CAP,
  QUEUE_IN_FLIGHT_CAP_QUEUES,
  type DashboardSettings,
  type EnvironmentKind,
} from '@openverify/contracts';
import { DataTable } from '../data-table';
import { ENVIRONMENT_NAMES, formatCount } from '../operators/settings-fields';

/** A queue's in-flight count and cap, as the server reports them. */
export interface QueueUsage {
  readonly queue: string;
  readonly inFlight: number;
  readonly cap: number;
}

/**
 * Each capped queue's name in words, in the setting's order, then Phase 8's workflow steps (their
 * cap is `workflow-in-flight-cap`).
 */
export const QUEUE_NAMES: Readonly<
  Record<(typeof QUEUE_IN_FLIGHT_CAP_QUEUES)[number] | 'workflow-step', string>
> = {
  'process-verification': 'Verification processing',
  'report-run': 'Report runs',
  'connect-redeem': 'Connect redemptions',
  'account-export': 'Account access exports',
  'list-screen': 'List screenings',
  'list-import': 'List imports',
  'list-item-embed': 'Biometric list items',
  'graph-index': 'Graph indexing',
  'graph-query': 'Graph queries',
  'inquiry-signals': 'Inquiry signals',
  'list-rescreen': 'List re-screens',
  'integrity-decode': 'Device integrity decodes',
  'case-rendition': 'Case attachment previews',
  'case-attachment-scan': 'Case attachment scans',
  'case-bulk': 'Case bulk actions',
  'workflow-step': 'Workflow steps',
};

/** One row of the panel. */
export interface QueuePanelRow {
  readonly queue: string;
  readonly name: string;
  /** `null` when the server did not report it. */
  readonly inFlight: number | null;
  readonly cap: number;
  /** The cap is the default, not a value of this environment or the server's report. */
  readonly defaulted: boolean;
}

/** The panel's rows, in {@link QUEUE_NAMES} order. */
export function queuePanelRows(
  settings: Partial<Pick<DashboardSettings, 'queue-in-flight-caps' | 'workflow-in-flight-cap'>>,
  usage: readonly QueueUsage[] | null | undefined,
): QueuePanelRow[] {
  const reported = new Map((usage ?? []).map((entry) => [entry.queue, entry]));
  const stored = settings['queue-in-flight-caps'] ?? {};
  return Object.entries(QUEUE_NAMES).map(([queue, name]) => {
    const report = reported.get(queue);
    if (report !== undefined) {
      return { queue, name, inFlight: report.inFlight, cap: report.cap, defaulted: false };
    }
    const own =
      queue === 'workflow-step'
        ? settings['workflow-in-flight-cap']
        : stored[queue as keyof typeof stored];
    return {
      queue,
      name,
      inFlight: null,
      cap: own ?? QUEUE_IN_FLIGHT_CAP.default,
      defaulted: own === undefined,
    };
  });
}

const muted = (words: string) => <span className="text-ink-muted">{words}</span>;

/** The panel, under the settings of the session's environment. */
export function QueuePanel({
  settings,
  environment,
  usage,
}: {
  readonly settings: Pick<DashboardSettings, 'queue-in-flight-caps' | 'workflow-in-flight-cap'>;
  readonly environment: EnvironmentKind;
  readonly usage?: readonly QueueUsage[] | null | undefined;
}) {
  const rows = queuePanelRows(settings, usage);
  return (
    <section
      aria-labelledby="settings-queues"
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6"
    >
      <h2 id="settings-queues" className="text-lg font-semibold">
        Queues
      </h2>
      <p className="text-sm text-ink-muted">
        How many of this environment’s jobs each queue holds, queued or running, against its cap;
        more wait their turn. Each cap is {formatCount(QUEUE_IN_FLIGHT_CAP.default)} unless this
        environment lowered it, and never above this installation’s ceiling
        (OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX).
      </p>
      <DataTable
        caption={`Queues in ${ENVIRONMENT_NAMES[environment]}`}
        columns={[
          { id: 'queue', header: 'Queue', cell: (row) => row.name, rowHeader: true },
          {
            id: 'in-flight',
            header: 'In flight',
            cell: (row) =>
              row.inFlight === null
                ? muted('Not reported')
                : row.inFlight >= row.cap
                  ? `${formatCount(row.inFlight)} (at its cap)`
                  : formatCount(row.inFlight),
          },
          {
            id: 'cap',
            header: 'Cap',
            cell: (row) =>
              row.defaulted ? `${formatCount(row.cap)} (default)` : formatCount(row.cap),
          },
        ]}
        rows={rows}
        getRowKey={(row) => row.queue}
        emptyMessage="No queue is capped."
      />
      <p className="text-sm text-ink-muted">
        A cap bounds how much of the worker this environment can hold; it adds no capacity, and a
        cap set too low delays this environment’s own work.
      </p>
    </section>
  );
}
