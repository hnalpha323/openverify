/**
 * `@openverify/signals/network` (plan C92.3, C93): the parsers of each publisher's format into the
 * normalised snapshot, the interval sets over `node:net` and our own 16-byte keys (no address
 * library), MMDB access over `mmdb-lib` 3.0.3, and the pure lookups of C93.3 and C93.4. Owner:
 * `network-data` (Workflow 7A Stage 2).
 */
export const SIGNALS_NETWORK_AREA = 'network';

export * from './address.js';
export * from './address-class.js';
export * from './canonical.js';
export * from './errors.js';
export * from './interval-set.js';
export {
  NETWORK_EVIDENCE_REASONS,
  NETWORK_FACT_FIELDS,
  NETWORK_NULL_REASONS,
  NETWORK_SOURCE_ROLES,
  evaluateNetwork,
  networkLookupRules,
  sessionNetworkFacts,
  type IpReputationAnswer,
  type NetworkEvaluation,
  type NetworkEvidenceReason,
  type NetworkFact,
  type NetworkFactField,
  type NetworkLookupInput,
  type NetworkLookupRules,
  type NetworkNullReason,
  type NetworkSourceRef,
  type NetworkSourceRole,
  type NetworkSourceSnapshot,
  type ThreatInputs,
} from './lookup.js';
export * from './asn-seeds.js';
export * from './range-files.js';
export * from './tor-exit-list.js';
export * from './mmdb.js';
export * from './sandbox.js';
export * from './snapshot.js';
