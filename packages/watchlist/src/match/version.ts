/**
 * C69.4: a report's `matcher-version` provenance: the scorer's rules (the C78.4 constants as
 * core fixes them, the alignment and the presets) joined with the keys version (C78.3), so a
 * result says which matcher and which matcher data made it. Bump {@link SCORER_VERSION} with any
 * change to how a score is computed.
 */
import { keysVersion } from '../keys/index.js';

/**
 * The version of the scorer's rules: `scorer-2` (owner decision 4 after 6B) counts an adjacent
 * transposition as one typo.
 */
export const SCORER_VERSION = 'scorer-2';

/** The `matcher-version` of a run with the filtered variant-group file of this digest. */
export function matcherVersion(variantGroupsSha256: string): string {
  return `${SCORER_VERSION};${keysVersion(variantGroupsSha256)}`;
}
