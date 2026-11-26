/** Options shared by the cross-environment maintenance sweeps (C10 expiry, C16 retention). */

/** C16: maintenance sweeps work in batches of 500 by default. */
export const DEFAULT_SWEEP_LIMIT = 500;

export interface SweepOptions {
  /** Defaults to now. */
  now?: Date;
  /** Batch size; defaults to {@link DEFAULT_SWEEP_LIMIT}. */
  limit?: number;
  /**
   * Lock the rows `FOR UPDATE SKIP LOCKED` inside the caller's transaction, so concurrent
   * workers never take the same row.
   */
  lock?: boolean;
}
