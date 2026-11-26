/**
 * C243.1 (Phase 11, Workflow 11A): the registry entries of Connect's three actions
 * (`RESERVED_CONNECT_ACTION_KEYS`), from the frozen configs and outputs (`CONNECT_ACTION_CONTRACTS`)
 * and the scope and events of each (`CONNECT_ACTION_ROWS`), passed to the API's registry beside the
 * case steps' (the 8B precedent, F33). Owner `workflow-connect`.
 *
 * Each is internal and exactly once: its handler calls the share token service in the step's own
 * transaction, which also holds the effect row (C117.5), so a step's effect key makes it idempotent.
 * None is retried by default (no budget meets them; a step's own `retry` still may), none is adverse
 * or biometric (a share token decides nothing about a person), none is irreversible (a created token
 * can be expired, a redemption's copy is the destination's to redact), and none checks its causing
 * principal (ours: as for the case steps, which are not adverse; the run's frozen grant bounds it,
 * and an `inbound-created` event in the destination is caused by the other organisation, whose
 * principal the destination never sees, C240.4). Activating a connection and creating or
 * withdrawing a consent record are not actions (C243.3).
 */
import {
  CONNECT_ACTION_CONTRACTS,
  CONNECT_ACTION_ROWS,
  RESERVED_CONNECT_ACTION_KEYS,
  type ActionRegistryEntry,
  type AnyActionRegistryEntry,
} from '@openverify/workflow-engine/actions';

export function createConnectActionEntries(): readonly AnyActionRegistryEntry[] {
  return Object.freeze(
    RESERVED_CONNECT_ACTION_KEYS.map((key): AnyActionRegistryEntry => {
      const contract = CONNECT_ACTION_CONTRACTS[key];
      const row = CONNECT_ACTION_ROWS[key];
      const entry: ActionRegistryEntry = {
        key,
        version: 1,
        kind: 'internal',
        config: contract.config,
        output: contract.output,
        grant: () => ({ scopes: [row.scope], pii: false }),
        grantDependsOnConfig: false,
        emits: row.emits,
        delivery: 'exactly-once',
        retry: { allowed: false, defaultIntervalsSeconds: [] },
        availability: 'none',
        triggers: null,
        requires: [],
        adverse: 'never',
        adverseRule: null,
        biometric: false,
        irreversible: false,
        causeChecked: false,
        stage: 'ga',
      };
      return entry as unknown as AnyActionRegistryEntry;
    }),
  );
}
