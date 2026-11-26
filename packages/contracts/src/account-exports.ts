/**
 * C253 (Phase 11, Workflow 11B Stage 1a, checkpoint (D); decisions 11, 60; review P16): the per-account
 * access export, ours. Frozen here; `foundation-11b` registers the routes at 501, `dsar-export` builds
 * them.
 *
 * - `POST /api/v1/accounts/:id/export` (empty body) answers 202 with an `account-export` (`aexp_`)
 *   `pending`, after the `account-export` policy (10 an hour per environment, failing closed: 503
 *   `account_export_unavailable`); 409 `account_export_pending` while the account has one pending;
 *   422 `account_export_too_large` with the counts past `ACCOUNT_EXPORT_LIMITS.items`.
 * - `GET /api/v1/account-exports/:id` reads it; `GET /api/v1/account-exports/:id/manifest` serves the
 *   manifest (`application/json`, `accountExportManifestSchema`); `GET
 *   /api/v1/account-exports/:id/files/:fileId` serves one listed file's bytes from its live object
 *   (410 `account_export_item_redacted` once redacted). Only the manifest is stored, sealed under a new
 *   data key in object storage; no file is copied.
 * - Every route needs `account-access:export` (Stage 1a amendment 35), and a user also `pii:view` and
 *   Phase 9's step-up (403 `step_up_required`); the manifest and the file are audited; their bodies
 *   are never kept in the API log. An export of another environment is the generic 404.
 * - The export is kept `account-export-ttl-days` (default 7) after it is ready, then `expired`; any
 *   redaction or retention deletion that touches an item it lists deletes the export first (C253.4).
 *
 * The manifest (`openverify.account-export.v1`, kebab-case) is what this install holds about the
 * account at that moment, through the account's links: `subject` (the account, its inquiries with
 * sessions and consent records, verifications with extracted data and checks, decisions, reports,
 * devices, transactions, Connect shares and consent records, face templates as a count) and
 * `operator-review` (cases and comments, list memberships, signals, integrity verdicts), labelled
 * "review before disclosure" because some of it may fall under an exemption the operator must judge;
 * `files` describes each file; `not-covered` states what it does not hold. Each record in `subject`
 * and `operator-review` is the resource as the API serves it with `pii:view`.
 */
import { z } from 'zod';
import { idSchema } from './ids.js';
import {
  resourceIdentifierSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toOneRelationshipSchema,
} from './json-api.js';
import { ACCOUNT_EXPORT_LIMITS, ACCOUNT_EXPORT_PROBLEM_STATUSES } from './problem.js';

/** C253.2: the manifest's schema id and the resource's `schema-version`. */
export const ACCOUNT_EXPORT_SCHEMA_VERSION = 'openverify.account-export.v1';

/** C253.1: an export's statuses. */
export const ACCOUNT_EXPORT_STATUSES = Object.freeze([
  'pending',
  'ready',
  'failed',
  'expired',
] as const);
export const accountExportStatusSchema = z.enum(ACCOUNT_EXPORT_STATUSES);

const itemCount = z.int().min(0).max(ACCOUNT_EXPORT_LIMITS.items);
const failureCodeSchema = z.enum([
  'account_export_too_large',
  'account_export_unavailable',
] as const satisfies readonly (keyof typeof ACCOUNT_EXPORT_PROBLEM_STATUSES)[]);

/** C253.1: the export as `GET /account-exports/:id` serves it; counts and times, no personal data. */
export const accountExportAttributesSchema = z
  .strictObject({
    status: accountExportStatusSchema,
    'schema-version': z.literal(ACCOUNT_EXPORT_SCHEMA_VERSION),
    'created-at': timestampSchema,
    'ready-at': timestampSchema.nullable(),
    'expires-at': timestampSchema.nullable(),
    'item-count': itemCount.nullable(),
    /** The manifest's size plus the listed files' sizes. */
    'byte-count': z.int().min(0).nullable(),
    /** A failure's code, nothing else. */
    'error-code': failureCodeSchema.nullable(),
  })
  .refine(
    (a) =>
      (a.status === 'ready' || a.status === 'expired') ===
      (a['ready-at'] !== null && a['expires-at'] !== null && a['item-count'] !== null),
    { message: 'a cut export has its time, its expiry and its count', path: ['status'] },
  )
  .refine((a) => (a.status === 'ready') === (a['byte-count'] !== null), {
    message: 'only an export still kept has a size',
    path: ['byte-count'],
  })
  .refine((a) => (a.status === 'failed') === (a['error-code'] !== null), {
    message: 'a failure has its code, and nothing else does',
    path: ['error-code'],
  });

export const accountExportResourceSchema = resourceWithRelationshipsSchema(
  'account-export',
  'aexp',
  accountExportAttributesSchema,
  z.strictObject({ account: toOneRelationshipSchema(resourceIdentifierSchema('account', 'acc')) }),
);
export type AccountExportResource = z.infer<typeof accountExportResourceSchema>;
export const accountExportDocumentSchema = singleDocumentSchema(accountExportResourceSchema);

/** `POST /accounts/:id/export`: no member; the export is always whole. */
export const createAccountExportBodySchema = z.strictObject({});
export const accountExportParamsSchema = z.strictObject({ id: idSchema('aexp') });
/** C253.1: a file the manifest lists, by its own platform id (Stage 1a amendment 48). */
export const accountExportFileIdSchema = z.union([idSchema('file'), idSchema('txnf')]);
export const accountExportFileParamsSchema = z.strictObject({
  id: idSchema('aexp'),
  fileId: accountExportFileIdSchema,
});

/** A record as the API serves it with `pii:view`: a JSON:API resource object. */
const recordSchema = z.looseObject({
  type: z.string().min(1).max(100),
  id: z.string().min(1).max(100),
  attributes: z.record(z.string(), z.unknown()),
});
const records = z.array(recordSchema);

/**
 * C253.2, C241.4 (amendment 23): one Connect share touching the subject. An outbound share names its
 * recipient as the subject was shown it; an inbound one its source; never a counterparty's user, key
 * or audit row.
 */
export const accountExportShareSchema = z.strictObject({
  'share-token-id': idSchema('cnst'),
  direction: z.enum(['outbound', 'inbound']),
  status: z.enum(['created', 'pending', 'redeemed', 'expired', 'failed']),
  'data-categories': z.array(z.string().min(1).max(64)),
  'created-at': timestampSchema,
  'redeemed-at': timestampSchema.nullable(),
  recipient: z
    .strictObject({
      'organization-id': idSchema('org'),
      'organization-name': z.string().min(1).max(200),
    })
    .nullable(),
  source: z.strictObject({ 'organization-name': z.string().min(1).max(200) }).nullable(),
});

/** C253.3: what the manifest does not hold, each with its fixed sentence. */
export const ACCOUNT_EXPORT_NOT_COVERED = Object.freeze([
  'api-logs',
  'webhook-deliveries',
  'event-payloads',
  'backups',
  'outside-install',
  'face-templates',
] as const);

/** C253.2: one file the export lists; its bytes are served by the files route. */
export const ACCOUNT_EXPORT_FILE_KINDS = Object.freeze([
  'verification-file',
  'transaction-file',
] as const);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lower-case SHA-256');

/** C253.2: the manifest, `openverify.account-export.v1`. */
export const accountExportManifestSchema = z.strictObject({
  schema: z.literal(ACCOUNT_EXPORT_SCHEMA_VERSION),
  'export-id': idSchema('aexp'),
  'environment-id': idSchema('env'),
  'account-id': idSchema('acc'),
  'generated-at': timestampSchema,
  'item-count': itemCount,
  subject: z.strictObject({
    account: recordSchema,
    inquiries: records,
    'inquiry-sessions': records,
    verifications: records,
    decisions: records,
    reports: records,
    devices: records,
    transactions: records,
    'consent-records': records,
    'connect-shares': z.array(accountExportShareSchema),
    /** C253.3: derived numbers, never exported; present with their count. */
    'face-templates': z.strictObject({ present: z.boolean(), count: z.int().min(0) }),
  }),
  'operator-review': z.strictObject({
    label: z.literal('review before disclosure'),
    cases: records,
    'list-memberships': records,
    signals: records,
    'integrity-verdicts': records,
  }),
  files: z.array(
    z.strictObject({
      id: accountExportFileIdSchema,
      kind: z.enum(ACCOUNT_EXPORT_FILE_KINDS),
      'media-type': z.string().min(1).max(127),
      size: z.int().min(0),
      sha256,
      /** The record it belongs to (a verification or a transaction). */
      'belongs-to': z.string().min(1).max(100),
    }),
  ),
  'not-covered': z.array(
    z.strictObject({
      kind: z.enum(ACCOUNT_EXPORT_NOT_COVERED),
      detail: z.string().min(1).max(500),
    }),
  ),
});
export type AccountExportManifest = z.infer<typeof accountExportManifestSchema>;
