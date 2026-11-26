/**
 * C245.3, C248 (Phase 11, Workflow 11B Stage 1a, checkpoint (A)): OIDC sign-in for the console, the
 * organisation's sign-in name, and ending one user's sessions. Frozen here; `foundation-11b` registers
 * the routes at 501 and `sso-oidc` and `auth-sessions` build them.
 *
 * **Providers (C248.3; reviews P06, P07, P19, P21, V13).** `GET`/`POST /api/v1/dashboard/sso-providers`
 * and `GET`/`PATCH`/`DELETE /api/v1/dashboard/sso-providers/:id` (`ssop_`, ours), managed in Settings
 * by `settings:read` / `settings:write` held through an organisation-wide assignment (the providers
 * are organisation-level), each write behind Phase 9's step-up (403 `step_up_required`). The client
 * secret is write-only: sealed with row AAD, never served (`client-secret-set` says whether one is
 * held). `allowed-email-domains` is required and non-empty; a multi-tenant issuer is accepted only
 * with a `tenant-pin` (`tid` or `hd`), checked on every ID token; `required-amr` and `required-acr`
 * name what the ID token must show for the sign-in to stand in for the local factor (C248.6).
 * `redirect-uri` is the per-provider callback the operator registers at the identity provider
 * (`<OPENVERIFY_DASHBOARD_PUBLIC_URL>/sso/callback/<id>`; `null` without the variable).
 *
 * **The BFF calls (C248.4; review F21).** The console's route handlers (`apps/dashboard/src/app/
 * (auth)/sso/[slug]/start/route.ts` and `.../sso/callback/[provider]/route.ts`) call, with the BFF
 * token as the sign-in does: `GET /api/v1/dashboard/sso/:organization-slug/start` (the answer: an
 * authorization URL and the browser binding, which the handler sets as the `__Host-` cookie, or the
 * providers to choose from) and `GET /api/v1/dashboard/sso/callback/:provider-id` with the identity
 * provider's query unchanged and the cookie's binding in `SSO_BINDING_HEADER` (the answer: a session,
 * a second factor to pass, or a step-up). The binding names a single-use server-side record of 10
 * minutes holding `state`, `nonce`, the PKCE verifier and the provider (`sso_login_states`, Stage 1a
 * amendment 11); nothing of it is in the URL, a log or Valkey.
 *
 * **Ours, labelled:** the sign-in name (`organization-slug`, C248.8's "slug", which organisations did
 * not have; amendment 10), the provider's `display-name`, `default-role-ids` (role ids, so a custom
 * role may be the just-in-time role; amendment 36), the choose answer for an organisation with
 * several providers, and `ACCESS_11B_AUDIT_ACTIONS`.
 */
import { ORGANIZATION_LEVEL_PERMISSIONS, type Permission, isPermission } from '@openverify/core';
import { z } from 'zod';
import { stepUpResponseSchema } from './access.js';
import {
  dashboardMfaChallengeResponseSchema,
  dashboardSessionResponseSchema,
  organizationSlugSchema,
} from './dashboard-api.js';
import { idSchema } from './ids.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
} from './json-api.js';

/** C248.4: the single-use record of one sign-in attempt lives this long (ours: the plan's 10 minutes). */
export const SSO_LOGIN_STATE_TTL_SECONDS = 600;

/** C248.4 (ASVS 9.1.2): the ID token signatures accepted; `none` and HMAC never. */
export const SSO_ID_TOKEN_ALGORITHMS = Object.freeze(['RS256', 'ES256', 'PS256', 'EdDSA'] as const);

/** C248.3 (review P07): the claims a multi-tenant issuer is pinned by (Entra's `tid`, Google's `hd`). */
export const SSO_TENANT_PIN_CLAIMS = Object.freeze(['tid', 'hd'] as const);

/** C248.4: the BFF header that carries the browser binding from the cookie to the callback call. */
export const SSO_BINDING_HEADER = 'x-openverify-sso-binding';
/** C248.4: the cookie the start handler sets: host-only, Secure, HttpOnly, SameSite=Lax, path `/`. */
export const SSO_BINDING_COOKIE = '__Host-openverify-sso';
/** The same cookie under `OPENVERIFY_DASHBOARD_INSECURE_COOKIES` (development over plain HTTP). */
export const SSO_BINDING_COOKIE_INSECURE = 'openverify-sso';

/** C248.4: the browser binding, `ovsb_` and 32 random bytes as base64url; only its SHA-256 is stored. */
export const SSO_BINDING_PREFIX = 'ovsb_';
export const ssoBindingSchema = z
  .string()
  .regex(/^ovsb_[A-Za-z0-9_-]{43}$/, 'must be an ovsb_ browser binding');

/** A lowercase host name an email address may end in, such as `example.com`; no `@`, no wildcard. */
const emailDomainSchema = z
  .string()
  .max(253)
  .regex(
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/,
    'must be a lowercase domain such as example.com',
  );

/** C248.3 (review P06): an `amr` or `acr` value as identity providers spell them. */
const authenticationValueSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:/-]+$/, 'must be an amr or acr value');

/** C248.3 (review P07): the claim and value a multi-tenant issuer's ID tokens must carry. */
export const ssoTenantPinSchema = z.strictObject({
  claim: z.enum(SSO_TENANT_PIN_CLAIMS),
  value: z.string().min(1).max(256),
});

const issuerSchema = z
  .url({ protocol: /^https?$/ })
  .max(2048)
  .describe('The exact `iss`; `http` is refused in production by the server');

const providerShape = {
  /** Ours: the name the login page shows ("Sign in with ..."). */
  'display-name': z.string().trim().min(1).max(100),
  issuer: issuerSchema,
  'client-id': z.string().min(1).max(512),
  'allowed-email-domains': z
    .array(emailDomainSchema)
    .min(1)
    .max(50)
    .refine((domains) => new Set(domains).size === domains.length, 'must name each domain once'),
  'tenant-pin': ssoTenantPinSchema.nullable(),
  'required-amr': z.array(authenticationValueSchema).max(10),
  'required-acr': z.array(authenticationValueSchema).max(10),
  /** C248.5: off by default. */
  'jit-provisioning': z.boolean(),
  /** C248.5 (amendment 36): role ids, each bounded by `jitRoleRefusals` at save and at sign-in. */
  'default-role-ids': z.array(idSchema('role')).max(10),
  /** C248.6: password sign-in refused for the organisation's users but the break-glass path. */
  enforced: z.boolean(),
};

/** C248.3: what the console reads. The client secret is never served. */
export const ssoProviderAttributesSchema = z.strictObject({
  ...providerShape,
  'client-secret-set': z.boolean(),
  'redirect-uri': z.url().nullable(),
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
});
export const ssoProviderResourceSchema = resourceSchema(
  'sso-provider',
  'ssop',
  ssoProviderAttributesSchema,
);
export type SsoProviderResource = z.infer<typeof ssoProviderResourceSchema>;
export const ssoProviderDocumentSchema = singleDocumentSchema(ssoProviderResourceSchema);
export const ssoProviderListDocumentSchema = listDocumentSchema(ssoProviderResourceSchema);

/** The client secret, write-only; never logged (`API_LOG_REDACTED_KEYS`) or served. */
const clientSecretSchema = z.string().min(1).max(1024);

/** `POST /dashboard/sso-providers`: every member, the secret required, defaults stated. */
export const createSsoProviderBodySchema = requestDocumentSchema(
  'sso-provider',
  z.strictObject({
    ...providerShape,
    'client-secret': clientSecretSchema,
    'tenant-pin': providerShape['tenant-pin'].default(null),
    'required-amr': providerShape['required-amr'].default([]),
    'required-acr': providerShape['required-acr'].default([]),
    'jit-provisioning': providerShape['jit-provisioning'].default(false),
    'default-role-ids': providerShape['default-role-ids'].default([]),
    enforced: providerShape.enforced.default(false),
  }),
);
export type CreateSsoProviderBody = z.infer<typeof createSsoProviderBodySchema>;

/** `PATCH /dashboard/sso-providers/:id`: any member, a new secret included; never nothing. */
export const updateSsoProviderBodySchema = requestDocumentSchema(
  'sso-provider',
  z
    .strictObject({
      'display-name': providerShape['display-name'].optional(),
      issuer: providerShape.issuer.optional(),
      'client-id': providerShape['client-id'].optional(),
      'client-secret': clientSecretSchema.optional(),
      'allowed-email-domains': providerShape['allowed-email-domains'].optional(),
      'tenant-pin': providerShape['tenant-pin'].optional(),
      'required-amr': providerShape['required-amr'].optional(),
      'required-acr': providerShape['required-acr'].optional(),
      'jit-provisioning': providerShape['jit-provisioning'].optional(),
      'default-role-ids': providerShape['default-role-ids'].optional(),
      enforced: providerShape.enforced.optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0, 'nothing to update'),
);
export type UpdateSsoProviderBody = z.infer<typeof updateSsoProviderBodySchema>;

export const ssoProviderParamsSchema = z.strictObject({ id: idSchema('ssop') });

/**
 * C248.5 (review P21): the permissions a just-in-time default role may never hold, beside every
 * organisation-level permission (`ORGANIZATION_LEVEL_PERMISSIONS`).
 */
export const JIT_FORBIDDEN_PERMISSIONS = Object.freeze([
  'settings:write',
  'api-keys:read',
  'api-keys:write',
  'connect-connections:activate',
  'connect-consent-records:attest',
  'account-access:export',
  'environments:production',
] as const satisfies readonly Permission[]);

/** C248.5: the permissions of a role that bar it from just-in-time use, in the order given. */
export function jitRoleRefusals(permissions: readonly string[]): readonly string[] {
  const forbidden = new Set<string>([
    ...ORGANIZATION_LEVEL_PERMISSIONS,
    ...JIT_FORBIDDEN_PERMISSIONS,
  ]);
  return permissions.filter((permission) => isPermission(permission) && forbidden.has(permission));
}

/**
 * C248.4: the start path's sign-in name. The path parameter is camelCase (`:organizationSlug`),
 * as every path parameter of the API is: Fastify's router reads `-` after a parameter as the start
 * of a fixed part, so `:organization-slug` would never match (Workflow 11B Stage 1b (A) amendment).
 */
export const ssoStartParamsSchema = z.strictObject({ organizationSlug: organizationSlugSchema });

/** A path of the console to return to after signing in: one leading `/`, never another origin. */
const returnPathSchema = z
  .string()
  .max(2048)
  .regex(/^\/(?![/\\])[^\s]*$/, 'must be a path of the console');

/** C248.4: which provider (when the organisation has several) and where to return. */
export const ssoStartQuerySchema = z.strictObject({
  'provider-id': idSchema('ssop').optional(),
  'return-to': returnPathSchema.optional(),
});

/** C248.4: go to the identity provider with this binding set as the cookie. */
export const ssoRedirectSchema = z.strictObject({
  kind: z.literal('redirect'),
  'authorization-url': z.url({ protocol: /^https?$/ }).max(8192),
  binding: ssoBindingSchema,
  'expires-at': timestampSchema,
});
/** Ours: an organisation with several providers names them, and the start is asked again with one. */
export const ssoChooseSchema = z.strictObject({
  kind: z.literal('choose'),
  providers: z
    .array(
      z.strictObject({
        id: idSchema('ssop'),
        'display-name': providerShape['display-name'],
      }),
    )
    .min(2)
    .max(20),
});
export const ssoStartResponseSchema = z.discriminatedUnion('kind', [
  ssoRedirectSchema,
  ssoChooseSchema,
]);
export type SsoStartResponse = z.infer<typeof ssoStartResponseSchema>;

/** C248.4 (review P20): the per-provider callback path (`:providerId`, camelCase as above). */
export const ssoCallbackParamsSchema = z.strictObject({ providerId: idSchema('ssop') });

/**
 * C248.4: the identity provider's query, passed on unchanged (RFC 6749 §4.1.2 and §4.1.2.1, RFC 9207's
 * `iss`). Loose, because providers add members (`session_state`, `scope`, `authuser`); `state` is
 * always required, and either `code` or `error`.
 */
export const ssoCallbackQuerySchema = z
  .looseObject({
    code: z.string().min(1).max(4096).optional(),
    state: z.string().min(1).max(512),
    iss: z.url().max(2048).optional(),
    error: z.string().min(1).max(256).optional(),
    error_description: z.string().max(2048).optional(),
  })
  .refine((query) => (query.code === undefined) !== (query.error === undefined), {
    message: 'carries a code or an error',
  });

/**
 * C248.4, C248.6: what a callback answers: 201 a session (as the sign-in's 201), 202 a second factor
 * to pass (`require-mfa` and the ID token short of the provider's `required-amr`/`required-acr`), or
 * 200 a step-up of the current session (`prompt=login`, `max_age=0`, `auth_time` within Phase 9's
 * window), which sets `mfa_verified_at`.
 */
export const ssoCallbackResponseSchema = z.union([
  dashboardSessionResponseSchema,
  dashboardMfaChallengeResponseSchema,
  stepUpResponseSchema,
]);
export type SsoCallbackResponse = z.infer<typeof ssoCallbackResponseSchema>;

/** C248.6: `POST /dashboard/sessions/current/step-up/sso` (answers `ssoRedirectSchema`), no body. */
export const ssoStepUpBodySchema = z.strictObject({});

/** C245.3: `POST /dashboard/users/:id/end-sessions` (`users:write`), no body. */
export const endUserSessionsBodySchema = z.strictObject({});
/** C245.3: how many live sessions it ended (revoked as Phase 9 revokes; amendment 3). */
export const endUserSessionsResponseSchema = z.strictObject({
  'sessions-ended': z.int().min(0),
});
export type EndUserSessionsResponse = z.infer<typeof endUserSessionsResponseSchema>;

/** C245.3, C248.4-C248.6: the audit actions 11B writes (each in every environment of the organisation). */
export const ACCESS_11B_AUDIT_ACTIONS = Object.freeze({
  sessionsEnded: 'user.sessions-ended',
  ssoProviderCreated: 'sso-provider.created',
  ssoProviderUpdated: 'sso-provider.updated',
  ssoProviderDeleted: 'sso-provider.deleted',
  ssoLinked: 'user.sso-linked',
  ssoProvisioned: 'user.sso-provisioned',
  passwordLoginAllowed: 'user.password-login-allowed',
} as const);
