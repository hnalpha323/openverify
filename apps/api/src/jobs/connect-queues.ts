/**
 * C232.5 (Workflow 11A Stage 1b (C)): Connect's worker jobs, scheduled only while the install allows
 * Connect (`OPENVERIFY_CONNECT_ENABLED`, `config.connect.enabled`).
 *
 * - `connect-token-expiry`: a repeatable job every 60 s, one at a time, whose pass is
 *   `runConnectTokenExpiry` (`jobs/connect-token-expiry.ts`, `api-connect`'s), in batches of
 *   {@link CONNECT_TOKEN_EXPIRY_BATCH_SIZE}.
 *
 * - `connect-redeem` (Stage 1b (R)): one job per redeemed token, its id the token's, enqueued by the
 *   redeem route (`routes/server/connect-redeem.ts`) and by the client-side redemption once the
 *   transaction that set the token `pending` commits; its processor is `processConnectRedeem`
 *   (`jobs/connect-redeem/process.ts`, `api-redeem`'s). Jobs carry ids only (never a value, rule 11);
 *   one attempt: a transient database error is retried inside the job, three times (C234.2), and a
 *   failure is final. Uncapped in 11A (C234.2).
 *
 * Frozen by `foundation-11a`; a change is a plan amendment.
 */
import { isId } from '@openverify/contracts';
import type { JobsOptions } from 'bullmq';
import type { RepeatableJob } from '../worker.js';
import { createBullQueue, type BullQueueOptions, type JobQueue } from './queue.js';
import {
  runConnectTokenExpiry,
  type ConnectTokenExpiryDeps,
  type RunConnectTokenExpiry,
} from './connect-token-expiry.js';

export const CONNECT_TOKEN_EXPIRY_QUEUE = 'connect-token-expiry';
/** C232.5: a minute sweep. */
export const CONNECT_TOKEN_EXPIRY_INTERVAL_MS = 60_000;
/** C232.5: tokens per batch. */
export const CONNECT_TOKEN_EXPIRY_BATCH_SIZE = 500;

/** The Connect repeatable jobs; none while Connect is off (`connect` absent). */
export function connectRepeatableJobs(
  deps: ConnectTokenExpiryDeps,
  connect: { runTokenExpiry?: RunConnectTokenExpiry | undefined } | undefined,
): RepeatableJob[] {
  if (connect === undefined) {
    return [];
  }
  const run = connect.runTokenExpiry ?? runConnectTokenExpiry;
  return [
    {
      name: CONNECT_TOKEN_EXPIRY_QUEUE,
      repeat: { every: CONNECT_TOKEN_EXPIRY_INTERVAL_MS },
      run: async () => {
        await run(deps);
      },
    },
  ];
}

export const CONNECT_REDEEM_QUEUE = 'connect-redeem';
export const CONNECT_REDEEM_JOB = 'connect-redeem';

/** C234.2: a redemption's job: the destination environment and the token, ids only. */
export interface ConnectRedeemJob {
  /** The destination environment the copy is written to. */
  environmentId: string;
  shareTokenId: string;
}

/** C234.2: one attempt (the job retries a transient error itself), removed when it ends. */
export const CONNECT_REDEEM_JOB_OPTIONS = Object.freeze({
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
} as const satisfies JobsOptions);

/** The `connect-redeem` producer. */
export interface ConnectRedeemQueue {
  enqueueConnectRedeem(job: ConnectRedeemJob): Promise<void>;
}

export type ClosableConnectRedeemQueue = ConnectRedeemQueue & { close(): Promise<void> };

export type ConnectRedeemQueueOptions = { queue: JobQueue<ConnectRedeemJob> } | BullQueueOptions;

/** The producer of `connect-redeem`, over BullMQ or an injected queue; opened on first use. */
export function createConnectRedeemQueue(
  options: ConnectRedeemQueueOptions,
): ClosableConnectRedeemQueue {
  let queue = 'queue' in options ? options.queue : undefined;
  return {
    async enqueueConnectRedeem({ environmentId, shareTokenId }) {
      if (!isId('env', environmentId) || !isId('cnst', shareTokenId)) {
        throw new TypeError('connect-redeem jobs need an env_ and a cnst_ id');
      }
      queue ??= createBullQueue<ConnectRedeemJob>(
        CONNECT_REDEEM_QUEUE,
        options as BullQueueOptions,
      );
      await queue.add(
        CONNECT_REDEEM_JOB,
        { environmentId, shareTokenId },
        { ...CONNECT_REDEEM_JOB_OPTIONS, jobId: shareTokenId },
      );
    },
    close: () => queue?.close() ?? Promise.resolve(),
  };
}
