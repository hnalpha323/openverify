/**
 * C101.5 (Workflow 7B; H10, V11): the `graph-backfill` tick, every minute. While any
 * `graph_index_state` row is incomplete, it indexes one bounded batch of an environment's accounts
 * (their fields and reference ids), then of its inquiries past their end state (what the
 * `graph-index` job reads), resumable from the rows' cursor (`{ phase, after }`, ids only), and
 * marks the kinds complete when it reaches the end. The kinds of an environment that share a
 * cursor walk together; a kind marked incomplete later starts its own walk. With every row
 * complete it does nothing. `graph:reindex` runs the same walk on demand
 * (`services/graph/reindex.ts`).
 *
 * Owner: `api-graph`; `foundation-7b` (Stage 1b (G)) froze the signature.
 */
import {
  advanceGraphBackfill,
  getAccount,
  getEnvironment,
  getInquiry,
  listGraphBackfillAccounts,
  listGraphBackfillInquiries,
  listIncompleteGraphIndexStates,
  type Db,
  type Keyring,
} from '@openverify/db';
import type { Clock } from '../../ports.js';
import { indexAccountInTx, indexInquiryInTx } from '../../services/graph/indexing.js';
import { graphIndexKey } from '../../services/graph/keys.js';
import { graphSettingsOf, type GraphSettings } from '../../services/graph/settings.js';
import type { WorkerLogger } from '../logger.js';

/** Accounts or inquiries one tick indexes. */
export const GRAPH_BACKFILL_BATCH_SIZE = 200;

export interface GraphBackfillDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  keyring: Keyring;
  blindIndexKey?: Uint8Array | undefined;
  /** Accounts or inquiries per tick; `GRAPH_BACKFILL_BATCH_SIZE` by default. */
  batchSize?: number | undefined;
}

export type RunGraphBackfill = (deps: GraphBackfillDeps) => Promise<void>;

/** Where a walk stands: ids only. */
export interface GraphBackfillCursor {
  phase: 'accounts' | 'inquiries';
  after: string | null;
}

const START: GraphBackfillCursor = { phase: 'accounts', after: null };

function cursorOf(value: unknown): GraphBackfillCursor {
  const cursor = value as Partial<GraphBackfillCursor> | null;
  return cursor?.phase === 'accounts' || cursor?.phase === 'inquiries'
    ? { phase: cursor.phase, after: typeof cursor.after === 'string' ? cursor.after : null }
    : START;
}

/** What one step of a walk did: the next cursor, or `null` at its end. */
export interface GraphBackfillStep {
  next: GraphBackfillCursor | null;
  accounts: number;
  inquiries: number;
  rows: number;
}

/**
 * One batch of an environment's walk from `cursor`, each account or inquiry in its own
 * transaction, so a failure keeps what was written and the cursor says where it stopped.
 */
export async function backfillStep(
  db: Db,
  key: Uint8Array,
  settings: GraphSettings,
  environmentId: string,
  cursor: GraphBackfillCursor,
  options: { limit: number; at: Date },
): Promise<GraphBackfillStep> {
  const step: GraphBackfillStep = { next: null, accounts: 0, inquiries: 0, rows: 0 };
  if (cursor.phase === 'accounts') {
    const ids = await listGraphBackfillAccounts(db, environmentId, {
      after: cursor.after,
      limit: options.limit,
    });
    for (const id of ids) {
      step.rows += await db.transaction(async (tx) => {
        const account = await getAccount(tx, environmentId, id);
        return account === null ? 0 : indexAccountInTx(tx, key, settings, account, options.at);
      });
      step.accounts += 1;
    }
    step.next =
      ids.length < options.limit
        ? { phase: 'inquiries', after: null }
        : { phase: 'accounts', after: ids.at(-1) ?? null };
    return step;
  }
  const ids = await listGraphBackfillInquiries(db, environmentId, {
    after: cursor.after,
    limit: options.limit,
  });
  for (const id of ids) {
    step.rows += await db.transaction(async (tx) => {
      const inquiry = await getInquiry(tx, environmentId, id);
      return inquiry === null ? 0 : indexInquiryInTx(tx, key, settings, inquiry, options.at);
    });
    step.inquiries += 1;
  }
  step.next = ids.length < options.limit ? null : { phase: 'inquiries', after: ids.at(-1) ?? null };
  return step;
}

export const runGraphBackfill: RunGraphBackfill = async (deps) => {
  const { db, clock, logger } = deps;
  const key = deps.blindIndexKey ?? graphIndexKey();
  if (key === null) {
    return;
  }
  const [first] = await listIncompleteGraphIndexStates(db, { limit: 1 });
  if (first === undefined) {
    return;
  }
  const environmentId = first.environmentId;
  const group = (await listIncompleteGraphIndexStates(db, { limit: 1000 })).filter(
    (state) =>
      state.environmentId === environmentId &&
      JSON.stringify(state.backfillCursor) === JSON.stringify(first.backfillCursor),
  );
  const environment = await getEnvironment(db, environmentId);
  if (environment === null) {
    return;
  }
  const at = clock.now();
  const step = await backfillStep(
    db,
    key,
    graphSettingsOf(environment),
    environmentId,
    cursorOf(first.backfillCursor),
    { limit: deps.batchSize ?? GRAPH_BACKFILL_BATCH_SIZE, at },
  );
  await db.transaction(async (tx) => {
    for (const state of group) {
      await advanceGraphBackfill(tx, environmentId, state.kind, {
        cursor: step.next === null ? null : { ...step.next },
        complete: step.next === null,
        at,
      });
    }
  });
  logger.info(
    {
      environmentId,
      kindCount: group.length,
      accountCount: step.accounts,
      inquiryCount: step.inquiries,
      writtenCount: step.rows,
      complete: step.next === null,
    },
    'graph backfill batch',
  );
};
