/**
 * API keys (contract C12). The token is returned once, as `meta.token` of the create and clone
 * responses; afterwards a key is known only by its `token-prefix` (the environment prefix and
 * the first 4 secret characters). A principal can only grant scopes it holds.
 */
import { z } from 'zod';
import { actionBodySchema, optionalActionBodySchema } from './actions.js';
import { apiVersionSchema, type ApiVersion } from './api-versions.js';
import { idSchema } from './ids.js';
import {
  hasDistinctValues,
  listDocumentSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { listQuerySchema } from './list-filters.js';
import { apiScopeSchema, type ApiScope } from './scopes.js';
import { attributeBlocklistSchema } from './webhooks.js';

/** Token prefixes per environment kind; they make leaked keys easy to recognise and scan for. */
export const API_KEY_TOKEN_PREFIXES = Object.freeze({
  sandbox: 'ov_sbx_',
  production: 'ov_prod_',
} as const);

/** A full API key token: the environment prefix and 256 random bits in base64url. */
export const apiKeyTokenSchema = z
  .string()
  .regex(/^ov_(?:sbx|prod)_[A-Za-z0-9_-]{43}$/, 'must be an OpenVerify API key');

export const apiKeyTokenPrefixSchema = z
  .string()
  .regex(/^ov_(?:sbx|prod)_[A-Za-z0-9_-]{4}$/, 'must be an API key token prefix');

const TOKEN_PREFIX = /^ov_(?:sbx|prod)_[A-Za-z0-9_-]{4}/;

/**
 * The part of a token shown after creation.
 * @throws {TypeError} when `token` is not an API key token.
 */
export function apiKeyTokenPrefix(token: string): string {
  const prefix = apiKeyTokenSchema.safeParse(token).success ? TOKEN_PREFIX.exec(token) : null;
  if (prefix === null) {
    throw new TypeError('Not an API key token');
  }
  return prefix[0];
}

export const MAX_API_KEY_ALLOWED_IPS = 50;
/** C129.4 (ours, provisional): a key serves one integration, which reads a few templates. */
export const MAX_API_KEY_CASE_TEMPLATES = 100;

/** Allowed client ranges in CIDR notation; an empty list allows every address. */
export const allowedIpsSchema = z
  .array(z.union([z.cidrv4(), z.cidrv6()]))
  .max(MAX_API_KEY_ALLOWED_IPS)
  .refine((ranges) => new Set(ranges).size === ranges.length, 'must not contain duplicates');

export const apiKeyNameSchema = z.string().min(1).max(200);

/** C169.1 (Workflow 9B; the public `note`, review H25): what the key is for, at most 255. */
export const apiKeyNoteSchema = z
  .string()
  .max(255)
  .regex(/^\P{Cc}*$/u, 'must not contain control characters');

const scopesSchema = z
  .array(apiScopeSchema)
  .refine((scopes) => new Set(scopes).size === scopes.length, 'must not contain duplicates');

export const apiKeyAttributesSchema = z.strictObject({
  name: apiKeyNameSchema,
  scopes: scopesSchema,
  'allowed-ips': allowedIpsSchema,
  /** Applies when a request names no `OpenVerify-Version`. */
  'api-version': apiVersionSchema,
  'token-prefix': apiKeyTokenPrefixSchema,
  'expires-at': timestampSchema.nullable(),
  'last-used-at': timestampSchema.nullable(),
  'created-at': timestampSchema,
  /**
   * Read only (C25.6, Workflow 2E): the key sees PII masked, as its creator does (C15, 2B F001).
   * Optional so earlier answers still parse; servers since Workflow 2E always send it.
   */
  'pii-masked': z.boolean().optional(),
  /**
   * C129.4 (P14): the restricted case templates this key may read, set when it is minted and never
   * wider than its creator sees. An empty list reads no restricted template; a template with no
   * `visible-to-roles` needs no entry. Left out by a server before Workflow 8B's columns.
   */
  'case-template-ids': z.array(idSchema('ctmpl')).optional(),
  /** C169.1 (Workflow 9B): the key's note; `null` when none. Left out by earlier servers. */
  note: apiKeyNoteSchema.nullable().optional(),
  /**
   * C169.3 (S4; the public `api-attributes-blocklist`): attribute names removed from every document
   * served to this key, at every exit (C14's grammar). Left out by earlier servers.
   */
  'attribute-blocklist': attributeBlocklistSchema.optional(),
  /** C169.2: older than the environment's `api-key-age-warning-days`. */
  'age-warning': z.boolean().optional(),
});

export const apiKeyResourceSchema = resourceSchema('api-key', 'key', apiKeyAttributesSchema);
export type ApiKeyResource = z.infer<typeof apiKeyResourceSchema>;

export const apiKeyDocumentSchema = singleDocumentSchema(apiKeyResourceSchema);
export const apiKeyListDocumentSchema = listDocumentSchema(apiKeyResourceSchema);

/** The create and clone responses: the key and, once, its token. */
export const createdApiKeyDocumentSchema = z
  .strictObject({
    data: apiKeyResourceSchema,
    meta: z.strictObject({ token: apiKeyTokenSchema }),
  })
  .refine(({ data, meta }) => meta.token.startsWith(data.attributes['token-prefix']), {
    message: 'the token must start with the token prefix',
    path: ['meta', 'token'],
  });
export type CreatedApiKeyDocument = z.infer<typeof createdApiKeyDocumentSchema>;

/** The longest expiry a key can be given: 30 days (C12 `expire`, C25.5 creation). */
export const API_KEY_EXPIRE_MAX_SECONDS = 30 * 24 * 60 * 60;

/** `POST /api/v1/api-keys` (scope `api-keys:write`). */
export const createApiKeyBodySchema = requestDocumentSchema(
  'api-key',
  z.strictObject({
    name: apiKeyNameSchema,
    scopes: scopesSchema.refine((scopes) => scopes.length > 0, 'needs at least one scope'),
    'allowed-ips': allowedIpsSchema.optional(),
    /** Defaults to the latest version. */
    'api-version': apiVersionSchema.optional(),
    /**
     * C25.5 (Workflow 2E): the key expires this many seconds after creation, 1 to 30 days.
     * Without it the key never expires.
     */
    'expires-in-seconds': z.int().min(1).max(API_KEY_EXPIRE_MAX_SECONDS).optional(),
    /** C129.4: `assertKeyTemplateRestrictionInTx` holds it to what the creator sees (V08). */
    'case-template-ids': z
      .array(idSchema('ctmpl'))
      .max(MAX_API_KEY_CASE_TEMPLATES)
      .refine(hasDistinctValues, 'must not contain duplicates')
      .optional(),
    // C169.1, C169.3 (Workflow 9B).
    note: apiKeyNoteSchema.nullable().optional(),
    'attribute-blocklist': attributeBlocklistSchema.optional(),
  }),
);
export type CreateApiKeyBody = z.infer<typeof createApiKeyBodySchema>;

/** `PATCH /api/v1/api-keys/:id`: the name or the allowed IPs. */
export const updateApiKeyBodySchema = requestDocumentSchema(
  'api-key',
  z
    .strictObject({
      name: apiKeyNameSchema.optional(),
      'allowed-ips': allowedIpsSchema.optional(),
      // C169.1, C169.3 (Workflow 9B): the note, and the blocklist (replaces the stored one).
      note: apiKeyNoteSchema.nullable().optional(),
      'attribute-blocklist': attributeBlocklistSchema.optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateApiKeyBody = z.infer<typeof updateApiKeyBodySchema>;

/** `POST /api/v1/api-keys/:id/clone`: same scopes, IPs and version, a new token. */
export const cloneApiKeyBodySchema = optionalActionBodySchema(
  z.strictObject({ name: apiKeyNameSchema.optional() }),
);

/** `POST /api/v1/api-keys/:id/expire`: 0 expires the key now. */
export const expireApiKeyBodySchema = actionBodySchema(
  z.strictObject({ 'expires-in-seconds': z.int().min(0).max(API_KEY_EXPIRE_MAX_SECONDS) }),
);
export type ExpireApiKeyBody = z.infer<typeof expireApiKeyBodySchema>;

/** C169.1: the longest the previous token of a rotation keeps working: 30 days. */
export const API_KEY_ROTATE_PREVIOUS_MAX_SECONDS = 30 * 24 * 60 * 60;

/**
 * `POST /api/v1/api-keys/:id/rotate` (C169.1, decision 50; ours): clones the key (scopes, IPs,
 * version, blocklist, note) through `cloneApiKey`'s own checks and expires the old one in one
 * transaction; the old token keeps working for `previous-expires-in-seconds` (0 ends it now).
 */
export const rotateApiKeyBodySchema = actionBodySchema(
  z.strictObject({
    'previous-expires-in-seconds': z.int().min(0).max(API_KEY_ROTATE_PREVIOUS_MAX_SECONDS),
    name: apiKeyNameSchema.optional(),
  }),
);
export type RotateApiKeyBody = z.infer<typeof rotateApiKeyBodySchema>;

/** The rotation's answer: the new key and, once, its token, and the old key with its end. */
export const rotatedApiKeyDocumentSchema = z
  .strictObject({
    data: apiKeyResourceSchema,
    meta: z.strictObject({
      token: apiKeyTokenSchema,
      'previous-key-id': idSchema('key'),
      'previous-expires-at': timestampSchema,
    }),
  })
  .refine(({ data, meta }) => meta.token.startsWith(data.attributes['token-prefix']), {
    message: 'the token must start with the token prefix',
    path: ['meta', 'token'],
  })
  .refine(({ data, meta }) => data.id !== meta['previous-key-id'], {
    message: 'the new key is another key',
    path: ['meta', 'previous-key-id'],
  });
export type RotatedApiKeyDocument = z.infer<typeof rotatedApiKeyDocumentSchema>;

/** `GET /api/v1/api-keys` query. */
export const listApiKeysQuerySchema = listQuerySchema('key', {});

export interface ApiKeyRecord {
  id: string;
  name: string;
  scopes: readonly ApiScope[];
  allowedIps: readonly string[];
  apiVersion: ApiVersion;
  tokenPrefix: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  /** C25.6: the key sees PII masked (2B F001). Left out, the attribute is not sent. */
  piiMasked?: boolean;
  /** C129.4. Left out, the attribute is not sent. */
  caseTemplateIds?: readonly string[];
  /** C169.1-C169.3 (Workflow 9B). Each left out is not sent. */
  note?: string | null;
  attributeBlocklist?: readonly string[];
  ageWarning?: boolean;
}

/**
 * Builds the API key resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildApiKeyResource(record: ApiKeyRecord): ApiKeyResource {
  return apiKeyResourceSchema.parse({
    type: 'api-key',
    id: record.id,
    attributes: {
      name: record.name,
      scopes: [...record.scopes],
      'allowed-ips': [...record.allowedIps],
      'api-version': record.apiVersion,
      'token-prefix': record.tokenPrefix,
      'expires-at': toNullableTimestamp(record.expiresAt),
      'last-used-at': toNullableTimestamp(record.lastUsedAt),
      'created-at': toTimestamp(record.createdAt),
      ...(record.piiMasked === undefined ? {} : { 'pii-masked': record.piiMasked }),
      ...(record.caseTemplateIds === undefined
        ? {}
        : { 'case-template-ids': [...record.caseTemplateIds] }),
      ...(record.note === undefined ? {} : { note: record.note }),
      ...(record.attributeBlocklist === undefined
        ? {}
        : { 'attribute-blocklist': [...record.attributeBlocklist] }),
      ...(record.ageWarning === undefined ? {} : { 'age-warning': record.ageWarning }),
    },
  });
}
