/**
 * Owner decisions 2 after 6B and 6 after 6C (C78.7): the table of the 100,000-name screening gate
 * (`watchlists.integration.test.ts`) is the calibration's, by construction. It is
 * `@openverify/watchlist/testing`'s `heavyHeadedTable`, the one definition the performance benchmark
 * draws too, of the gate's fixed seed: the raw rigour groups of `data/` (`python3
 * scripts/fetch_data.py`; read by that module's own parser, never by the held-out generator) plus
 * 40,000 fictional names, by Zipf's law with exponent 1, the sanctions profile, 100,000 names, 150
 * listed and 150 unlisted subjects.
 *
 * **The seed** is the evaluation seed `docs/calibration/watchlist-phase6c.md` published, so the gate
 * screens the very table and subjects that report measured at 100,000 names, and its figures that
 * do not depend on the machine reproduce the report's (candidates p50/p95 99/630, the cap binding in
 * none of 300 searches, one out of reach, 150 of 150 listed found, 27 of 150 unlisted alerted).
 * `benchmark:performance --seed <GATE_SEED> --step 100k-import` draws the same entries into the
 * benchmark's sandbox source. The gate's limits on the cap were set on this draw: on a fresh seed
 * of the same law (`abde9930…`) the cap bound in 11 of 300 searches (candidates p95 1,229), so a
 * fresh calibration seed may bind it more often, and its report says how often.
 *
 * Without the raw file the pool holds the fictional names alone, and {@link gateCase} says so.
 * Generated at run time and never committed; nothing here prints a name.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WatchlistRecord } from '@openverify/watchlist';
import {
  heavyHeadedTable,
  parseRigourPersonNames,
  RIGOUR_PERSON_NAMES_ENTRY,
  type TableSubject,
} from '@openverify/watchlist/testing';
import type { MatcherData } from '../matcher-data.js';

/**
 * The gate's fixed seed: the evaluation seed of `docs/calibration/watchlist-phase6c.md` (drawn with
 * `openssl rand -hex 16` at 2026-10-29T02:04:51Z, after that report's method commit `e0c7cebe`). Its
 * 100,000-name table is a performance table, which holds no held-out case.
 */
export const GATE_SEED = 'e8223c34916200e2b8e51f0b47981804';

/** The repository's `data/`, five levels above this module. */
const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../data');

/**
 * The raw rigour file that `dataDirectory`'s `manifest.json` names, or `null` when the manifest
 * names none or the file is absent.
 */
export function rigourPersonNamesPath(dataDirectory: string = DATA): string | null {
  const manifest = JSON.parse(readFileSync(join(dataDirectory, 'manifest.json'), 'utf8')) as {
    readonly data?: readonly { readonly name: string; readonly filename: string }[];
  };
  const entry = manifest.data?.find((item) => item.name === RIGOUR_PERSON_NAMES_ENTRY);
  const path = entry === undefined ? null : join(dataDirectory, entry.filename);
  return path !== null && existsSync(path) ? path : null;
}

/** The gate's table: the shared 100,000-name table of `seed`, over the raw groups of `rawText`. */
export function gateTable(options: { readonly seed: string; readonly rawText: string | null }): {
  readonly records: readonly WatchlistRecord[];
  readonly subjects: readonly TableSubject[];
} {
  const groups = options.rawText === null ? [] : parseRigourPersonNames(options.rawText);
  const { records, subjects } = heavyHeadedTable({ seed: options.seed, groups });
  return { records, subjects };
}

/**
 * The case the gate ran, by the data files it found: `shipped-variant-groups` (the calibration's
 * case) when the shipped variant groups loaded and the raw groups are there, else each one missing.
 */
export function gateCase(options: {
  readonly variantGroups: MatcherData['status'];
  readonly rawGroups: boolean;
}): string {
  const missing = [
    ...(options.variantGroups === 'loaded'
      ? []
      : [`no-variant-groups (data/variant-groups.json ${options.variantGroups})`]),
    ...(options.rawGroups
      ? []
      : [`no-raw-groups (data/ has no ${RIGOUR_PERSON_NAMES_ENTRY} file)`]),
  ];
  return missing.length === 0 ? 'shipped-variant-groups' : missing.join(', ');
}
