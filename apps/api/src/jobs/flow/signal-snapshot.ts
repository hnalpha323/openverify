/**
 * C150.9 (Workflow 9A; V06, V09): the `flow-signal-snapshot` job. Owner: `api-flow-actions`; the
 * signature and the worker's registration (with the deps the `inquiry-signals` processor receives)
 * were placed by `foundation-9a` (Stage 1b (S)).
 *
 * For one branch entry: compute the named `flow-provisional` signals from the session facts stored
 * so far through Phase 7's own computation (`inquirySignalsInputInTx` of `jobs/signals/input.ts`,
 * then `computeInquirySignals`), record a client-collected signal whose session has sent no payload
 * yet as `not_yet_collected`, write `inquiry_flow_signal_snapshots`, and, once every named signal is
 * written, call `advanceFlowInTx` under the inquiry's row lock. A redacted inquiry is never moved.
 *
 * Only signals the registry marks `flow-provisional` are computed (publish refuses the others,
 * `scope_path_unavailable_in_flow`); a name that is not one is never written, so the wait ends at its
 * deadline and the route's `onNull` decides. The entry must still be the inquiry's waiting branch
 * entry under the lock: a snapshot arriving after the wait ended writes nothing, so it can never
 * change a path already taken. Each name is written once (a repeat keeps the first). The values,
 * tiers and stages are the computation's and the registry's; a value is a count, a level, a score
 * or a flag (PII-free, C150.9), never logged. The inquiry's own `signals` attribute is untouched:
 * completion's `inquiry-signals` job and its outbox row still compute it (C90.5).
 */
import { computeInquirySignals } from '@openverify/checks';
import { getSignalDefinition, type SignalName } from '@openverify/core';
import {
  getEnvironment,
  getInquiry,
  getWaitingBranchEntry,
  insertInquiryFlowSignalSnapshotsInTx,
  listInquiryFlowSignalSnapshots,
  lockInquiry,
  type NewInquiryFlowSignalSnapshot,
} from '@openverify/db';
import {
  advanceFlowInTx,
  runFlowAfterCommit,
  type FlowAdvance,
} from '../../flow-engine/advance.js';
import type { FlowSignalSnapshotJob } from '../../ports.js';
import { inquirySignalsInputInTx } from '../signals/input.js';
import { deviceIntegrityContext, type InquirySignalsDeps } from '../signals/process.js';

/** What the job reads: the deps the `inquiry-signals` processor receives. */
export type FlowSignalSnapshotDeps = InquirySignalsDeps;

/** What one job did. */
export interface FlowSignalSnapshotResult {
  outcome: 'written' | 'skipped';
  /** The snapshots written by this job. */
  written: number;
}

/** The `reason` the stub failed with; kept for the record of Workflow 9A Stage 1b (S). */
export const FLOW_SIGNAL_SNAPSHOT_NOT_BUILT = 'flow_signal_snapshot_not_built';

/** V06: Phase 7's reason for a collecting session that has sent no payload yet. */
const NO_PAYLOAD_YET = 'collector_missing';
/** V06: the flow-only reason in its place, in the `ignore` class of `ON_NULL_DEFAULTS`. */
export const NOT_YET_COLLECTED = 'not_yet_collected';

export type ProcessFlowSignalSnapshot = (
  job: FlowSignalSnapshotJob,
  deps: FlowSignalSnapshotDeps,
) => Promise<FlowSignalSnapshotResult>;

const SKIPPED: FlowSignalSnapshotResult = { outcome: 'skipped', written: 0 };

/** The named signals this job may compute: flow-provisional entries of the registry, each once. */
const provisionalOf = (names: readonly string[]): SignalName[] =>
  [...new Set(names)].filter(
    (name): name is SignalName => getSignalDefinition(name)?.flowProvisional === true,
  );

/** C150.9: snapshots the branch entry's named signals and advances it once all are written. */
export const processFlowSignalSnapshot: ProcessFlowSignalSnapshot = async (job, deps) => {
  const { db, clock, events } = deps;
  const { environmentId, inquiryId, stepRecordSeq } = job;
  const ref = { environmentId, inquiryId };
  const done = await db.transaction(async (tx) => {
    await lockInquiry(tx, environmentId, inquiryId);
    const inquiry = await getInquiry(tx, environmentId, inquiryId);
    const environment = await getEnvironment(tx, environmentId);
    const waiting = await getWaitingBranchEntry(tx, environmentId, { inquiryId, stepRecordSeq });
    if (inquiry?.redactedAt !== null || environment === null || waiting === null) {
      return null;
    }
    const names = provisionalOf(job.names);
    const computedAt = clock.now();
    const computed = computeInquirySignals(
      await inquirySignalsInputInTx(tx, inquiry, names, {
        environment: environment.kind,
        computedAt,
        ...deviceIntegrityContext(deps.providers, environment.kind),
      }),
    );
    // Every computed value has its detail; one without is not written (fail closed: the wait ends).
    const snapshots = computed.signals.flatMap(
      ({ name, value }): NewInquiryFlowSignalSnapshot[] => {
        const detail = computed.details[name];
        if (detail === undefined) {
          return [];
        }
        const clientCollected = getSignalDefinition(name)?.collectionTier !== 'server';
        const reason = detail['null-reason'];
        const nullReason =
          value !== null
            ? null
            : clientCollected && reason === NO_PAYLOAD_YET
              ? NOT_YET_COLLECTED
              : (reason ?? 'input_missing');
        return [{ name, value, tier: detail.tier, stage: detail.stage, nullReason, computedAt }];
      },
    );
    const key = { inquiryId, stepRecordSeq };
    const written = await insertInquiryFlowSignalSnapshotsInTx(tx, environmentId, key, snapshots);
    const stored = new Set(
      (await listInquiryFlowSignalSnapshots(tx, environmentId, key)).map(({ name }) => name),
    );
    const complete = job.names.length > 0 && job.names.every((name) => stored.has(name));
    const advance: FlowAdvance | null = complete
      ? await advanceFlowInTx(tx, deps, ref, { kind: 'signal-snapshot-written', stepRecordSeq })
      : null;
    return { written: written.length, advance };
  });
  if (done === null) {
    return SKIPPED;
  }
  await events.dispatch(done.advance?.staged ?? []);
  await runFlowAfterCommit(done.advance);
  return { outcome: 'written', written: done.written };
};
