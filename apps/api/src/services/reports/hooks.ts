/**
 * Workflow 6A Stage 1b (`foundation-6`): what every report hook in this folder reads from the
 * shared code that calls it. Frozen: `api-reports` builds the hooks against it, and a change is a
 * plan amendment.
 */
import type { TransactionalEventPublisher } from '../../events/index.js';
import type { Clock } from '../../ports.js';

/** The publisher (events are staged in the caller's transaction) and the clock. */
export interface ReportHookDeps {
  events: TransactionalEventPublisher;
  clock: Clock;
}
