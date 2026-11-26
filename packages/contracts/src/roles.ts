/**
 * Roles (contract C15). Built-in roles are seeded per organization with `builtin: true` and a
 * stable `key`, and cannot be edited or deleted; custom roles hold any subset of the
 * permissions. A user's permissions are the union of its roles' (`permissionsForRoles`).
 */
import {
  BUILTIN_ROLE_KEYS,
  permissionSchema,
  type BuiltinRoleKey,
  type Permission,
} from '@openverify/core';
import { z } from 'zod';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toTimestamp,
} from './json-api.js';
import { listQuerySchema } from './list-filters.js';

export const roleNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^\P{Cc}+$/u, 'must not contain control characters');

export const rolePermissionsSchema = z
  .array(permissionSchema)
  .refine(
    (permissions) => new Set(permissions).size === permissions.length,
    'must not contain duplicates',
  );

export const roleAttributesSchema = z
  .strictObject({
    name: roleNameSchema,
    /** The built-in role's stable key; null for custom roles. */
    key: z.enum(BUILTIN_ROLE_KEYS).nullable(),
    builtin: z.boolean(),
    permissions: rolePermissionsSchema,
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
  })
  .refine((attributes) => attributes.builtin === (attributes.key !== null), {
    message: 'exactly the built-in roles have a key',
    path: ['key'],
  });

export const roleResourceSchema = resourceSchema('role', 'role', roleAttributesSchema);
export type RoleResource = z.infer<typeof roleResourceSchema>;

export const roleDocumentSchema = singleDocumentSchema(roleResourceSchema);
export const roleListDocumentSchema = listDocumentSchema(roleResourceSchema);

/** `POST /api/v1/dashboard/roles` (permission `roles:write`). */
export const createRoleBodySchema = requestDocumentSchema(
  'role',
  z.strictObject({
    name: roleNameSchema,
    permissions: rolePermissionsSchema.refine(
      (permissions) => permissions.length > 0,
      'needs at least one permission',
    ),
  }),
);
export type CreateRoleBody = z.infer<typeof createRoleBodySchema>;

/** `PATCH /api/v1/dashboard/roles/:id`: custom roles only (built-in roles answer 409). */
export const updateRoleBodySchema = requestDocumentSchema(
  'role',
  z
    .strictObject({
      name: roleNameSchema.optional(),
      permissions: rolePermissionsSchema.optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateRoleBody = z.infer<typeof updateRoleBodySchema>;

/** `GET /api/v1/dashboard/roles` query. */
export const listRolesQuerySchema = listQuerySchema('role', {}, { createdAt: false });

export interface RoleRecord {
  id: string;
  name: string;
  key: BuiltinRoleKey | null;
  builtin: boolean;
  permissions: readonly Permission[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Builds the role resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildRoleResource(record: RoleRecord): RoleResource {
  return roleResourceSchema.parse({
    type: 'role',
    id: record.id,
    attributes: {
      name: record.name,
      key: record.key,
      builtin: record.builtin,
      permissions: [...record.permissions],
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
  });
}
