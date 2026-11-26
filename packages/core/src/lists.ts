/**
 * Lists (plan C97-C100): the thirteen kinds, their item and importer vocabularies, the matching
 * vocabularies and the limits. Everything a table CHECK, a key input or the importer reads lives
 * here, because `packages/db` and `packages/checks` cannot read `@openverify/contracts` (owner
 * decision 14 after Workflow 7A); contracts re-exports it.
 */
import { z } from 'zod';
import { provisionalDefault, type ConfigDefault } from './check-config/basis.js';

/** C97.1: the thirteen kinds, singular, as the item and importer types name them. */
export const LIST_KINDS = [
  'browser-fingerprint',
  'device-fingerprint',
  'country',
  'email-address',
  'face',
  'geolocation',
  'government-id-number',
  'field',
  'ip-address',
  'name',
  'phone-number',
  'selfie-background',
  'string',
] as const;
export const listKindSchema = z.enum(LIST_KINDS);
export type ListKind = z.infer<typeof listKindSchema>;

export interface ListKindDefinition {
  readonly kind: ListKind;
  /** The plural of the public paths: `POST /api/v1/list/<plural>`, `/list-item/<plural>`. */
  readonly plural: string;
  /** The item id prefix (C97.1). */
  readonly itemPrefix: string;
  /** Whether `POST /api/v1/importer/list-item/<plural>` exists (C100.1, decision 27). */
  readonly importer: boolean;
  /** Face and background lists: disabled until acknowledged, advisory, capped (C97.4, C99.7). */
  readonly biometric: boolean;
  /** Whether `list-config.screen: all` includes the kind (C99.5, H16). */
  readonly screenedByAll: boolean;
  /** Whether a fingerprint item records the blind-index key id (C94.4, P09). */
  readonly keyed: boolean;
}

function kind(
  name: ListKind,
  plural: string,
  itemPrefix: string,
  options: Partial<Omit<ListKindDefinition, 'kind' | 'plural' | 'itemPrefix'>> = {},
): ListKindDefinition {
  return Object.freeze({
    kind: name,
    plural,
    itemPrefix,
    importer: true,
    biometric: false,
    screenedByAll: true,
    keyed: false,
    ...options,
  });
}

const BIOMETRIC = { importer: false, biometric: true, screenedByAll: false } as const;

/** C97.1: paths are plural and types singular, as in the public API (H18). */
export const LIST_KIND_REGISTRY: Readonly<Record<ListKind, ListKindDefinition>> = Object.freeze({
  'browser-fingerprint': kind('browser-fingerprint', 'browser-fingerprints', 'libf', {
    keyed: true,
  }),
  'device-fingerprint': kind('device-fingerprint', 'device-fingerprints', 'lidf', { keyed: true }),
  country: kind('country', 'countries', 'lic'),
  'email-address': kind('email-address', 'email-addresses', 'liea'),
  face: kind('face', 'faces', 'lifc', BIOMETRIC),
  geolocation: kind('geolocation', 'geolocations', 'ligl'),
  'government-id-number': kind('government-id-number', 'government-id-numbers', 'ligin'),
  field: kind('field', 'fields', 'liif'),
  'ip-address': kind('ip-address', 'ip-addresses', 'liip'),
  name: kind('name', 'names', 'lin'),
  'phone-number': kind('phone-number', 'phone-numbers', 'lipn'),
  'selfie-background': kind('selfie-background', 'selfie-backgrounds', 'lisb', BIOMETRIC),
  // Strings are never screened at completion (C99.5): on demand, and in Phase 8 workflows.
  string: kind('string', 'strings', 'lis', { screenedByAll: false }),
});

/** The kinds with an importer (C100.1); face and background images are deferred (decision 27). */
export const IMPORTER_LIST_KINDS: readonly ListKind[] = Object.freeze(
  LIST_KINDS.filter((name) => LIST_KIND_REGISTRY[name].importer),
);

/** `list/<kind>`: the JSON:API type of a list. */
export type ListResourceType = `list/${ListKind}`;
/** `list-item/<kind>`: the JSON:API type of a list item (C97.1). */
export type ListItemResourceType = `list-item/${ListKind}`;
/** `importer/list-item/<kind>`: the JSON:API type of an importer (C97.1, C100.1). */
export type ImporterResourceType = `importer/list-item/${ListKind}`;

export function toListResourceType(name: ListKind): ListResourceType {
  return `list/${name}`;
}

export function toListItemResourceType(name: ListKind): ListItemResourceType {
  return `list-item/${name}`;
}

export function toImporterResourceType(name: ListKind): ImporterResourceType {
  return `importer/list-item/${name}`;
}

/** C97.2. */
/**
 * C122.1 (ours, V10; a C97 amendment): what a list is for. An add to a `block` list is an adverse
 * step, gated and recorded (C128); an add to an `allow` or `watch` list is not.
 */
export const LIST_PURPOSES = ['block', 'allow', 'watch'] as const;
export const listPurposeSchema = z.enum(LIST_PURPOSES);
export type ListPurpose = z.infer<typeof listPurposeSchema>;
/** The side that fails closed: a list nobody described counts as a block list. */
export const DEFAULT_LIST_PURPOSE: ListPurpose = 'block';

export const LIST_STATUSES = ['active', 'archived'] as const;
export const listStatusSchema = z.enum(LIST_STATUSES);
export type ListStatus = z.infer<typeof listStatusSchema>;

/** C97.2: `pending` means not yet indexed for matching, which only biometric items ever are. */
export const LIST_ITEM_STATUSES = ['pending', 'active', 'archived'] as const;
export const listItemStatusSchema = z.enum(LIST_ITEM_STATUSES);
export type ListItemStatus = z.infer<typeof listItemStatusSchema>;

/** C97.1: what an email item matches. */
export const LIST_EMAIL_MATCH_TYPES = ['email_address', 'domain'] as const;
export const listEmailMatchTypeSchema = z.enum(LIST_EMAIL_MATCH_TYPES);
export type ListEmailMatchType = z.infer<typeof listEmailMatchTypeSchema>;

/** C97.2, C99.7: why an item is archived without an operator's request. */
export const LIST_ITEM_ARCHIVE_REASONS = ['source_unavailable'] as const;

/**
 * C97.5, C99, C100 (ours, stated in the API docs and served in the list resource's `meta`). A limit
 * is a cost bound, not a matching threshold.
 */
export const LIST_LIMITS = Object.freeze({
  /** C97.5: active lists per environment. */
  activeListsPerEnvironment: 1000,
  /** C97.5: items per list. */
  itemsPerList: 1_000_000,
  /** C97.5: items per face or background list. */
  itemsPerBiometricList: 10_000,
  /** C97.1, C97.5: a geolocation item's radius, in meters. */
  radiusMeters: 500_000,
  /** C97.2: a list's name. */
  nameLength: 255,
  /** C97.1: a string item's value. */
  stringValueLength: 255,
  /** C97.2: `item-retention-days`. */
  itemRetentionDays: 3650,
  /** C99.3: a dismissal's reason. */
  dismissReasonLength: 500,
  /** C99.4: probes on one `POST /lists/match`. */
  matchProbes: 20,
  /** C99.5: lists named by `list-config.screen`. */
  screenedLists: 50,
  /** C106.2: lists one custom-list report selects. */
  reportLists: 20,
});

/**
 * C100.2: the importer's caps (ours; decision 31). The upload is buffered so `Idempotency-Key`
 * works, and the storage port has no streaming read.
 */
export const IMPORT_LIMITS = Object.freeze({
  /** ≤ 20 MB as multipart, or as a base64 `file` in JSON. */
  fileBytes: 20_000_000,
  rows: 100_000,
  /** `csv-parse`'s `max_record_size`. */
  recordCharacters: 4096,
  /** `list_import_errors` rows per import (C100.1, F12). */
  errorsPerImport: 1000,
  /** C100.2: the encrypted object is purged this long after the import ends. */
  objectRetentionDays: 7,
  /** C100.5: the same list, mode and SHA-256 inside this window answers the existing importer. */
  fileIdempotencyHours: 24,
});

/** C100.1: public `status`. */
export const IMPORTER_STATUSES = ['pending', 'ready', 'errored'] as const;
export const importerStatusSchema = z.enum(IMPORTER_STATUSES);
export type ImporterStatus = z.infer<typeof importerStatusSchema>;

/** C100.1 (ours): `all-or-nothing` is the default. */
export const IMPORTER_MODES = ['all-or-nothing', 'skip-invalid'] as const;
export const importerModeSchema = z.enum(IMPORTER_MODES);
export type ImporterMode = z.infer<typeof importerModeSchema>;

/** C100.4: the closed set of importer errors. A value is never echoed: a code and a line only. */
export const IMPORT_ERROR_CODES = [
  'invalid_encoding',
  'missing_column',
  'unknown_column',
  'duplicate_column',
  'row_limit_exceeded',
  'record_too_large',
  'field_count_mismatch',
  'invalid_value',
  'unparseable_phone',
  'host_bits_set',
  'out_of_range',
  'unsupported_class',
] as const;
export const importErrorCodeSchema = z.enum(IMPORT_ERROR_CODES);
export type ImportErrorCode = z.infer<typeof importErrorCodeSchema>;

/** C99.1: how a match was made. */
export const LIST_MATCH_METHODS = [
  'exact',
  'cidr',
  'radius',
  'fuzzy_name',
  'face_cosine',
  'background',
] as const;
export const listMatchMethodSchema = z.enum(LIST_MATCH_METHODS);
export type ListMatchMethod = z.infer<typeof listMatchMethodSchema>;

/** C99.3. */
export const LIST_MATCH_STATUSES = ['open', 'dismissed'] as const;
export const listMatchStatusSchema = z.enum(LIST_MATCH_STATUSES);
export type ListMatchStatus = z.infer<typeof listMatchStatusSchema>;

/**
 * C99.1 (H15): the tier of a match's evidence. R for exact, CIDR and radius on R-tier probes; H
 * for fuzzy names, backgrounds, IP-derived countries and points, and fingerprints read as "the
 * same device".
 */
export const LIST_MATCH_TIERS = ['R', 'H'] as const;
export const listMatchTierSchema = z.enum(LIST_MATCH_TIERS);
export type ListMatchTier = z.infer<typeof listMatchTierSchema>;

/**
 * C99.1 (H11, V15, V21): why a selected list could not be read. Each makes a screening partial
 * and is never "no match".
 */
export const LIST_UNSCREENED_REASONS = [
  'list_items_pending',
  'probe_unavailable',
  'probe_too_coarse',
  'consent_not_given',
  'normaliser_outdated',
  'key_rotated',
  'limit_exceeded',
  'list_archived',
  'method_not_on_demand',
  'kind_not_collected',
  'client_address_untrusted',
] as const;
export const listUnscreenedReasonSchema = z.enum(LIST_UNSCREENED_REASONS);
export type ListUnscreenedReason = z.infer<typeof listUnscreenedReasonSchema>;

/**
 * C99.1 (H16): a selected list the subject has no value for: screened, with nothing to compare,
 * and never a partial screening.
 */
export const LIST_NOT_APPLICABLE_REASONS = ['subject_has_no_value'] as const;
export const listNotApplicableReasonSchema = z.enum(LIST_NOT_APPLICABLE_REASONS);
export type ListNotApplicableReason = z.infer<typeof listNotApplicableReasonSchema>;

/**
 * C99.4: a screening row. `partial` and `errored` are never "no match": the served count is `null`
 * with `list_unscreened`.
 */
export const LIST_SCREENING_STATUSES = ['pending', 'completed', 'partial', 'errored'] as const;
export const listScreeningStatusSchema = z.enum(LIST_SCREENING_STATUSES);
export type ListScreeningStatus = z.infer<typeof listScreeningStatusSchema>;

/** C99.6: why a screening moved (or left) the inquiry. */
export const LIST_REVIEW_CAUSES = [
  'list_match',
  'list_unscreened',
  'inquiry_already_decided',
] as const;
export const listReviewCauseSchema = z.enum(LIST_REVIEW_CAUSES);
export type ListReviewCause = z.infer<typeof listReviewCauseSchema>;

/** C99.1, C99.5: where a probe value came from, in each kind's source order. */
export const LIST_PROBE_SOURCES = [
  'otp.email-address',
  'otp.phone-number',
  'inquiry.fields',
  'account.fields',
  'government-id.identification-number',
  'government-id.name',
  'government-id.issuing-country',
  'database.input',
  'session.ip-address',
  'session.ip-country',
  'session.ip-point',
  'session.browser-fingerprint',
  'session.device-fingerprint',
  'selfie.center',
  'report.query',
  'request',
] as const;
export const listProbeSourceSchema = z.enum(LIST_PROBE_SOURCES);
export type ListProbeSource = z.infer<typeof listProbeSourceSchema>;

/**
 * C98.2: the labelled keys of the list kinds, `openverify/<key kind>/v1`, written by
 * `identifierKey` under `IDENTIFIER_KEY_LABELS` (`packages/db/src/blind-index.ts`).
 * `listKeyInputs` answers `{ keyKind, input }[]` from these; `list_item_keys.key_kind` holds them.
 */
export const LIST_KEY_KINDS = [
  'identifier-string',
  'identifier-email',
  'identifier-email-domain',
  'identifier-phone',
  'identifier-government-id-number',
  'identifier-name',
  'identifier-name-last',
  'identifier-ip',
  'identifier-ip-range',
  'identifier-country',
  'identifier-geolocation',
  'identifier-browser-fingerprint',
  'identifier-device-fingerprint',
  'identifier-field',
] as const;
export const listKeyKindSchema = z.enum(LIST_KEY_KINDS);
export type ListKeyKind = z.infer<typeof listKeyKindSchema>;

const NO_CALIBRATION = 'no calibration report exists (ADR 0002 §3f); not tuned on any test data';

/**
 * C99.2, C99.7: the constants of the methods (two calibrated by Workflow 11D, the rest provisional). `api-lists` reads the candidate cap and
 * `api-biometric-lists` the face threshold; the fuzzy names reuse the C78 name-match threshold
 * unchanged, so none is declared here.
 */
export const LIST_MATCH_CONSTANTS: Readonly<Record<string, ConfigDefault>> = Object.freeze({
  'fuzzy-name-candidate-cap': Object.freeze({
    value: 5000,
    basis: 'calibrated',
    source:
      "C99.2 (F17): the last-name candidates a fuzzy first-name probe may decrypt; beyond it the list is limit_exceeded, never a silent cap. docs/calibration/lists-phase11.md (h) (Workflow 11D, owner decision 4 after 7B): the largest cap whose probe p95 at 1,000,000 heavy-headed items is within 1.5 times the 2,000 cap's (585.8 against 434.0 ms, 1.35 times) and peak memory within +512 MiB (+140), every screened probe's matches identical; limit_exceeded 38.0% to 31.7% of probes",
  }),
  'face-list-threshold': Object.freeze({
    value: 0.72,
    basis: 'calibrated',
    source:
      'C99.7: docs/calibration/lists-phase11.md (i) (Workflow 11D, owner decision 3 after 7B): the lowest threshold (0.30-0.95 by 0.01) whose FPIR upper end at a 10,000-template gallery is at most 1% over 707 public-domain studio-portrait identities (95% bootstrap over identities); 0.5 failed (upper end 21.4%). Costs FNIR 25.3% (21.9-28.8%): a quarter of mated searches miss. 249,571 impostor pairs cannot resolve a false-match rate below about 4e-6; not measured on handheld selfies against a list photo',
  }),
  'background-candidates': provisionalDefault(
    5,
    `C99.7: the nearest layout vectors confirmed by ORB and RANSAC, as Phase 4 does; ${NO_CALIBRATION}`,
  ),
  'biometric-cache-bytes': provisionalDefault(
    67_108_864,
    `C99.7 (P08, F39): the decrypted cache's bound per worker, 64 MB; a cost bound, unmeasured`,
  ),
  'biometric-cache-idle-minutes': provisionalDefault(
    10,
    `C99.7 (P08, F39): the decrypted cache's idle expiry; a privacy bound, unmeasured`,
  ),
});
