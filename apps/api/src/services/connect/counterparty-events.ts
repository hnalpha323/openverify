/**
 * C239.1, C240.5 (Workflow 11A): the counterparty entry point of the event writer, the one way an
 * event reaches the other side's environment (the destination's `inbound-created`, both sides'
 * connection events, `consent-withdrawn`, `source-redacted`). Staged in the same transaction as the
 * change (rule 20(f)), with the resource as the receiving side sees it (C239.2), never shared data.
 *
 * Only `cross-tenant.ts` imports this module (the ESLint rule and the source test hold it). The
 * shared event writer (`apps/api/src/events/`) is unchanged: this stages through it, with an empty
 * cause, so the other organisation's principal is never recorded in the counterparty's environment
 * (review P26: the other controller's staff are not disclosed).
 *
 * Built by `api-connect` over `foundation-11a`'s stub.
 */
import type { EventName } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import {
  createOutboxOnlyPublisher,
  type StagedEvent,
  type TransactionalEventPublisher,
} from '../../events/index.js';
import type { EventPayload } from '@openverify/contracts';

/** One event for one environment of the counterparty. */
export interface CounterpartyEvent {
  environmentId: string;
  name: EventName;
  /** The resource document as that side sees it (C232.3, C239.2). */
  payload: Record<string, unknown>;
}

/**
 * Stages the events in `tx` (the transaction of the change) and returns them for the caller to
 * dispatch after its commit. Without `publisher` the rows are written as the outbox only (the
 * webhook dispatcher's and the workflow triggers' sweeps enqueue them).
 */
export async function stageCounterpartyEvents(
  tx: Db,
  events: readonly CounterpartyEvent[],
  publisher: TransactionalEventPublisher = createOutboxOnlyPublisher(tx),
): Promise<StagedEvent[]> {
  const staged: StagedEvent[] = [];
  for (const event of events) {
    staged.push(
      await publisher.stage(tx, {
        environmentId: event.environmentId,
        name: event.name,
        payload: event.payload as EventPayload,
        cause: {},
      }),
    );
  }
  return staged;
}
