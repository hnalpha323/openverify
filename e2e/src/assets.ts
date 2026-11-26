/**
 * The downloaded and generated inputs of the e2e stack (C33, C36, C56): model weights from
 * `models/manifest.json`, data files from `data/manifest.json` and the synthetic fixtures `services/vision/tools/make_synthetic_fixtures.py`
 * writes into `fixtures/generated/`.
 */
import { readFile } from 'node:fs/promises';

/**
 * `scripts/fetch_models.py` with no `--only`: every model in the manifest, so a model a later
 * stage adds (OCR, for example) reaches the run. The script skips files whose digest matches.
 */
export const FETCH_MODELS_ARGS: readonly string[] = Object.freeze(['scripts/fetch_models.py']);

/**
 * `scripts/fetch_data.py` with no `--only`: every file in `data/manifest.json` (Phase 5, C56: the
 * disposable email list the worker reads, and the matching tables' build inputs), as the CI e2e
 * job fetches them. The script skips files whose digest matches.
 */
export const FETCH_DATA_ARGS: readonly string[] = Object.freeze(['scripts/fetch_data.py']);

/**
 * C78.3 (F14): `pnpm` arguments that build the filtered variant-group file the worker and
 * `seed:dev` load (`data/variant-groups.json`) from the rigour file `scripts/fetch_data.py`
 * fetched. Without it the seed skips the sandbox lists and person-name reports error
 * `matcher_data_unavailable`.
 */
export const BUILD_VARIANT_GROUPS_ARGS: readonly string[] = Object.freeze([
  '--filter',
  '@openverify/watchlist',
  'build:variant-groups',
]);

/** `uv` arguments (in `services/vision`) that print the generator's `GENERATOR_VERSION`. */
export const GENERATOR_VERSION_ARGS: readonly string[] = Object.freeze([
  'run',
  'python',
  'tools/make_synthetic_fixtures.py',
  '--print-version',
]);

/**
 * Whether `fixtures/generated/` must be generated again: a file is missing, or the stamp the
 * generator writes after a complete run is absent or from another generator version.
 */
export function needsRegeneration(state: {
  missing: readonly string[];
  stamp: string | null;
  version: string;
}): boolean {
  return state.missing.length > 0 || state.stamp !== state.version.trim();
}

/** The version a generator run stamped, or `null` when there is no stamp. */
export async function readStamp(file: string): Promise<string | null> {
  try {
    return (await readFile(file, 'utf8')).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
