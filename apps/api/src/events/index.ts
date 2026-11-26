/**
 * Event publisher (contracts C5 and C14). Publishing writes the `events` row, then one
 * `webhook_deliveries` row per enabled webhook of the environment subscribed to the event
 * (by name or `*`) whose C14 `filters` match the event's subject (`eventFilterSubjects`), in
 * one transaction; after the commit it enqueues one delivery job each.
 *
 * The rows are the outbox: if enqueueing fails after the commit, the deliveries stay pending
 * and the dispatcher's sweep enqueues them later, so a committed event is never lost. The same
 * holds for a workflow's deliveries and wait candidates (C118.1, C119.3), which `stage` writes
 * through their owners' hooks and `dispatch` wakes. An event also records its cause (C121.3).
 * `stage` and `dispatch` split the two halves so the worker can write events in the same
 * transaction as the status changes they announce.
 */
import { buildEventResource } from '@openverify/contracts';
import { createEvent, createWebhookDelivery, listWebhooksForEvent, type Db } from '@openverify/db';
import type { WorkerLogger } from '../jobs/logger.js';
import {
  ulidIdGenerator,
  type EventPublisher,
  type IdGenerator,
  type ListRescreenJob,
  type ListRescreenQueue,
  type PublishEventInput,
  type WorkflowTriggerJob,
  type WorkflowTriggerQueue,
  type WorkflowWaitMatchJob,
  type WorkflowWaitMatchQueue,
} from '../ports.js';
import type { WebhookDeliveryJob, WebhookDeliveryScheduler } from '../webhooks/queue.js';
import { recordWaitCandidatesInTx } from '../workflows/engine/wait-resolution.js';
import { stageWorkflowTriggersInTx } from '../workflows/triggers/stage-hook.js';
import { currentEventCause } from './cause-context.js';
import { eventFilterSubjects, toEventSubject } from './subject.js';

export interface EventPublisherOptions {
  db: Db;
  deliveries: WebhookDeliveryScheduler;
  ids?: IdGenerator;
  logger?: WorkerLogger;
  /** C118.1 (F02): the `workflow-trigger` producer, enqueued after the commit. */
  workflowTriggers?: WorkflowTriggerQueue | undefined;
  /** C119.3 (F02): the `workflow-wait-match` producer, enqueued after the commit. */
  workflowSteps?: WorkflowWaitMatchQueue | undefined;
  /** C127.12: the `list-rescreen` producer, enqueued after the commit. */
  listRescreens?: ListRescreenQueue | undefined;
}

/** An event written inside a transaction, with the deliveries to enqueue after commit. */
export interface StagedEvent {
  eventId: string;
  deliveries: WebhookDeliveryJob[];
  /** C118.1: the deliveries `stageWorkflowTriggersInTx` wrote. */
  workflowDeliveries?: readonly WorkflowTriggerJob[] | undefined;
  /** C119.3: the candidates `recordWaitCandidatesInTx` wrote. */
  waitCandidates?: readonly WorkflowWaitMatchJob[] | undefined;
  /** C127.12: the requests `stageListUpdated` wrote beside its `list.updated`. */
  listRescreens?: readonly ListRescreenJob[] | undefined;
}

export interface TransactionalEventPublisher extends EventPublisher {
  /**
   * Writes the event and its deliveries with `tx` (a transaction or client). Nothing is
   * enqueued: call `dispatch` once the transaction has committed.
   * @throws {z.ZodError} when the payload does not satisfy C5 or does not match the name.
   */
  stage(tx: Db, input: PublishEventInput): Promise<StagedEvent>;
  /** Enqueues the deliveries of committed events. Failures are logged, never thrown. */
  dispatch(staged: readonly StagedEvent[]): Promise<void>;
}

/**
 * A publisher for a process with no queues, such as a CLI or a pass that was given none. It writes the
 * same rows, which are the outbox, and enqueues nothing: each row waits for its sweep.
 */
export function createOutboxOnlyPublisher(db: Db): TransactionalEventPublisher {
  return createEventPublisher({ db, deliveries: { scheduleDelivery: () => Promise.resolve() } });
}

export function createEventPublisher(options: EventPublisherOptions): TransactionalEventPublisher {
  const { db, deliveries } = options;
  const ids = options.ids ?? ulidIdGenerator;

  async function stage(tx: Db, input: PublishEventInput): Promise<StagedEvent> {
    const { environmentId, name, payload } = input;
    const eventId = ids.newId('evt');
    // C121.3: the cause it is given, else the request's, the run's or the bulk job's.
    const cause = input.cause ?? currentEventCause();
    // Validates the payload and its agreement with the name before anything is written.
    buildEventResource({ id: eventId, name, payload, createdAt: new Date() });
    await createEvent(tx, environmentId, {
      id: eventId,
      name,
      payload,
      ...(cause === undefined ? {} : { cause }),
    });
    const [subject] = await eventFilterSubjects(tx, environmentId, [payload]);
    const subscribed = await listWebhooksForEvent(tx, environmentId, name, toEventSubject(subject));
    const staged: WebhookDeliveryJob[] = [];
    for (const webhook of subscribed) {
      const delivery = await createWebhookDelivery(tx, environmentId, {
        id: ids.newId('whd'),
        webhookId: webhook.id,
        eventId,
      });
      if (delivery !== null) {
        staged.push({ environmentId, deliveryId: delivery.id, attempt: 1 });
      }
    }
    // C118.1, C119.3 (F03): each hook is its owner's, and writes in the event's own transaction.
    const facts = { environmentId, eventId, name, payload, cause };
    const workflowDeliveries = await stageWorkflowTriggersInTx(tx, facts);
    const waitCandidates = await recordWaitCandidatesInTx(tx, facts);
    return { eventId, deliveries: staged, workflowDeliveries, waitCandidates };
  }

  /** F02: best effort after the commit; the sweeps stay the outbox. */
  async function wake(
    eventId: string,
    enqueue: (() => Promise<void>) | undefined,
    what: string,
  ): Promise<void> {
    try {
      await enqueue?.();
    } catch (error) {
      options.logger?.warn(
        { eventId, error: (error as Error).name },
        `${what} not enqueued; its sweep will enqueue it`,
      );
    }
  }

  async function dispatch(events: readonly StagedEvent[]): Promise<void> {
    const { workflowTriggers, workflowSteps, listRescreens } = options;
    for (const staged of events) {
      const { eventId, deliveries: jobs, workflowDeliveries, waitCandidates } = staged;
      for (const job of jobs) {
        try {
          await deliveries.scheduleDelivery(job);
        } catch (error) {
          options.logger?.warn(
            { eventId, deliveryId: job.deliveryId, error: (error as Error).name },
            'webhook delivery not enqueued; the dispatcher sweep will enqueue it',
          );
        }
      }
      for (const job of workflowDeliveries ?? []) {
        await wake(
          eventId,
          workflowTriggers && (() => workflowTriggers.enqueueWorkflowTrigger(job)),
          'workflow delivery',
        );
      }
      for (const job of waitCandidates ?? []) {
        await wake(
          eventId,
          workflowSteps && (() => workflowSteps.enqueueWorkflowWaitMatch(job)),
          'wait candidate',
        );
      }
      for (const job of staged.listRescreens ?? []) {
        await wake(
          eventId,
          listRescreens && (() => listRescreens.enqueueListRescreen(job)),
          'list re-screen',
        );
      }
    }
  }

  return {
    stage,
    dispatch,
    async publish(input) {
      const staged = await db.transaction((tx) => stage(tx, input));
      await dispatch([staged]);
      return staged.eventId;
    },
  };
}
