/**
 * The Phase 1 selfie checks (contract C7) became version 2 in Phase 4 (C39.1, C43): their
 * evaluators live in `../selfie/` (`selfieImageQualityDetection`, `selfieMultipleFacesDetection`,
 * `selfieIdComparison`), with the twelve checks first implemented there. The face match
 * confidence they share is re-exported here for the callers that import it from this module.
 */
export { faceMatchConfidence } from '../face-match.js';
