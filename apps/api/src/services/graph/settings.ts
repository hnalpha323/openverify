/**
 * C101.2, C101.3, C101.5 (Workflow 7B; P26, decision 50): what an environment's settings say the
 * graph writes. `graph-indexing` (default on) writes anything at all; `graph-weak-kinds` (default
 * off) the weak kinds; the device kinds come only from sessions under the device-recognition tier
 * (a device row exists only then), and `signal-collection`'s `device-recognition` says whether new
 * ones can come at all, which `kinds-not-indexed` reports.
 */
import { GRAPH_KINDS, GRAPH_KIND_REGISTRY, graphKindCode, type GraphKind } from '@openverify/core';
import type { EnvironmentSettings, GraphIndexStateRow } from '@openverify/db';

export interface GraphSettings {
  indexing: boolean;
  weakKinds: boolean;
  deviceRecognition: boolean;
  components: boolean;
  sandbox: boolean;
}

/** The graph's switches, with their defaults (decision 50). */
export function graphSettingsOf(environment: {
  kind: 'sandbox' | 'production';
  settings: EnvironmentSettings | null | undefined;
}): GraphSettings {
  const settings = environment.settings ?? {};
  return {
    indexing: settings['graph-indexing'] ?? true,
    weakKinds: settings['graph-weak-kinds'] ?? false,
    deviceRecognition: (settings['signal-collection']?.['device-recognition'] ?? 'off') !== 'off',
    components: settings['graph-components'] ?? false,
    sandbox: environment.kind === 'sandbox',
  };
}

/** Whether a row of `kind` may be written now (a device kind also needs its session's tier). */
export function writesGraphKind(settings: GraphSettings, kind: GraphKind): boolean {
  const definition = GRAPH_KIND_REGISTRY[kind];
  return settings.indexing && (definition.strength !== 'weak' || settings.weakKinds);
}

/**
 * H10: the kinds of `kinds` the index lacks: not written now (a setting is off, or no session can be
 * under the device-recognition tier), or not complete since a switch started writing them.
 */
export function kindsNotIndexed(
  settings: GraphSettings,
  states: readonly GraphIndexStateRow[],
  kinds: readonly GraphKind[],
): GraphKind[] {
  const incomplete = new Set(states.filter((state) => !state.complete).map(({ kind }) => kind));
  return GRAPH_KINDS.filter(
    (kind) =>
      kinds.includes(kind) &&
      (!writesGraphKind(settings, kind) ||
        (GRAPH_KIND_REGISTRY[kind].needsDeviceRecognition && !settings.deviceRecognition) ||
        incomplete.has(graphKindCode(kind))),
  );
}
