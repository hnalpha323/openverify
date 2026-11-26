/**
 * C90.4, C90.5, C90.7 (Workflow 7A): the `inquiry-signals` job. Owner: `api-signals`; the
 * signature is frozen by `foundation-7a` (Stage 1b (S)).
 *
 * For one pending outbox row: skip an inquiry redacted after its row was written (owner decision
 * 5 after Workflow 6C); read the stored session facts, the network rows and the sealed signal
 * bodies; compute every collected signal at its tier with `signal-logic`'s functions; freeze
 * `signals` and `signal-details` (`completeSignalComputation`); then apply the `on-signal` rule,
 * moving a `completed` inquiry to `needs_review` through `transitionInquiryInTx`, never a decided
 * or redacted one, and never declining.
 */
import { computeInquirySignals, matchSignalReviewRules } from '@openverify/checks';
import {
  resolveSignalConfig,
  signalAttributeIssues,
  signalConfigSchema,
  signalDetailsSchema,
} from '@openverify/contracts';
import {
  completeSignalComputation,
  getEnvironment,
  getInquiry,
  getInquiryTemplateVersion,
  lockInquiry,
  lockPendingSignalComputation,
  recordSignalComputationFailure,
  skipSignalComputation,
  type Db,
  type Keyring,
} from '@openverify/db';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import type {
  Clock,
  DeviceIntegrityProvider,
  EnvironmentKind,
  InquirySignalsJob,
  NetworkSnapshots,
  ProviderBindings,
} from '../../ports.js';
import { transitionInquiryInTx } from '../../services/inquiries.js';
import type { WorkerLogger } from '../logger.js';
import { inquirySignalsInputInTx } from './input.js';

/** What the job reads. */
export interface InquirySignalsDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  events: TransactionalEventPublisher;
  /** Opens the sealed signal bodies. */
  keyring: Keyring;
  /** C94.4: recomputes nothing here, but checks device HMACs' key id against the current one. */
  blindIndexKey?: Uint8Array | undefined;
  /** C92.3: the network data's provenance and freshness at computation time. */
  networkSnapshots?: NetworkSnapshots | undefined;
  /**
   * C211.5 (Workflow 10B): the providers bound per environment kind; the kind's `deviceIntegrity`
   * provider gives the Play Integrity facts. Left out (a test's deps), the two signals read
   * `collector_missing`.
   */
  providers?: ProviderBindings | undefined;
}

/** Counts and the outcome only, never a value. */
export interface InquirySignalsResult {
  outcome: 'computed' | 'skipped' | 'not_pending';
  signals: number;
  /** Whether the `on-signal` rule moved the inquiry to `needs_review`. */
  markedForReview: boolean;
}

export type ProcessInquirySignals = (
  job: InquirySignalsJob,
  deps: InquirySignalsDeps,
) => Promise<InquirySignalsResult>;

/** The statuses a person or the server already decided: `on-signal` leaves them (C90.7). */
const DECIDED = new Set(['approved', 'declined', 'needs_review']);

/**
 * The computed values or details broke the contract's schema or refinements: nothing is frozen,
 * the attempt is recorded as `schema_refused` and the job fails (to be retried and seen).
 */
export class SignalsRefusedError extends Error {
  override name = 'SignalsRefusedError';
}

const NOT_PENDING: InquirySignalsResult = {
  outcome: 'not_pending',
  signals: 0,
  markedForReview: false,
};
const SKIPPED: InquirySignalsResult = { outcome: 'skipped', signals: 0, markedForReview: false };

/**
 * C90.4, C90.5, C90.7: computes, freezes and reviews one inquiry's signals, in one transaction
 * under the inquiry's lock (taken first, as transitions do) and the outbox row's. An inquiry
 * redacted after its row was written is skipped and never moved; a row no longer pending is left.
 * @throws {SignalsRefusedError} when the result breaks the contract (recorded, nothing frozen).
 */
export const processInquirySignals: ProcessInquirySignals = async (job, deps) => {
  const { db, events } = deps;
  const { environmentId, inquiryId } = job;
  let outcome: { result: InquirySignalsResult; staged: StagedEvent[] };
  try {
    outcome = await db.transaction((tx) => computeInTx(tx, job, deps));
  } catch (error) {
    await recordSignalComputationFailure(
      db,
      environmentId,
      inquiryId,
      error instanceof SignalsRefusedError ? 'schema_refused' : 'computation_failed',
    );
    throw error;
  }
  await events.dispatch(outcome.staged);
  return outcome.result;
};

async function computeInTx(
  tx: Db,
  { environmentId, inquiryId }: InquirySignalsJob,
  deps: InquirySignalsDeps,
): Promise<{ result: InquirySignalsResult; staged: StagedEvent[] }> {
  const at = deps.clock.now();
  await lockInquiry(tx, environmentId, inquiryId);
  if ((await lockPendingSignalComputation(tx, environmentId, inquiryId)) === null) {
    return { result: NOT_PENDING, staged: [] };
  }
  const inquiry = await getInquiry(tx, environmentId, inquiryId);
  const environment = await getEnvironment(tx, environmentId);
  if (inquiry === null || environment === null || inquiry.redactedAt !== null) {
    // Owner decision 5 after Workflow 6C: redaction ends the inquiry's processing.
    await skipSignalComputation(tx, environmentId, inquiryId, at);
    return { result: SKIPPED, staged: [] };
  }
  const version = await getInquiryTemplateVersion(
    tx,
    environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const config = resolveSignalConfig(signalConfigSchema.parse(version?.signalConfig ?? {}));
  // C150.9 (Workflow 9A Stage 1b (S)): the input is assembled by `inquirySignalsInputInTx`, which the
  // flow's provisional snapshots (`flow-signal-snapshot`) call too, so both compute from one reading.
  const computed = computeInquirySignals(
    await inquirySignalsInputInTx(tx, inquiry, config.collect, {
      environment: environment.kind,
      computedAt: at,
      ...deviceIntegrityContext(deps.providers, environment.kind),
    }),
  );

  // C90.7: on-signal, off by default; it never declines and leaves a decided inquiry as it is.
  const match =
    config['on-signal'] === 'needs_review'
      ? matchSignalReviewRules(config['review-rules'], computed)
      : { rules: [], cause: null };
  const review =
    match.cause === null
      ? null
      : {
          cause: DECIDED.has(inquiry.status) ? ('inquiry_already_decided' as const) : match.cause,
          rules: match.rules,
        };
  const signalDetails = { ...computed.details, ...(review === null ? {} : { review }) };
  const checked = signalDetailsSchema.safeParse(signalDetails);
  if (!checked.success || signalAttributeIssues(computed.signals, checked.data).length > 0) {
    throw new SignalsRefusedError('The computed signals break the signal-details contract.');
  }
  const staged: StagedEvent[] = [];
  let markedForReview = false;
  if (
    review !== null &&
    review.cause !== 'inquiry_already_decided' &&
    inquiry.status === 'completed'
  ) {
    const moved = await transitionInquiryInTx(
      tx,
      { events: deps.events, clock: deps.clock },
      inquiry,
      'needs_review',
    );
    if (moved !== null) {
      staged.push(...moved.staged);
      markedForReview = true;
    }
  }
  await completeSignalComputation(tx, environmentId, inquiryId, {
    signals: computed.signals.map(({ name, value }) => ({ name, value })),
    signalDetails,
    at,
  });
  return {
    result: { outcome: 'computed', signals: computed.signals.length, markedForReview },
    staged,
  };
}

/**
 * C211.5 (Workflow 10B): the environment kind's bound `deviceIntegrity` provider for the shared input
 * (`null`: none bound), or nothing when the deps carry no bindings.
 */
export function deviceIntegrityContext(
  providers: ProviderBindings | undefined,
  kind: EnvironmentKind,
): { deviceIntegrity?: DeviceIntegrityProvider | null } {
  return providers === undefined
    ? {}
    : { deviceIntegrity: providers[kind].deviceIntegrity ?? null };
}
