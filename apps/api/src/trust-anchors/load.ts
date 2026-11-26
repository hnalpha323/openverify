/**
 * C62.7: reads `trust-anchors/manifest.json` (the repository's, or the image's, root), validated
 * with `trustAnchorManifestSchema`; the sync and the refresh job read it.
 */
import { readFile } from 'node:fs/promises';
import { trustAnchorManifestSchema, type TrustAnchorManifest } from './manifest.js';

/** The manifest at the repository (or image) root. */
export const DEFAULT_TRUST_ANCHOR_MANIFEST = new URL(
  '../../../../trust-anchors/manifest.json',
  import.meta.url,
);

/** The manifest is missing or invalid; the message names the paths at fault, never a value. */
export class TrustAnchorManifestError extends Error {
  override name = 'TrustAnchorManifestError';
}

/**
 * The validated manifest at `path`.
 * @throws {TrustAnchorManifestError} when it cannot be read or is invalid.
 */
export async function loadTrustAnchorManifest(
  path: URL | string = DEFAULT_TRUST_ANCHOR_MANIFEST,
): Promise<TrustAnchorManifest> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new TrustAnchorManifestError('trust-anchors/manifest.json cannot be read');
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new TrustAnchorManifestError('trust-anchors/manifest.json is not JSON');
  }
  const parsed = trustAnchorManifestSchema.safeParse(json);
  if (!parsed.success) {
    const paths = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(root)')),
    ];
    throw new TrustAnchorManifestError(
      `trust-anchors/manifest.json is invalid at ${paths.join(', ')}`,
    );
  }
  return parsed.data;
}
