/**
 * C78.3 (F14, V04): the matcher data every sync, re-key and re-screen needs: the filtered
 * variant-group file (`data/variant-groups.json` at the repository or image root, built from the
 * pinned rigour file by `packages/watchlist/scripts/build-variant-groups.mjs`) and the keys
 * version it gives. A missing file or another digest is reported, never worked around: a sync
 * then refuses with `refused_matcher_data`. Owner: `api-watchlists` (Workflow 6A Stage 3).
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VARIANT_GROUPS_FILE_NAME,
  keysVersion,
  loadVariantGroups,
  type VariantGroups,
} from '@openverify/watchlist';

/** What the matcher data is: loaded with its keys version, missing, or not the shipped file. */
export type MatcherData =
  | { readonly status: 'loaded'; readonly groups: VariantGroups; readonly keysVersion: string }
  | { readonly status: 'missing' }
  | { readonly status: 'unexpected' };

/** `data/variant-groups.json`, four levels above this module from `src/` or `dist/`. */
export function defaultVariantGroupsPath(): string {
  return join(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'),
    'data',
    VARIANT_GROUPS_FILE_NAME,
  );
}

const loaded = new Map<string, MatcherData>();

/**
 * The matcher data at `path`, read once per process when it loads (a missing or unexpected file
 * is read again on the next call, so a file fetched later is seen). `expectedSha256` is the
 * shipped digest unless a test names another.
 */
export function loadMatcherData(
  path: string = defaultVariantGroupsPath(),
  expectedSha256?: string,
): MatcherData {
  const key = `${path}\u0000${expectedSha256 ?? ''}`;
  const cached = loaded.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const result =
    expectedSha256 === undefined
      ? loadVariantGroups(path)
      : loadVariantGroups(path, expectedSha256);
  if (result.status !== 'loaded') {
    return { status: result.status };
  }
  const data: MatcherData = {
    status: 'loaded',
    groups: result.groups,
    keysVersion: keysVersion(result.groups.sha256),
  };
  loaded.set(key, data);
  return data;
}
