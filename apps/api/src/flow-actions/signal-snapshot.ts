/**
 * C150.9 (Workflow 9A; V09): when a branch that reads `signals.<name>` is entered, the engine asks
 * for a provisional snapshot of the `flow-provisional` signals its `waitFor` names; the
 * `flow-signal-snapshot` job (`jobs/flow/signal-snapshot.ts`) computes them from the session facts
 * stored so far and advances the branch once every named signal is written. Plumbing by
 * `foundation-9a` (Stage 1b (S)); owner `api-flow-actions`.
 *
 * Call it after the transaction that entered the branch commits: the job reads that entry.
 */
import type { FlowSignalSnapshotJob, FlowSignalSnapshotQueue } from '../ports.js';

/** Enqueues the branch entry's snapshot (one job per entry). */
export function requestSignalSnapshot(
  queue: FlowSignalSnapshotQueue,
  job: FlowSignalSnapshotJob,
): Promise<void> {
  return queue.enqueueFlowSignalSnapshot(job);
}
