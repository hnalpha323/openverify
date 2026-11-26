/**
 * C78.3: list and query keys, normalised identifiers and keysVersion() (V04).
 * Owned by `watchlist-matcher` (Workflow 6A Stage 2).
 */
import { CRYPTO_NORMALISER_VERSION } from '../crypto/index.js';
import { IDENTIFIER_NORMALISER_VERSION } from './identifiers.js';

/** The area this folder holds. */
export const WATCHLIST_KEYS_AREA = 'keys';

export * from './variant-groups.js';
export * from './name-keys.js';
export * from './identifiers.js';

/**
 * The version of the name rules every stored key depends on: the folds, the tokeniser, the
 * transliterations, the key kinds and the skeleton. Bump it with any change to their output; the
 * golden test of `keys-golden.test.ts` fails until then. `names-2` (owner decision 1 after 6B)
 * adds the token-pair keys and counts key frequencies over entries; stored keys of `names-1` error
 * `matcher_data_unavailable` until `watchlists:rekey`.
 */
export const KEYS_VERSION = 'names-2';

/**
 * C78.3 (V04): the version of every derived column (name keys and normalised names, key
 * frequencies, normalised identifiers, canonical crypto addresses): {@link KEYS_VERSION} joined with
 * the identifier and crypto normaliser versions and the filtered variant-group file's SHA-256. A
 * sync records it per source; a run whose source carries another one errors
 * `matcher_data_unavailable`.
 * @throws {Error} for a digest that is not 64 lower-case hex digits.
 */
export function keysVersion(variantGroupsSha256: string): string {
  if (!/^[0-9a-f]{64}$/u.test(variantGroupsSha256)) {
    throw new Error('keysVersion needs the SHA-256 of the filtered variant-group file');
  }
  return [
    KEYS_VERSION,
    IDENTIFIER_NORMALISER_VERSION,
    CRYPTO_NORMALISER_VERSION,
    `groups-${variantGroupsSha256}`,
  ].join(';');
}
