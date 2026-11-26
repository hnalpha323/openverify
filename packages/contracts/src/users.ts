/**
 * Dashboard operator (`user`) resource (contracts C4 and C15). It never carries credentials.
 * The Phase 2 members (name, status, roles) are optional so Phase 1 documents still validate;
 * servers since Phase 2 send them.
 */
import { z } from 'zod';
import { idSchema } from './ids.js';
import { mfaFactorKindSchema } from './mfa.js';
import { roleIdentifierSchema } from './identifiers.js';
import {
  hasDistinctValues,
  listDocumentSchema,
  requestDocumentSchema,
  singleDocumentSchema,
  timestampSchema,
  toManyRelationshipSchema,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';

/**
 * An `invited` user has not accepted its invitation yet; `deactivated` users cannot sign in,
 * and deactivation revokes their sessions.
 */
export const USER_STATUSES = ['invited', 'active', 'deactivated'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

/** The statuses `PATCH /dashboard/users/:id` may set (C15). */
export const USER_UPDATABLE_STATUSES = ['active', 'deactivated'] as const;
export const userUpdatableStatusSchema = z.enum(USER_UPDATABLE_STATUSES);

export const userNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^\P{Cc}+$/u, 'must not contain control characters');

export const userAttributesSchema = z.strictObject({
  email: z.email().max(254),
  name: userNameSchema.nullable().optional(),
  status: userStatusSchema.optional(),
  /**
   * Whether the user has an active (confirmed) MFA factor. Sent by `GET /dashboard/users`
   * (Workflow 2C), so administrators see who still signs in with a password alone.
   */
  'mfa-enabled': z.boolean().optional(),
  /**
   * C168.5 (Workflow 9B; review P20): the factor kinds the user enrolled and how many of each, never
   * a secret or a judgement. Served only to holders of `users:write`.
   */
  'mfa-factors': z
    .array(z.strictObject({ kind: mfaFactorKindSchema, count: z.int().min(1).max(20) }))
    .max(2)
    .optional(),
  /** C168.5: the last successful sign-in, `null` when never; only to holders of `users:write`. */
  'last-sign-in-at': timestampSchema.nullable().optional(),
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
});

export const userResourceSchema = z.strictObject({
  type: z.literal('user'),
  id: idSchema('usr'),
  attributes: userAttributesSchema,
  relationships: z
    .strictObject({ roles: toManyRelationshipSchema(roleIdentifierSchema) })
    .optional(),
});
export type UserResource = z.infer<typeof userResourceSchema>;

export const userDocumentSchema = singleDocumentSchema(userResourceSchema);
export const userListDocumentSchema = listDocumentSchema(userResourceSchema);

/** `PATCH /api/v1/dashboard/users/:id` (permission `users:write`): roles or status. */
export const updateUserBodySchema = requestDocumentSchema(
  'user',
  z
    .strictObject({
      'role-ids': z
        .array(idSchema('role'))
        .min(1)
        .refine(hasDistinctValues, 'must not contain duplicates')
        .optional(),
      status: userUpdatableStatusSchema.optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;

/** `GET /api/v1/dashboard/users` query (permission `users:read`). */
export const listUsersQuerySchema = listQuerySchema('usr', {
  'filter[status]': filterListSchema(userStatusSchema).optional(),
});

export interface UserRecord {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
  /** Phase 2 members; each is sent only when present. */
  name?: string | null;
  status?: UserStatus;
  mfaEnabled?: boolean;
  roleIds?: readonly string[];
}

/**
 * Builds the user resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildUserResource(record: UserRecord): UserResource {
  return userResourceSchema.parse({
    type: 'user',
    id: record.id,
    attributes: {
      email: record.email,
      ...(record.name === undefined ? {} : { name: record.name }),
      ...(record.status === undefined ? {} : { status: record.status }),
      ...(record.mfaEnabled === undefined ? {} : { 'mfa-enabled': record.mfaEnabled }),
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
    ...(record.roleIds === undefined
      ? {}
      : { relationships: { roles: { data: record.roleIds.map((id) => ({ type: 'role', id })) } } }),
  });
}
