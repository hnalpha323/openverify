/**
 * The repeatable `inquiry-expiry` job (contract C10), every 60 seconds:
 *
 * 1. overdue `created` and `pending` inquiries (`expires_at` passed) are expired with the same
 *    effects as `POST /inquiries/:id/expire` (`transitionInquiryInTx`): `inquiry.expired` and
 *    `inquiry.transitioned`, active sessions canceled, `initiated` and (C50.7) `confirmed`
 *    verifications canceled through each type's cancel hook (C54.1: an open selfie capture
 *    errored and its file rows deleted, C40.2; a Phase 5 type's open sub-resources) and unused
 *    one-time links revoked; the objects of the file rows a hook deleted are deleted with this
 *    job's storage once the batch committed and its events were dispatched, best effort, and a
 *    failure is logged as a count (Workflow 4B review K201; the Phase 4 follow-up of C67);
 * 2. active sessions past their TTL become `expired`, with `inquiry-session.expired`.
 *
 * Rows are taken in batches `FOR UPDATE SKIP LOCKED`, so several workers can run the job at
 * once without touching the same row twice. Each inquiry is expired in its own savepoint: one
 * that cannot be expired (for example a row that no longer satisfies the contract) is logged
 * with its ids and skipped, and the others still expire. Events are dispatched after each
 * batch commits. The job acts for no principal, so it writes no audit entries (C15).
 */
import {
  DEFAULT_SWEEP_LIMIT,
  getInquiry,
  listOverdueInquiries,
  listOverdueInquirySessions,
  type Db,
} from '@openverify/db';
import type { StagedEvent, TransactionalEventPublisher } from '../events/index.js';
import type { Clock, FileStorage } from '../ports.js';
import { transitionInquiryInTx } from '../services/inquiries.js';
import { expireSessions } from '../services/inquiry-sessions.js';
import { deleteObjects } from '../services/selfie-captures.js';
import type { WorkerLogger } from './logger.js';

export const INQUIRY_EXPIRY_QUEUE = 'inquiry-expiry';
/** C10: the job runs every 60 seconds. */
export const INQUIRY_EXPIRY_INTERVAL_MS = 60_000;
/** Upper bound of batches per run, so one run cannot hold a worker indefinitely. */
const DEFAULT_MAX_BATCHES = 20;

export interface InquiryExpiryDeps {
  db: Db;
  /** The object store of the files the cancel hooks of an expiry delete (K201, C54.3). */
  storage: FileStorage;
  events: TransactionalEventPublisher;
  clock: Clock;
  logger: WorkerLogger;
  /** Rows per batch; defaults to 500 (C16 sweeps). */
  batchSize?: number;
  /** Batches per kind of row and run; defaults to 20. */
  maxBatches?: number;
}

export interface InquiryExpiryResult {
  expiredInquiries: number;
  expiredSessions: number;
  /** Overdue inquiries that could not be expired this run; each is logged. */
  failedInquiries: number;
}

interface BatchResult {
  selected: number;
  expired: number;
  failed: number;
  staged: StagedEvent[];
  /** Objects of the file rows the batch deleted, to delete once it committed. */
  storageKeys: string[];
}

async function expireInquiryBatch(
  deps: InquiryExpiryDeps,
  now: Date,
  limit: number,
): Promise<BatchResult> {
  return deps.db.transaction(async (tx) => {
    const overdue = await listOverdueInquiries(tx, { now, limit, lock: true });
    const result: BatchResult = {
      selected: overdue.length,
      expired: 0,
      failed: 0,
      staged: [],
      storageKeys: [],
    };
    for (const row of overdue) {
      try {
        const expired = await tx.transaction(async (savepoint) => {
          const inquiry = await getInquiry(savepoint, row.environmentId, row.id);
          return inquiry === null
            ? null
            : transitionInquiryInTx(savepoint, deps, inquiry, 'expired');
        });
        if (expired !== null) {
          result.expired += 1;
          result.staged.push(...expired.staged);
          result.storageKeys.push(...expired.storageKeys);
        }
      } catch (error) {
        result.failed += 1;
        deps.logger.error(
          {
            inquiryId: row.id,
            environmentId: row.environmentId,
            error: (error as Error).name,
          },
          'inquiry could not be expired',
        );
      }
    }
    return result;
  });
}

async function expireSessionBatch(
  deps: InquiryExpiryDeps,
  now: Date,
  limit: number,
): Promise<BatchResult> {
  return deps.db.transaction(async (tx) => {
    const overdue = await listOverdueInquirySessions(tx, { now, limit, lock: true });
    const staged = await expireSessions(tx, deps.events, overdue, now);
    return { selected: overdue.length, expired: staged.length, failed: 0, staged, storageKeys: [] };
  });
}

/** Runs `batch` until a batch is not full or makes no progress, up to the batch limit. */
async function drain(
  deps: InquiryExpiryDeps,
  batch: (now: Date, limit: number) => Promise<BatchResult>,
): Promise<{ expired: number; failed: number; undeletedObjects: number }> {
  const limit = deps.batchSize ?? DEFAULT_SWEEP_LIMIT;
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES;
  const now = deps.clock.now();
  const totals = { expired: 0, failed: 0, undeletedObjects: 0 };
  for (let round = 0; round < maxBatches; round += 1) {
    const result = await batch(now, limit);
    await deps.events.dispatch(result.staged);
    totals.undeletedObjects += await deleteObjects(deps.storage, result.storageKeys);
    totals.expired += result.expired;
    totals.failed += result.failed;
    if (result.selected < limit || result.expired === 0) {
      break;
    }
  }
  return totals;
}

/** One run of the `inquiry-expiry` job. */
export async function runInquiryExpiry(deps: InquiryExpiryDeps): Promise<InquiryExpiryResult> {
  const inquiries = await drain(deps, (now, limit) => expireInquiryBatch(deps, now, limit));
  const sessions = await drain(deps, (now, limit) => expireSessionBatch(deps, now, limit));
  if (inquiries.undeletedObjects > 0) {
    // Counts only: their keys and wrapped data keys went with the rows, so they stay unreadable.
    deps.logger.warn(
      { undeletedObjects: inquiries.undeletedObjects },
      'capture objects not deleted; they stay crypto-shredded',
    );
  }
  if (inquiries.expired + sessions.expired + inquiries.failed > 0) {
    deps.logger.info(
      {
        expiredInquiries: inquiries.expired,
        expiredSessions: sessions.expired,
        failedInquiries: inquiries.failed,
      },
      'inquiry expiry run',
    );
  }
  return {
    expiredInquiries: inquiries.expired,
    expiredSessions: sessions.expired,
    failedInquiries: inquiries.failed,
  };
}
