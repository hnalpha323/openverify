/**
 * C211.4 (Workflow 10B, `api-integrity`): a decode that gave no verdict, by a stable code, never a
 * token or an answer's body. `retryable` when another attempt may succeed (the network, a timeout, a
 * 5xx or a 429): the `integrity-decode` job then fails the attempt and BullMQ retries it; otherwise
 * the job stores a failed decode, which the signals read as `integrity_decode_failed`.
 */
export class DeviceIntegrityDecodeError extends Error {
  override name = 'DeviceIntegrityDecodeError';

  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`the device-integrity decode failed (${code})`);
  }
}
