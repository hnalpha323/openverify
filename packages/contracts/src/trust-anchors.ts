/**
 * C62.10: `GET /api/v1/dashboard/trust-anchors` (permission `settings:read`), the console view of
 * the install-wide CSCA trust store (C62.7): each manifest source with its last sync, the anchors
 * per country, the withdrawn anchors, the freshness of each CRL and the sandbox anchors seed:dev
 * inserts (C62.8). Nothing in it is personal data: a CSCA belongs to an issuing state. Workflow
 * 5B Stage 1 froze this schema (C54.2); `api-nfc` builds the handler.
 */
import { z } from 'zod';
import { timestampSchema } from './json-api.js';

/** The outcomes `trust_anchor_syncs` records (C62.7). */
export const TRUST_ANCHOR_SYNC_OUTCOMES = ['accepted', 'refused', 'failed'] as const;

/** A CRL is `current` while `thisUpdate <= now < nextUpdate`, otherwise `expired` (C62.7). */
export const TRUST_CRL_FRESHNESS = ['current', 'expired'] as const;

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 in lower-case hex');
const keyIdSchema = z.string().regex(/^[0-9a-f]{2,128}$/, 'must be lower-case hex');
const countrySchema = z.string().regex(/^[A-Z]{2}$/, 'must be two capital letters');
const sourceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/, 'must be a lower-case slug');
const reasonSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be a snake_case code');
const countSchema = z.int().nonnegative();

/** The latest `trust_anchor_syncs` row of a source. */
export const trustAnchorSyncSummarySchema = z.strictObject({
  outcome: z.enum(TRUST_ANCHOR_SYNC_OUTCOMES),
  /** Why a sync was refused or failed, such as `list_signing_time_rollback`; null when accepted. */
  reason: reasonSchema.nullable(),
  'anchors-seen': countSchema,
  'anchors-withdrawn': countSchema,
  'crls-updated': countSchema,
  'created-at': timestampSchema,
});
export type TrustAnchorSyncSummary = z.infer<typeof trustAnchorSyncSummarySchema>;

/** One source of `trust-anchors/manifest.json` as the store holds it. */
export const trustAnchorSourceStatusSchema = z.strictObject({
  id: sourceIdSchema,
  enabled: z.boolean(),
  /** The last accepted sync; null before the first. */
  'last-synced-at': timestampSchema.nullable(),
  /** The accepted master list's CMS `signingTime`; a sync refuses an older one (rollback). */
  'list-signing-time': timestampSchema.nullable(),
  'list-sha256': sha256HexSchema.nullable(),
  /** The anchors this source lists now (memberships not withdrawn). */
  anchors: countSchema,
  /** The latest sync attempt, whatever its outcome; null before the first. */
  'last-sync': trustAnchorSyncSummarySchema.nullable(),
});
export type TrustAnchorSourceStatus = z.infer<typeof trustAnchorSourceStatusSchema>;

/** The anchors of one issuing country, sandbox-only anchors excluded. */
export const trustAnchorCountrySchema = z.strictObject({
  country: countrySchema,
  /** Usable anchors: listed now by an enabled source, link certificates included. */
  anchors: countSchema,
  'link-certificates': countSchema,
  'withdrawn-anchors': countSchema,
  /** The earliest `notAfter` among the usable anchors; null with none. */
  'next-expiry': timestampSchema.nullable(),
});
export type TrustAnchorCountry = z.infer<typeof trustAnchorCountrySchema>;

/** An anchor no enabled source lists any more: Passive Authentication answers `trust_anchor_withdrawn`. */
export const withdrawnTrustAnchorSchema = z.strictObject({
  /** The certificate's SHA-256. */
  id: sha256HexSchema,
  country: countrySchema,
  'subject-dn': z.string().min(1).max(1024),
  /** When the last enabled source stopped listing it; null when its sources were disabled. */
  'withdrawn-at': timestampSchema.nullable(),
});
export type WithdrawnTrustAnchor = z.infer<typeof withdrawnTrustAnchorSchema>;

/** One CRL the store holds, by its issuer's country and key. */
export const trustCrlStatusSchema = z.strictObject({
  'issuer-country': countrySchema,
  /** The issuing CSCA's subject key identifier. */
  'issuer-key-id': keyIdSchema,
  'this-update': timestampSchema,
  'next-update': timestampSchema,
  'fetched-at': timestampSchema,
  freshness: z.enum(TRUST_CRL_FRESHNESS),
});
export type TrustCrlStatus = z.infer<typeof trustCrlStatusSchema>;

/** A sandbox-only anchor (the Utopia test CSCA of seed:dev), never loaded for production (C62.8). */
export const sandboxTrustAnchorSchema = z.strictObject({
  id: sha256HexSchema,
  country: countrySchema,
  'not-before': timestampSchema,
  'not-after': timestampSchema,
  /** Its CRL's `nextUpdate` (seed:dev sets now + 90 days); null without a CRL. */
  'crl-next-update': timestampSchema.nullable(),
});
export type SandboxTrustAnchor = z.infer<typeof sandboxTrustAnchorSchema>;

/**
 * Workflow 5C review K13 (owner decision 6 after Workflow 5B; C62.7, C66): the install's
 * trust-store settings as the API process reads them. Compose gives the API the worker's values.
 */
export const trustStoreSettingsSchema = z.strictObject({
  /** `OPENVERIFY_TRUST_ANCHOR_REFRESH`: the worker refreshes the store every six hours. */
  'refresh-enabled': z.boolean(),
  /** `OPENVERIFY_NFC_ALLOW_ICAO_CRLS`: the sync also fetches CRLs from ICAO PKD hosts. */
  'icao-crls-allowed': z.boolean(),
});
export type TrustStoreSettings = z.infer<typeof trustStoreSettingsSchema>;

export const dashboardTrustAnchorsSchema = z.strictObject({
  'generated-at': timestampSchema,
  /**
   * Whether a usable anchor that is not sandbox-only exists: publishing a template with an NFC
   * step for a production environment needs one (C50.4, `provider_not_configured`).
   */
  'has-production-anchor': z.boolean(),
  settings: trustStoreSettingsSchema,
  sources: z.array(trustAnchorSourceStatusSchema),
  countries: z.array(trustAnchorCountrySchema),
  'withdrawn-anchors': z.array(withdrawnTrustAnchorSchema),
  crls: z.array(trustCrlStatusSchema),
  'sandbox-anchors': z.array(sandboxTrustAnchorSchema),
});
export type DashboardTrustAnchors = z.infer<typeof dashboardTrustAnchorsSchema>;
