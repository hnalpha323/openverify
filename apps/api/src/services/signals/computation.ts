/**
 * C90.5 (Workflow 7A; F02, F03, H23, V17): the signals outbox hook. `transitionInquiryInTx`
 * (`services/inquiries.ts`) calls {@link createSignalComputationInTx} on every status move, inside
 * the transition's transaction, which already holds the inquiry row. On the inquiry's first move
 * into `completed`, `failed` or `expired` (from `pending`, or straight from `created`), it writes
 * the inquiry's `inquiry_signal_computations` row; the `inquiry-signals-sweep` enqueues it within
 * 15 s and the `inquiry-signals` job computes and freezes the values.
 *
 * It decrypts nothing, moves nothing and writes no signal, so `LifecycleDeps` stays
 * `{ events, clock }` and settlement is untouched. An inquiry redacted before the move committed
 * gets no row (owner decision 5 after Workflow 6C): the transition's row shows the redaction it
 * waited for, and a redacted open inquiry still expires.
 *
 * Built by `foundation-7a` (Stage 1b (S)); `api-signals` owns the file from Stage 3.
 */
import type { InquiryStatus } from '@openverify/core';
import { createSignalComputation, type Db, type Inquiry } from '@openverify/db';

export interface SignalComputationMove {
  /** The inquiry after the move, as `transitionInquiryStatus` returned it. */
  inquiry: Inquiry;
  from: InquiryStatus;
  to: InquiryStatus;
}

/** C90.5: the moves that write the outbox row: the first into a terminal or decided-for-us state. */
export function writesSignalComputation(from: InquiryStatus, to: InquiryStatus): boolean {
  return (
    (from === 'pending' && (to === 'completed' || to === 'failed' || to === 'expired')) ||
    (from === 'created' && to === 'expired')
  );
}

/**
 * Writes the inquiry's outbox row in `tx` when the move is its first into `completed`, `failed`
 * or `expired` and the inquiry is not redacted. Returns whether a row was written.
 */
export async function createSignalComputationInTx(
  tx: Db,
  move: SignalComputationMove,
): Promise<boolean> {
  const { inquiry, from, to } = move;
  if (!writesSignalComputation(from, to) || inquiry.redactedAt !== null) {
    return false;
  }
  return createSignalComputation(tx, inquiry.environmentId, {
    inquiryId: inquiry.id,
    triggerStatus: to as 'completed' | 'failed' | 'expired',
  });
}
