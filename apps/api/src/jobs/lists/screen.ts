/**
 * C99.4, C99.6 (Workflow 7B): the `list-screen` job. Owner: `api-lists`.
 *
 * For one pending outbox row, under the inquiry's lock (taken first, as transitions do) and the
 * row's: an inquiry redacted after its row was written ends the row `errored` with a code, and
 * nothing is read or moved (owner decision 5 after Workflow 6C). Otherwise it selects the lists of
 * the pinned `list-config`, builds the C99.5 probes, runs `matchLists`, and in one transaction
 * writes the matches, the count on the row (V06) and the review.
 *
 * - **The end state.** `completed` with a count; `partial` when a selected list went unscreened,
 *   the count `null` so a served value never reads as "no match" (H02); `errored` when the run kept
 *   failing, after {@link LIST_SCREEN_MAX_ATTEMPTS}.
 * - **`on-list-match: needs_review`** follows C84.3: an open match, or a screening that ended
 *   `partial` or `errored`, moves a `completed` inquiry through `transitionInquiryInTx`, recording
 *   `list_match` or `list_unscreened`. A decided inquiry is left and records
 *   `inquiry_already_decided`; a failed or expired one records the cause without a move. It never
 *   declines, and it never moves a redacted inquiry: the 6D guard leaves `completed -> needs_review`
 *   unguarded, so the redaction check under the lock is what keeps it.
 *
 * The biometric matcher runs before the transaction, because it calls vision. Nothing it logs
 * names a value; the matched value is sealed.
 */
import {
  listConfigSchema,
  newId,
  resolveListConfig,
  type ResolvedListConfig,
} from '@openverify/contracts';
import type { ListKind, ListReviewCause } from '@openverify/core';
import {
  completeListScreening,
  failListScreening,
  getEnvironment,
  getInquiry,
  getInquiryTemplateVersion,
  getListScreening,
  insertListMatches,
  listOpenListMatches,
  lockInquiry,
  lockPendingListScreening,
  recordListScreeningFailure,
  type Db,
  type Inquiry,
  type Keyring,
  type ListMatch,
  type NewListMatch,
} from '@openverify/db';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import type {
  BiometricListMatcher,
  BiometricListOutcome,
  Clock,
  ListScreenJob,
} from '../../ports.js';
import { transitionInquiryInTx } from '../../services/inquiries.js';
import { unbuiltBiometricListMatcher } from '../../services/lists/biometric/index.js';
import { matchLists, type FoundListMatch } from '../../services/lists/match.js';
import { screeningProbes } from '../../services/lists/probes.js';
import { listMatchEventPayload } from '../../services/lists/resources.js';
import {
  biometricSelection,
  selectScreenedLists,
  type ListSelection,
} from '../../services/lists/selection.js';
import type { WorkerLogger } from '../logger.js';

export interface ListScreenDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  events: TransactionalEventPublisher;
  keyring: Keyring;
  blindIndexKey?: Uint8Array | undefined;
  /** C99.7: the biometric lists' matcher; without it each such list stays unscreened. */
  biometric?: BiometricListMatcher | undefined;
}

export interface ListScreenResult {
  status: 'screened' | 'skipped';
}

export type ProcessListScreen = (
  job: ListScreenJob,
  deps: ListScreenDeps,
) => Promise<ListScreenResult>;

/** The attempts a screening gets before it ends `errored`. */
export const LIST_SCREEN_MAX_ATTEMPTS = 5;

/** C99.6: the statuses a person or the server already decided. */
const DECIDED = new Set(['approved', 'declined', 'needs_review']);

const SKIPPED: ListScreenResult = { status: 'skipped' };
const SCREENED: ListScreenResult = { status: 'screened' };

/** The pinned configuration of the inquiry. */
async function configOf(tx: Db, inquiry: Inquiry): Promise<ResolvedListConfig> {
  const version = await getInquiryTemplateVersion(
    tx,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  return resolveListConfig(listConfigSchema.parse(version?.listConfig ?? {}));
}

/**
 * C99.6: `on-list-match`, in the screening's transaction. Returns the cause to record and the
 * events to dispatch.
 */
async function applyReview(
  tx: Db,
  deps: ListScreenDeps,
  inquiry: Inquiry,
  config: ResolvedListConfig,
  cause: ListReviewCause | null,
): Promise<{ reviewCause: ListReviewCause | null; staged: StagedEvent[] }> {
  if (cause === null || config['on-list-match'] !== 'needs_review') {
    return { reviewCause: null, staged: [] };
  }
  if (DECIDED.has(inquiry.status)) {
    return { reviewCause: 'inquiry_already_decided', staged: [] };
  }
  if (inquiry.status !== 'completed') {
    return { reviewCause: cause, staged: [] };
  }
  const moved = await transitionInquiryInTx(
    tx,
    { events: deps.events, clock: deps.clock },
    inquiry,
    'needs_review',
  );
  return { reviewCause: cause, staged: moved?.staged ?? [] };
}

const recordOf = (inquiry: Inquiry, match: FoundListMatch): NewListMatch => ({
  id: newId('lmt'),
  listId: match.listId,
  listItemId: match.listItemId,
  inquiryId: inquiry.id,
  accountId: inquiry.accountId,
  source: match.source,
  method: match.method,
  tier: match.tier,
  confidence: match.confidence,
  approximate: match.approximate,
  score: match.score,
  distanceMeters: match.distanceMeters,
  listVersion: match.listVersion,
  matchedValue: match.matchedValue,
});

/** The events of the matches this run wrote. */
async function stageMatches(
  tx: Db,
  deps: ListScreenDeps,
  written: readonly ListMatch[],
  kinds: ReadonlyMap<string, ListKind>,
): Promise<StagedEvent[]> {
  const staged: StagedEvent[] = [];
  for (const match of written) {
    const kind = kinds.get(match.listId);
    if (kind !== undefined) {
      staged.push(
        await deps.events.stage(tx, {
          environmentId: match.environmentId,
          name: 'list-match.created',
          payload: listMatchEventPayload(match, kind),
        }),
      );
    }
  }
  return staged;
}

/** One screening under the inquiry's lock. */
async function screenInTx(
  tx: Db,
  { environmentId, inquiryId }: ListScreenJob,
  deps: ListScreenDeps,
  key: Uint8Array,
  biometric: BiometricListOutcome | undefined,
): Promise<{ result: ListScreenResult; staged: StagedEvent[] }> {
  const at = deps.clock.now();
  await lockInquiry(tx, environmentId, inquiryId);
  if (!(await lockPendingListScreening(tx, environmentId, inquiryId))) {
    return { result: SKIPPED, staged: [] };
  }
  const inquiry = await getInquiry(tx, environmentId, inquiryId);
  const environment = await getEnvironment(tx, environmentId);
  if (inquiry === null || environment === null || inquiry.redactedAt !== null) {
    // Owner decision 5 after Workflow 6C: redaction ends the inquiry's processing.
    await failListScreening(tx, environmentId, inquiryId, { code: 'inquiry_redacted', at });
    return { result: SKIPPED, staged: [] };
  }
  const config = await configOf(tx, inquiry);
  const selection = await selectScreenedLists(tx, environment, config.screen);
  const probes = await screeningProbes(tx, inquiry, selection.lists, environment.kind);
  const outcome = await matchLists(tx, environmentId, probes, {
    key,
    lists: selection.lists,
    biometric,
  });
  const written = await insertListMatches(
    tx,
    environmentId,
    outcome.matches.map((match) => recordOf(inquiry, match)),
  );
  const open = await listOpenListMatches(tx, environmentId, inquiryId);
  const unscreened = [...selection.unscreened, ...outcome.unscreened];
  const complete = unscreened.length === 0;
  const review = await applyReview(
    tx,
    deps,
    inquiry,
    config,
    open.length > 0 ? 'list_match' : complete ? null : 'list_unscreened',
  );
  await completeListScreening(tx, environmentId, inquiryId, {
    status: complete ? 'completed' : 'partial',
    matchCount: complete ? open.length : null,
    unscreened: [...unscreened, ...selection.leftOut],
    notApplicable: outcome.notApplicable,
    reviewCause: review.reviewCause,
    at,
  });
  const kinds = new Map(selection.lists.map((list) => [list.id, list.type]));
  return {
    result: SCREENED,
    staged: [...(await stageMatches(tx, deps, written, kinds)), ...review.staged],
  };
}

/** The biometric answer, before the transaction: it calls vision, and locks nothing. */
async function biometricOutcome(
  { environmentId, inquiryId }: ListScreenJob,
  deps: ListScreenDeps,
): Promise<BiometricListOutcome | undefined> {
  const inquiry = await getInquiry(deps.db, environmentId, inquiryId);
  const environment = await getEnvironment(deps.db, environmentId);
  if (
    (await getListScreening(deps.db, environmentId, inquiryId))?.status !== 'pending' ||
    inquiry === null ||
    environment === null ||
    inquiry.redactedAt !== null
  ) {
    return undefined;
  }
  const { screen } = await configOf(deps.db, inquiry);
  const selection: ListSelection = await selectScreenedLists(deps.db, environment, screen);
  const lists = biometricSelection(selection.lists);
  return lists.length === 0
    ? undefined
    : (deps.biometric ?? unbuiltBiometricListMatcher).match({ environmentId, inquiryId, lists });
}

/** C99.4: a run out of attempts ends `errored`, and `on-list-match` reads it as unscreened. */
async function endErrored(
  { environmentId, inquiryId }: ListScreenJob,
  deps: ListScreenDeps,
): Promise<StagedEvent[]> {
  return deps.db.transaction(async (tx) => {
    await lockInquiry(tx, environmentId, inquiryId);
    if (!(await lockPendingListScreening(tx, environmentId, inquiryId))) {
      return [];
    }
    const inquiry = await getInquiry(tx, environmentId, inquiryId);
    const at = deps.clock.now();
    if (inquiry?.redactedAt !== null) {
      await failListScreening(tx, environmentId, inquiryId, { code: 'inquiry_redacted', at });
      return [];
    }
    const config = await configOf(tx, inquiry);
    const review = await applyReview(tx, deps, inquiry, config, 'list_unscreened');
    await failListScreening(tx, environmentId, inquiryId, {
      code: 'screening_failed',
      at,
      reviewCause: review.reviewCause,
    });
    return review.staged;
  });
}

/**
 * C99.4, C99.6: screens one inquiry. A failed attempt is counted and the job fails, to be retried;
 * the last attempt ends the row `errored`.
 */
export const processListScreen: ProcessListScreen = async (job, deps) => {
  const { db, events } = deps;
  const { environmentId, inquiryId } = job;
  let outcome: { result: ListScreenResult; staged: StagedEvent[] };
  try {
    const key = deps.blindIndexKey;
    if (key === undefined) {
      throw new Error('the worker has no blind index key for the list screening');
    }
    const biometric = await biometricOutcome(job, deps);
    outcome = await db.transaction((tx) => screenInTx(tx, job, deps, key, biometric));
  } catch (error) {
    const attempts = await recordListScreeningFailure(
      db,
      environmentId,
      inquiryId,
      'screening_failed',
    );
    if (attempts === null || attempts < LIST_SCREEN_MAX_ATTEMPTS) {
      throw error;
    }
    deps.logger.error({ inquiryId, attempts }, 'list screening ended errored');
    await events.dispatch(await endErrored(job, deps));
    return SCREENED;
  }
  await events.dispatch(outcome.staged);
  return outcome.result;
};
