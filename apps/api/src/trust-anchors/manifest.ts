/**
 * C62.7: the schema of `trust-anchors/manifest.json`, the committed, reviewable list of CSCA
 * master-list sources the operator's `trust-anchors:sync` fetches. Each source pins its
 * publisher's root CSCA certificate by URL and SHA-256 (recorded from the publisher's page and
 * cross-checked with its published fingerprint), never a list file, which goes stale within
 * weeks; and names the master-list eContentType and signer EKU it verifies. Nothing the sync
 * fetches is committed.
 *
 * Workflow 5B Stage 1 (`contracts-5b`) wrote this schema; `api-nfc` owns this folder, writes the
 * manifest and builds the sync on it.
 */
import { safeUrl } from '@openverify/contracts';
import { z } from 'zod';

/** `id-icao-cscaMasterList` (Doc 9303-12 §9). */
export const MASTER_LIST_CONTENT_TYPE = '2.23.136.1.1.2';
/** The master list signer's extended key usage. */
export const MASTER_LIST_SIGNER_EKU = '2.23.136.1.1.3';

const httpsUrl = z.string().refine((value) => {
  const url = safeUrl(value);
  return url !== null && url.protocol === 'https:' && url.username === '' && url.password === '';
}, 'must be an https URL without credentials');

export const trustAnchorSourceSchema = z.strictObject({
  /** Also the `trust_anchor_sources.id` (C53.3). */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/, 'must be a lower-case slug'),
  /** `bsi-de` on; `npkd-nl`, `ita`, `che` off until legal review (decisions 38, 40). */
  enabled: z.boolean(),
  publisher: z.string().min(1).max(200),
  list_url: httpsUrl,
  root_certificate_url: httpsUrl,
  root_certificate_sha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lower-case hex'),
  /** Where the published fingerprint the SHA-256 was checked against is. */
  fingerprint_checked_against: z.string().min(1).max(500),
  content_type: z.literal(MASTER_LIST_CONTENT_TYPE),
  signer_eku: z.literal(MASTER_LIST_SIGNER_EKU),
  /** The publisher's terms, in our words (C62.7, decisions 38-40). */
  terms: z.string().min(1).max(1000),
});
export type TrustAnchorSourceEntry = z.infer<typeof trustAnchorSourceSchema>;

/** The schema of `trust-anchors/manifest.json`. */
export const trustAnchorManifestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    description: z.string().max(2000).optional(),
    sources: z.array(trustAnchorSourceSchema).max(32).readonly(),
  })
  .refine(
    (manifest) => new Set(manifest.sources.map((s) => s.id)).size === manifest.sources.length,
    {
      message: 'each source has its own id',
      path: ['sources'],
    },
  );
export type TrustAnchorManifest = z.infer<typeof trustAnchorManifestSchema>;
