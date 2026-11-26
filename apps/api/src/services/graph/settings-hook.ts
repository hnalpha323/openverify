/**
 * C101.5 (Workflow 7B; H10, V11, F16): the graph's hook `updateDashboardSettings` calls in its
 * transaction after writing the environment's settings, with the settings before and after. A
 * switch that starts writing kinds marks them incomplete (`markGraphKindsIncomplete`), so results
 * say `index-complete: false` until the `graph-backfill` job reaches them:
 *
 * - `graph-indexing` turned back on: every kind;
 * - `graph-weak-kinds` turned on: the weak kinds;
 * - `signal-collection`'s `device-recognition` leaving `off`: the device kinds.
 *
 * A hook that throws rolls the settings change back. Owner: `api-graph`; `foundation-7b` (Stage 1b
 * (G)) froze the signature.
 */
import { GRAPH_KINDS, GRAPH_KIND_REGISTRY, graphKindCode, type GraphKind } from '@openverify/core';
import { markGraphKindsIncomplete, type Db, type EnvironmentSettings } from '@openverify/db';
import { graphSettingsOf } from './settings.js';

export type OnGraphSettingsChangedInTx = (
  tx: Db,
  environmentId: string,
  before: EnvironmentSettings,
  after: EnvironmentSettings,
) => Promise<void>;

const codes = (kinds: readonly GraphKind[]) => kinds.map(graphKindCode);

export const onGraphSettingsChangedInTx: OnGraphSettingsChangedInTx = async (
  tx,
  environmentId,
  before,
  after,
) => {
  const was = graphSettingsOf({ kind: 'sandbox', settings: before });
  const now = graphSettingsOf({ kind: 'sandbox', settings: after });
  const kinds = new Set<number>();
  if (!was.indexing && now.indexing) {
    codes(GRAPH_KINDS).forEach((code) => kinds.add(code));
  }
  if (!was.weakKinds && now.weakKinds) {
    codes(GRAPH_KINDS.filter((kind) => GRAPH_KIND_REGISTRY[kind].strength === 'weak')).forEach(
      (code) => kinds.add(code),
    );
  }
  if (!was.deviceRecognition && now.deviceRecognition) {
    codes(GRAPH_KINDS.filter((kind) => GRAPH_KIND_REGISTRY[kind].needsDeviceRecognition)).forEach(
      (code) => kinds.add(code),
    );
  }
  await markGraphKindsIncomplete(
    tx,
    environmentId,
    [...kinds].sort((a, b) => a - b),
    new Date(),
  );
};
