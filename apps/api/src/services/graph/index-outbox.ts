/**
 * C101.3 (Workflow 7B; H23, V17, decision 49): the graph index outbox hook. `transitionInquiryInTx`
 * (`services/inquiries.ts`) calls {@link createGraphIndexJobInTx} on every status move, inside the
 * transition's transaction, after the list screening hook. On the inquiry's first move into
 * `completed`, `failed` or `expired` it writes the inquiry's `graph_index_jobs` row; the
 * `graph-index-sweep` enqueues it within 15 s and the `graph-index` job indexes what the inquiry
 * holds. Failed and expired inquiries are indexed too, so a failed fraud attempt links to a later
 * one.
 *
 * It decrypts nothing and reads no setting, so `LifecycleDeps` stays `{ events, clock }`: the job
 * reads `graph-indexing` when it runs, and ends the row `skipped` when it is off. An inquiry redacted
 * before the move committed gets no row (owner decision 5 after Workflow 6C): a redacted open
 * inquiry still expires.
 *
 * Built by `foundation-7b` (Stage 1b (G)); `api-graph` owns the file from Stage 3.
 */
import type { InquiryStatus } from '@openverify/core';
import { createGraphIndexJob, type Db, type Inquiry } from '@openverify/db';
import { writesSignalComputation } from '../signals/computation.js';

export interface GraphIndexMove {
  /** The inquiry after the move, as `transitionInquiryStatus` returned it. */
  inquiry: Inquiry;
  from: InquiryStatus;
  to: InquiryStatus;
}

/** C101.3, V17: the same moves as the signals outbox: the first into a terminal state. */
export const writesGraphIndexJob: (from: InquiryStatus, to: InquiryStatus) => boolean =
  writesSignalComputation;

export type CreateGraphIndexJobInTx = (tx: Db, move: GraphIndexMove) => Promise<boolean>;

/**
 * Writes the inquiry's outbox row in `tx` when the move is its first into `completed`, `failed` or
 * `expired` and the inquiry is not redacted. Returns whether it wrote a row.
 */
export const createGraphIndexJobInTx: CreateGraphIndexJobInTx = async (tx, move) => {
  const { inquiry, from, to } = move;
  if (!writesGraphIndexJob(from, to) || inquiry.redactedAt !== null) {
    return false;
  }
  return createGraphIndexJob(tx, inquiry.environmentId, {
    inquiryId: inquiry.id,
    triggerStatus: to as 'completed' | 'failed' | 'expired',
  });
};
