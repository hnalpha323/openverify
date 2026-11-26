/**
 * Workflow 11E, Stage 3 (`integration-11e`): C282's record test over the corrected records, and
 * `pnpm release:check` with C274.6's staleness folded in.
 */
export { CORRECTED_RECORDS, checkCorrectedRecords } from './records.js';
export { staleAwareReleaseCheck } from './release-staleness.js';
