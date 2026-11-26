/**
 * A job failure that retrying cannot fix, such as a missing or tampered file or an invalid
 * template. The worker turns it into BullMQ's `UnrecoverableError`, so the job fails at once
 * and the verification keeps its status. `reason` is a stable code; it never carries data.
 */
export class PermanentJobError extends Error {
  override name = 'PermanentJobError';
  readonly reason: string;

  constructor(reason: string) {
    super(`The job cannot succeed (${reason})`);
    this.reason = reason;
  }
}
