/**
 * The slice of a BullMQ queue the API uses, so producers can be tested without Valkey.
 * A BullMQ `Queue` satisfies it; `createBullQueue` builds one over the Redis protocol.
 */
import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';

export interface JobQueue<Data> {
  add(name: string, data: Data, options?: JobsOptions): Promise<unknown>;
  /**
   * Removes the job with this id, in any state but active (an active job is locked and stays).
   * BullMQ ignores an `add` under an id that still exists, a failed or completed job included.
   */
  remove?(jobId: string): Promise<unknown>;
  close(): Promise<void>;
}

export interface BullQueueOptions {
  /** ioredis options, a `redis://` URL in `{ url }`, or an ioredis client. */
  connection: ConnectionOptions;
  /** Key prefix in Valkey, to isolate environments or tests. Defaults to `bull`. */
  prefix?: string | undefined;
}

/** A BullMQ queue named `name`. */
export function createBullQueue<Data>(name: string, options: BullQueueOptions): JobQueue<Data> {
  return new Queue<Data>(name, {
    connection: options.connection,
    ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
  }) as unknown as JobQueue<Data>;
}
