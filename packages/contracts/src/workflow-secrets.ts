/**
 * Workflow secrets (plan C125): a key the organisation names (`wsec_`), bound to hosts and placements,
 * with one sealed value per environment. Everything here is metadata: a value goes out in the body of
 * one `PUT` or rotate, under `secret-value`, which stored API logs redact, and never comes back. There
 * is no member that could hold one.
 *
 * Routes (`routes/server/workflow-secrets.ts`, frozen by `foundation-8a`, built by `api-egress`):
 * `GET /workflow-secrets` and `GET /workflow-secrets/:key` (`secrets:read`, showing only the caller's
 * environment's value metadata); `POST`, `PATCH /:key`, `DELETE /:key` (`secrets:write`; a delete is
 * refused with `secret_in_use` while a published version references the key);
 * `PUT /:key/values/:environment-id` and `POST /:key/values/:environment-id/rotate`, which act only on
 * the caller's own environment: another environment id answers 404.
 *
 * A reference is written `{{secrets.<key>}}`, and the public `current_run.environment.secrets.<key>`
 * is accepted as written and stored in our form (C125.3). The helpers below read references as text,
 * and only a reference: where one may stand is a publish rule (`secret_placement_refused`).
 */
import { z } from 'zod';
import { idSchema } from './ids.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { listQuerySchema } from './list-filters.js';

/** C125.1: provisional, ours: a signing key or a token fits, and a stored document does not. */
export const WORKFLOW_SECRET_LIMITS = Object.freeze({
  'value-bytes': 8192,
  hosts: 50,
  'header-placements': 16,
  'body-placements': 16,
  'description-length': 500,
  /** C125.2: how long a rotated signing secret keeps verifying. */
  'previous-value-hours': 24,
} as const);

const REFUSED_KEYS: ReadonlySet<string> = new Set(['constructor', 'prototype']);

/** C125.1: snake_case, unique per organisation, immutable. */
export const workflowSecretKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be a snake_case key of at most 64 characters')
  .refine((key) => !REFUSED_KEYS.has(key), 'must not name the prototype chain');

/**
 * C124.3: a host as `normalizeHost()` leaves it: lower case, no trailing dot, no port, an IDN in its
 * A-label form. The service normalises first, so what is stored is compared as is.
 */
export const workflowSecretHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/,
    'must be a normalised host name',
  );

/** The HTTP token syntax, the same rule the HTTPS step's headers meet. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/i;

/** C125.1 (P29): where a value may go. The server defaults to `authorization` and no pointer. */
export const workflowSecretPlacementsSchema = z.strictObject({
  headers: z
    .array(z.string().regex(HEADER_NAME, 'must be a header name'))
    .max(WORKFLOW_SECRET_LIMITS['header-placements']),
  'body-pointers': z
    .array(z.string().regex(/^\/[^\s]{0,255}$/, 'must be a JSON Pointer'))
    .max(WORKFLOW_SECRET_LIMITS['body-placements']),
});
export type WorkflowSecretPlacements = z.infer<typeof workflowSecretPlacementsSchema>;

const hostsSchema = z.array(workflowSecretHostSchema).min(1).max(WORKFLOW_SECRET_LIMITS.hosts);

const descriptionSchema = z.string().max(WORKFLOW_SECRET_LIMITS['description-length']);

const actorIdSchema = z.union([idSchema('usr'), idSchema('key')]);

/** C125.2: what a reader sees of the value in its own environment. */
export const workflowSecretValueMetaSchema = z.strictObject({
  'environment-id': idSchema('env'),
  last4: z.string().min(1).max(4),
  version: z.int().min(1),
  'rotated-by': actorIdSchema.nullable(),
  'rotated-at': timestampSchema.nullable(),
  /** C125.2: while a signing secret's previous value still verifies. */
  'previous-expires-at': timestampSchema.nullable(),
});

export const workflowSecretAttributesSchema = z.strictObject({
  key: workflowSecretKeySchema,
  description: descriptionSchema.nullable(),
  'allowed-hosts': hostsSchema,
  'allowed-placements': workflowSecretPlacementsSchema,
  'created-by': actorIdSchema,
  /** `null` when this environment holds no value. Named so, because `value` is PII on a list item. */
  'environment-value': workflowSecretValueMetaSchema.nullable(),
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
});

export const workflowSecretResourceSchema = resourceSchema(
  'workflow-secret',
  'wsec',
  workflowSecretAttributesSchema,
);
export type WorkflowSecretResource = z.infer<typeof workflowSecretResourceSchema>;

export const workflowSecretDocumentSchema = singleDocumentSchema(workflowSecretResourceSchema);
export type WorkflowSecretDocument = z.infer<typeof workflowSecretDocumentSchema>;
export const workflowSecretListDocumentSchema = listDocumentSchema(workflowSecretResourceSchema);
export type WorkflowSecretListDocument = z.infer<typeof workflowSecretListDocumentSchema>;

export const listWorkflowSecretsQuerySchema = listQuerySchema('wsec', {});

/** `POST /api/v1/workflow-secrets`. A value is set per environment, by its own route. */
export const createWorkflowSecretBodySchema = requestDocumentSchema(
  'workflow-secret',
  z.strictObject({
    key: workflowSecretKeySchema,
    description: descriptionSchema.optional(),
    'allowed-hosts': hostsSchema,
    'allowed-placements': workflowSecretPlacementsSchema.optional(),
  }),
);
export type CreateWorkflowSecretBody = z.infer<typeof createWorkflowSecretBodySchema>;

/**
 * `PATCH /api/v1/workflow-secrets/:key`. The key is immutable. Changing hosts or placements needs a
 * production user session when any production value exists (C125.2).
 */
export const updateWorkflowSecretBodySchema = requestDocumentSchema(
  'workflow-secret',
  z
    .strictObject({
      description: descriptionSchema.nullable().optional(),
      'allowed-hosts': hostsSchema.optional(),
      'allowed-placements': workflowSecretPlacementsSchema.optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateWorkflowSecretBody = z.infer<typeof updateWorkflowSecretBodySchema>;

/** A header can carry it, so no control character: CR, LF and NUL would split a request. */
const secretValueSchema = z
  .string()
  .min(1)
  .regex(/^\P{Cc}+$/u, 'must not contain control characters')
  .refine(
    (value) => new TextEncoder().encode(value).length <= WORKFLOW_SECRET_LIMITS['value-bytes'],
    'must be at most 8 KiB',
  );

const secretValueBodySchema = z.strictObject({
  data: z.strictObject({ attributes: z.strictObject({ 'secret-value': secretValueSchema }) }),
});

/** `PUT /api/v1/workflow-secrets/:key/values/:environment-id`. */
export const putWorkflowSecretValueBodySchema = secretValueBodySchema;
export type PutWorkflowSecretValueBody = z.infer<typeof putWorkflowSecretValueBodySchema>;

/** `POST .../rotate`: the previous value is kept up to 24 hours for a signing secret. */
export const rotateWorkflowSecretValueBodySchema = secretValueBodySchema;
export type RotateWorkflowSecretValueBody = z.infer<typeof rotateWorkflowSecretValueBodySchema>;

const REFERENCE = /\{\{\s*(?:current_run\.environment\.)?secrets\.([a-z][a-z0-9_]{0,63})\s*\}\}/g;

/** A leaf that is one reference and nothing else, in our stored form. */
export const workflowSecretReferenceSchema = z
  .string()
  .regex(/^\{\{\s*secrets\.[a-z][a-z0-9_]{0,63}\s*\}\}$/, 'must be {{secrets.<key>}}');

/** Whether `text` names a secret, in either form. */
export function hasSecretReference(text: string): boolean {
  return secretKeysOf(text).length > 0;
}

/** The keys `text` names, in order. */
export function secretKeysOf(text: string): readonly string[] {
  return [...text.matchAll(REFERENCE)].map((match) => match[1] ?? '');
}

/** C125.3: the public form as it is stored; every other template stays as written. */
export function normalizeSecretReference(text: string): string {
  return text.replace(REFERENCE, (_match, key: string) => `{{secrets.${key}}}`);
}

export interface WorkflowSecretRecord {
  id: string;
  key: string;
  description: string | null;
  allowedHosts: readonly string[];
  allowedPlacements: WorkflowSecretPlacements;
  createdBy: string;
  /** The caller's own environment's metadata, `null` when it holds no value. */
  value: {
    environmentId: string;
    last4: string;
    version: number;
    rotatedBy: string | null;
    rotatedAt: Date | null;
    previousExpiresAt: Date | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Builds a workflow secret's metadata.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildWorkflowSecretResource(record: WorkflowSecretRecord): WorkflowSecretResource {
  return workflowSecretResourceSchema.parse({
    type: 'workflow-secret',
    id: record.id,
    attributes: {
      key: record.key,
      description: record.description,
      'allowed-hosts': record.allowedHosts,
      'allowed-placements': record.allowedPlacements,
      'created-by': record.createdBy,
      'environment-value':
        record.value === null
          ? null
          : {
              'environment-id': record.value.environmentId,
              last4: record.value.last4,
              version: record.value.version,
              'rotated-by': record.value.rotatedBy,
              'rotated-at': toNullableTimestamp(record.value.rotatedAt),
              'previous-expires-at': toNullableTimestamp(record.value.previousExpiresAt),
            },
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
  });
}
