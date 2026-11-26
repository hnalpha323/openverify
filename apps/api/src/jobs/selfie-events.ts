/**
 * The worker's `selfie.*` events (C40.8): the capture resource, with its `prompt-timings`, staged
 * in the transaction that moved the capture. The payload never carries the nonce or device data
 * (`buildSelfieCaptureResource` reads neither).
 */
import { buildSelfieCaptureResource } from '@openverify/contracts';
import { selfieCapturePromptTimings, type Db, type SelfieCapture } from '@openverify/db';
import type { StagedEvent, TransactionalEventPublisher } from '../events/index.js';

/** The capture events the worker publishes. */
export type WorkerSelfieEventName = 'selfie.processed' | 'selfie.errored';

/** Stages `name` about `capture` with `tx`; dispatch it once the transaction commits. */
export async function stageSelfieCaptureEvent(
  tx: Db,
  events: TransactionalEventPublisher,
  name: WorkerSelfieEventName,
  capture: SelfieCapture,
): Promise<StagedEvent> {
  const promptTimings = await selfieCapturePromptTimings(tx, capture.environmentId, capture.id);
  return events.stage(tx, {
    environmentId: capture.environmentId,
    name,
    payload: { data: buildSelfieCaptureResource({ ...capture, promptTimings }) },
  });
}
