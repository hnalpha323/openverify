/**
 * C62.7: the manifest loader reads the committed `trust-anchors/manifest.json` by default and
 * refuses a missing or invalid file, naming the paths at fault and never a value.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TrustAnchorManifestError, loadTrustAnchorManifest } from './load.js';

let folder: string;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'openverify-manifest-'));
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('loadTrustAnchorManifest (C62.7)', () => {
  it('reads the committed manifest by default', async () => {
    const manifest = await loadTrustAnchorManifest();

    expect(manifest.sources.map((source) => source.id)).toEqual([
      'bsi-de',
      'npkd-nl',
      'ita',
      'che',
    ]);
  });

  it('refuses a missing file, invalid JSON and a manifest its schema refuses', async () => {
    const invalidJson = join(folder, 'invalid.json');
    const invalid = join(folder, 'manifest.json');
    await writeFile(invalidJson, '{ not json');
    await writeFile(
      invalid,
      JSON.stringify({ schema_version: 1, sources: [{ id: 'BSI DE', enabled: 'yes' }] }),
    );

    await expect(loadTrustAnchorManifest(join(folder, 'missing.json'))).rejects.toBeInstanceOf(
      TrustAnchorManifestError,
    );
    await expect(loadTrustAnchorManifest(invalidJson)).rejects.toBeInstanceOf(
      TrustAnchorManifestError,
    );
    const refused = loadTrustAnchorManifest(invalid);
    await expect(refused).rejects.toThrow(/sources\.0\.id/u);
    await expect(refused).rejects.not.toThrow(/BSI DE/u);
  });
});
