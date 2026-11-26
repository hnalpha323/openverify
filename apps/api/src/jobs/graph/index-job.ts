/**
 * C101.3 (Workflow 7B; V09): the `graph-index` job: for one pending `graph_index_jobs` row, under
 * the inquiry's lock, it opens what the inquiry holds (the extraction, its fields, the confirmed OTP
 * destinations) and its sessions' device HMACs (`device_fingerprint` from `ANDROID_ID`; `device_class`
 * and `browser_fingerprint` only with `graph-weak-kinds` on), keys each under its identifier label
 * (`identifierKey`), and writes the rows to the inquiry's account. Verifications marked
 * `from-rejected-handoff` are skipped (C96.3); failed and expired inquiries are indexed too
 * (decision 49). An inquiry redacted after its row was written, or an environment with
 * `graph-indexing` off, ends the row `skipped` with a code, and nothing is opened (owner decision 5
 * after Workflow 6C).
 *
 * Each run counts an attempt first; a failure is rethrown for the queue's retry, and the run that
 * reaches {@link GRAPH_INDEX_MAX_ATTEMPTS} ends the row `errored` (`graph_index_failed`), so the
 * sweep stops enqueueing it. Logs carry codes and ids, never a value. Owner: `api-graph`;
 * `foundation-7b` (Stage 1b (G)) froze the signature.
 */
import {
  endGraphIndexJob,
  getEnvironment,
  getGraphIndexJob,
  getInquiry,
  lockInquiry,
  recordGraphIndexJobAttempt,
  type Db,
  type Keyring,
} from '@openverify/db';
import type { Clock, GraphIndexJob } from '../../ports.js';
import { indexInquiryInTx } from '../../services/graph/indexing.js';
import { graphIndexKey } from '../../services/graph/keys.js';
import { graphSettingsOf } from '../../services/graph/settings.js';
import type { WorkerLogger } from '../logger.js';

/** Runs of the job on one row before it ends `errored` (the queue's own attempts, C107.2). */
export const GRAPH_INDEX_MAX_ATTEMPTS = 5;

export interface GraphIndexDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  keyring: Keyring;
  /** C31.8, C98.2: the blind-index key every value key is made with. */
  blindIndexKey?: Uint8Array | undefined;
}

export interface GraphIndexResult {
  status: 'indexed' | 'skipped';
}

export type ProcessGraphIndex = (
  job: GraphIndexJob,
  deps: GraphIndexDeps,
) => Promise<GraphIndexResult>;

const SKIPPED: GraphIndexResult = Object.freeze({ status: 'skipped' });

export const processGraphIndex: ProcessGraphIndex = async (job, deps) => {
  const { db, clock } = deps;
  const { environmentId, inquiryId } = job;
  const row = await getGraphIndexJob(db, environmentId, inquiryId);
  if (row?.status !== 'pending') {
    return SKIPPED;
  }
  const skip = async (code: string) => {
    await endGraphIndexJob(db, environmentId, inquiryId, {
      status: 'skipped',
      code,
      at: clock.now(),
    });
    return SKIPPED;
  };
  const inquiry = await getInquiry(db, environmentId, inquiryId);
  if (inquiry?.redactedAt !== null) {
    return skip('inquiry_redacted');
  }
  const environment = await getEnvironment(db, environmentId);
  const settings = environment === null ? null : graphSettingsOf(environment);
  if (settings?.indexing !== true) {
    return skip('graph_indexing_off');
  }
  const attempts = await recordGraphIndexJobAttempt(db, environmentId, inquiryId);
  try {
    const key = deps.blindIndexKey ?? graphIndexKey();
    if (key === null) {
      throw new Error('blind_index_key_missing');
    }
    return await db.transaction(async (tx) => {
      // Under the inquiry's lock: a redaction committed before it leaves nothing to write.
      await lockInquiry(tx, environmentId, inquiryId);
      const locked = await getInquiry(tx, environmentId, inquiryId);
      if (locked?.redactedAt !== null) {
        await endGraphIndexJob(tx, environmentId, inquiryId, {
          status: 'skipped',
          code: 'inquiry_redacted',
          at: clock.now(),
        });
        return SKIPPED;
      }
      await indexInquiryInTx(tx, key, settings, locked, clock.now());
      await endGraphIndexJob(tx, environmentId, inquiryId, {
        status: 'completed',
        at: clock.now(),
      });
      return { status: 'indexed' } satisfies GraphIndexResult;
    });
  } catch (error) {
    const last = attempts >= GRAPH_INDEX_MAX_ATTEMPTS;
    if (last) {
      await endGraphIndexJob(db, environmentId, inquiryId, {
        status: 'errored',
        code: 'graph_index_failed',
        at: clock.now(),
      });
    }
    deps.logger.error(
      {
        environmentId,
        inquiryId,
        attempts,
        error: error instanceof Error ? error.name : 'unknown',
      },
      last ? 'graph index failed for the last time' : 'graph index failed; it will be retried',
    );
    throw error;
  }
};
