/**
 * C167.2, C167.3, C168.1, C168.3, C168.4 (Phase 9, Workflow 9B Stage 1a, (U)): environment-scoped
 * roles, what an operator may grant, invitations resent, reactivation, the console MFA reset with
 * its step-up, and an operator's own sessions. Dashboard routes, user sessions only; `foundation-9b`
 * (U) freezes them and `api-access` builds them.
 *
 * - `PUT /dashboard/users/:id/roles` (`users:write`) replaces the user's assignments: each a role and
 *   the environments it is granted in, or `null` for every current and future one (the public "all
 *   current and new environments"). An organisation-level permission (`PERMISSION_LEVEL`) or the
 *   built-in `admin` role in a narrower assignment is 422 `role_scope_invalid`; the granting user must
 *   hold every permission in each environment named.
 * - `GET /dashboard/roles/grantable` (`roles:read`): per environment, each permission and role with
 *   whether the caller may grant it and, when not, why.
 * - `POST /dashboard/invitations/:id/resend` (`users:write`; the id is the invited user's `usr_`, as
 *   invitations live on the user row): a new `ovi_` token, the old one revoked, 7 days; policy
 *   `invitations-resend`.
 * - `POST /dashboard/users/:id/reactivate` and `POST /dashboard/users/:id/reset-mfa` (`users:write`,
 *   never on oneself for the reset): the actor holds a superset of the target's permissions in every
 *   environment the target can enter (403 `user_more_privileged`) and verified a second factor within
 *   `STEP_UP_WINDOW_SECONDS` (403 `step_up_required`); a reactivated user gets no role back.
 * - `POST /dashboard/sessions/current/step-up` verifies a factor again on the current session.
 * - `GET /dashboard/sessions`, `POST /dashboard/sessions/:id/revoke`,
 *   `POST /dashboard/sessions/revoke-others`: the caller's own sessions.
 */
import { permissionLevel, permissionSchema } from '@openverify/core';
import { z } from 'zod';
import { idSchema } from './ids.js';
import { singleDocumentSchema, listDocumentSchema, timestampSchema } from './json-api.js';
import { totpCodeSchema, webauthnAuthenticationResponseSchema } from './mfa.js';

/** C168.1 (review P02): a reset or a reactivation needs a factor verified this recently. */
export const STEP_UP_WINDOW_SECONDS = 600;

/** C168.6 (review P23): the label of the audit IP index's HMAC, under the blind-index subkey. */
export const AUDIT_IP_INDEX_LABEL = 'openverify/audit-ip/v1';

/** One assignment: a role in some environments, or in every current and future one (`null`). */
export const roleAssignmentSchema = z.strictObject({
  'role-id': idSchema('role'),
  'environment-ids': z.array(idSchema('env')).min(1).max(20).nullable(),
});
export type RoleAssignment = z.infer<typeof roleAssignmentSchema>;

/** `PUT /dashboard/users/:id/roles`: every assignment, each role once. */
export const setUserRolesBodySchema = z.strictObject({
  assignments: z
    .array(roleAssignmentSchema)
    .min(1)
    .max(50)
    .refine(
      (assignments) =>
        new Set(assignments.map((assignment) => assignment['role-id'])).size === assignments.length,
      'must name each role once',
    ),
});
export type SetUserRolesBody = z.infer<typeof setUserRolesBodySchema>;

/**
 * The user's assignments, as `PUT /dashboard/users/:id/roles` stored them and
 * `GET /dashboard/users/:id/roles` (`users:read`, K9-22) reads them.
 */
export const userRoleAssignmentsDocumentSchema = singleDocumentSchema(
  z.strictObject({
    type: z.literal('user-role-assignments'),
    id: idSchema('usr'),
    attributes: z.strictObject({ assignments: z.array(roleAssignmentSchema).max(50) }),
  }),
);
export type UserRoleAssignmentsDocument = z.infer<typeof userRoleAssignmentsDocumentSchema>;

/** Permissions of one level (C167.2), each once. */
const permissionsAt = (level: 'organization' | 'environment') =>
  z
    .array(permissionSchema)
    .refine(
      (permissions) => permissions.every((permission) => permissionLevel(permission) === level),
      {
        message: `holds only ${level}-level permissions`,
      },
    )
    .refine((permissions) => new Set(permissions).size === permissions.length, {
      message: 'names each permission once',
    });

/**
 * K9-22 (Workflow 9D, DS8): `GET /dashboard/users/:id/permissions` (`users:read`), what a user's
 * assignments give (C167.2). The organisation-level permissions (`users:*`, `roles:*`) count only
 * through an organisation-wide assignment, so they are named once, in `organization`; per
 * environment of the organisation, the environment-level permissions held there and whether the user
 * may enter it (a role there and, in production, `environments:production` held there). Each list is
 * in `PERMISSIONS` order.
 */
export const userEffectivePermissionsDocumentSchema = singleDocumentSchema(
  z.strictObject({
    type: z.literal('user-effective-permissions'),
    id: idSchema('usr'),
    attributes: z.strictObject({
      organization: permissionsAt('organization'),
      environments: z.array(
        z.strictObject({
          'environment-id': idSchema('env'),
          'may-enter': z.boolean(),
          permissions: permissionsAt('environment'),
        }),
      ),
    }),
  }),
);
export type UserEffectivePermissionsDocument = z.infer<
  typeof userEffectivePermissionsDocumentSchema
>;

/**
 * Why a grant is refused (C167.4: the role editor shows each with its reason): the caller does not
 * hold it there (`not-held`, the escalation rule); an organisation-level permission, granted only
 * organisation-wide (`organization-level`); the built-in admin role, assignable organisation-wide
 * only (`admin-organization-wide`).
 */
export const GRANT_REFUSAL_REASONS = Object.freeze([
  'not-held',
  'organization-level',
  'admin-organization-wide',
] as const);
export const grantRefusalReasonSchema = z.enum(GRANT_REFUSAL_REASONS);

/** A grant's two members, held together: a refused grant has its reason, a grantable one none. */
const grantMembers = { grantable: z.boolean(), reason: grantRefusalReasonSchema.nullable() };
const reasonGiven = (entry: { grantable: boolean; reason: string | null }) =>
  entry.grantable === (entry.reason === null);
const REASON_RULE = {
  message: 'a refused grant has its reason, and a grantable one none',
  path: ['reason'],
};

/** `GET /dashboard/roles/grantable`: per environment of the organisation, then organisation-wide. */
export const grantableDocumentSchema = singleDocumentSchema(
  z.strictObject({
    type: z.literal('grantable'),
    id: idSchema('usr'),
    attributes: z.strictObject({
      scopes: z
        .array(
          z.strictObject({
            /** `null`: an organisation-wide assignment (`environment-ids: null`). */
            'environment-id': idSchema('env').nullable(),
            permissions: z.array(
              z
                .strictObject({ permission: permissionSchema, ...grantMembers })
                .refine(reasonGiven, REASON_RULE),
            ),
            roles: z.array(
              z
                .strictObject({ 'role-id': idSchema('role'), ...grantMembers })
                .refine(reasonGiven, REASON_RULE),
            ),
          }),
        )
        .min(1),
    }),
  }),
);
export type GrantableDocument = z.infer<typeof grantableDocumentSchema>;

/** The three actions take no body (an empty object, as an action without meta). */
export const resendInvitationBodySchema = z.strictObject({});
export const reactivateUserBodySchema = z.strictObject({});
export const resetUserMfaBodySchema = z.strictObject({});

/** `POST /dashboard/sessions/current/step-up`: a TOTP code or a passkey assertion; no recovery code. */
export const stepUpBodySchema = z.union([
  z.strictObject({ 'totp-code': totpCodeSchema }),
  z.strictObject({ credential: webauthnAuthenticationResponseSchema }),
]);
export type StepUpBody = z.infer<typeof stepUpBodySchema>;

/** The step-up's answer: when the factor was verified, and until when it lets the session act. */
export const stepUpResponseSchema = z.strictObject({
  'mfa-verified-at': timestampSchema,
  'step-up-expires-at': timestampSchema,
});

/** C168.4: one of the caller's sessions; a device summary from the user agent, never the agent. */
export const userSessionAttributesSchema = z.strictObject({
  /** Such as "Firefox on Linux"; `null` when the user agent names neither. */
  device: z.string().max(80).nullable(),
  'created-at': timestampSchema,
  'last-seen-at': timestampSchema,
  'expires-at': timestampSchema,
  current: z.boolean(),
  'mfa-verified-at': timestampSchema.nullable(),
  /**
   * C248.6 (KP11-26, Workflow 11F): the identity provider's `amr` of an SSO sign-in, as the
   * provider stated it (shown, never trusted); `null` for a password sign-in and a provider that
   * names none.
   */
  'provider-amr': z.array(z.string().min(1).max(64)).min(1).max(10).nullable(),
});
export const userSessionResourceSchema = z.strictObject({
  type: z.literal('user-session'),
  id: idSchema('uss'),
  attributes: userSessionAttributesSchema,
});
export const userSessionListDocumentSchema = listDocumentSchema(userSessionResourceSchema);
export const userSessionDocumentSchema = singleDocumentSchema(userSessionResourceSchema);

/** `POST /dashboard/sessions/revoke-others`: how many were revoked; the current one never is. */
export const revokeOtherSessionsResponseSchema = z.strictObject({
  meta: z.strictObject({ revoked: z.int().min(0) }),
});
