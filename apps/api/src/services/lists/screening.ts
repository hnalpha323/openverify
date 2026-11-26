/**
 * C99.4 (Workflow 7B; H23, V17): the list screening outbox hook. `transitionInquiryInTx`
 * (`services/inquiries.ts`) calls {@link createListScreeningInTx} on every status move, inside the
 * transition's transaction, beside the signals hook. On the inquiry's first move into `completed`,
 * `failed` or `expired`, when the pinned template version's `list-config` selects any list, it
 * writes the inquiry's `list_screenings` row; the `list-screen-sweep` enqueues it within 15 s and
 * the `list-screen` job screens it.
 *
 * It decrypts nothing, moves nothing and matches nothing, so `LifecycleDeps` stays
 * `{ events, clock }`. An inquiry redacted before the move committed gets no row (owner decision 5
 * after Workflow 6C): a redacted open inquiry still expires. With no list selected there is no row,
 * which the serving code reads as `null` with `no_lists_selected`.
 *
 * Built by `foundation-7b` (Stage 1b (L)); `api-lists` owns the file from Stage 3.
 */
import { listConfigSchema, resolveListConfig, type ListConfig } from '@openverify/contracts';
import type { InquiryStatus } from '@openverify/core';
import {
  anyListScreenedByAll,
  createListScreening,
  getInquiryTemplateVersion,
  type Db,
  type Inquiry,
} from '@openverify/db';
import { writesSignalComputation } from '../signals/computation.js';

export interface ListScreeningMove {
  /** The inquiry after the move, as `transitionInquiryStatus` returned it. */
  inquiry: Inquiry;
  from: InquiryStatus;
  to: InquiryStatus;
}

/** C99.4, V17: the same moves as the signals outbox: the first into a terminal state. */
export const writesListScreening = writesSignalComputation;

/** C99.5: whether a resolved `screen` selects a list in the environment. */
async function selectsAnyList(
  tx: Db,
  environmentId: string,
  screen: NonNullable<ListConfig['screen']>,
): Promise<boolean> {
  if (screen === 'none') {
    return false;
  }
  return screen === 'all'
    ? anyListScreenedByAll(tx, environmentId)
    : // A named list that was archived later is still screened: it reads `list_archived`.
      screen.length > 0;
}

/**
 * Writes the inquiry's outbox row in `tx` when the move is its first into `completed`, `failed` or
 * `expired`, the inquiry is not redacted, and its version selects a list. Returns whether it wrote
 * a row.
 */
export async function createListScreeningInTx(tx: Db, move: ListScreeningMove): Promise<boolean> {
  const { inquiry, from, to } = move;
  if (!writesListScreening(from, to) || inquiry.redactedAt !== null) {
    return false;
  }
  const version = await getInquiryTemplateVersion(
    tx,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const { screen } = resolveListConfig(listConfigSchema.parse(version?.listConfig ?? {}));
  if (!(await selectsAnyList(tx, inquiry.environmentId, screen))) {
    return false;
  }
  return createListScreening(tx, inquiry.environmentId, {
    inquiryId: inquiry.id,
    triggerStatus: to as 'completed' | 'failed' | 'expired',
  });
}
