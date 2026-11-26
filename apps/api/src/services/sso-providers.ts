/**
 * C248.3, C248.5 (Phase 11, Workflow 11B, `sso-oidc`; reviews P01, P07, P19, P21, P35): an
 * organisation's OIDC identity providers, managed in Settings → Security → Single sign-on.
 *
 * - **Who:** the providers are the organisation's, so a read needs `settings:read` and a change
 *   `settings:write`, each through an organisation-wide assignment (the provider settings are
 *   organisation-level, as Phase 9's `SETTING_LEVEL` makes `require-mfa`), and every change Phase 9's
 *   step-up (a second factor checked in the last 10 minutes, or an SSO re-authentication).
 * - **What is refused at save** (422, with a pointer): a provider while the organisation has no
 *   sign-in name (amendment 10); a plain `http` issuer in production; a multi-tenant issuer without
 *   its tenant pin (review P07); a default role that does not exist, or one holding a permission
 *   C248.5 forbids (`jitRoleRefusals`; checked again at each just-in-time sign-in, review P21).
 * - **The secret** is sealed for its row and never served (`client-secret-set`); audit entries say
 *   that it changed, never what it is.
 */
import {
  ACCESS_11B_AUDIT_ACTIONS,
  STEP_UP_WINDOW_SECONDS,
  jitRoleRefusals,
  toTimestamp,
  type CreateSsoProviderBody,
  type SsoProviderResource,
  type UpdateSsoProviderBody,
} from '@openverify/contracts';
import {
  createSsoProvider,
  deleteSsoProvider,
  getOrganizationSlug,
  getRoles,
  getSsoProvider,
  getUserSession,
  listEnvironments,
  listSsoProviders,
  listUserRoleAssignments,
  updateSsoProvider,
  type Db,
  type SsoProvider,
  type SsoProviderInput,
} from '@openverify/db';
import { NotFoundError, PermissionDeniedError, UnprocessableContentError } from '../errors.js';
import { isMultiTenantIssuer, SHARED_ISSUERS } from '../operator-auth/oidc/issuer.js';
import { ssoRedirectUri } from '../operator-auth/oidc/service.js';
import type { AuditLogger, Clock, IdGenerator, ServiceContext } from '../ports.js';
import { organizationWidePermissions } from './access/grants.js';
import { AccessProblemError } from './access/problems.js';

export interface SsoProviderServiceDeps {
  db: Db;
  audit: AuditLogger;
  clock: Clock;
  ids: IdGenerator;
  /** Production mode: a plain `http` issuer is refused. */
  production: boolean;
  /** `OPENVERIFY_DASHBOARD_PUBLIC_URL`: the base of each provider's redirect URI. */
  dashboardPublicUrl: string | null | undefined;
  sharedIssuers?: readonly string[] | undefined;
}

/** A signed-in operator acting on the organisation's providers. */
export interface SsoProviderActing {
  ctx: ServiceContext;
  userId: string;
  sessionId: string;
}

const NOT_FOUND = 'The SSO provider was not found.';
const at = (name: string) => `/data/attributes/${name}`;

/** C248.3: the resource the console reads; never the secret. */
export function ssoProviderResourceOf(
  row: SsoProvider,
  dashboardPublicUrl: string | null | undefined,
): SsoProviderResource {
  return {
    type: 'sso-provider',
    id: row.id,
    attributes: {
      'display-name': row.displayName,
      issuer: row.issuer,
      'client-id': row.clientId,
      'client-secret-set': row.clientSecret.length > 0,
      'allowed-email-domains': row.allowedEmailDomains,
      'tenant-pin':
        row.tenantPinClaim === null || row.tenantPinValue === null
          ? null
          : { claim: row.tenantPinClaim, value: row.tenantPinValue },
      'required-amr': row.requiredAmr,
      'required-acr': row.requiredAcr,
      'jit-provisioning': row.jitProvisioning,
      'default-role-ids': row.defaultRoleIds,
      enforced: row.enforced,
      'redirect-uri': ssoRedirectUri(dashboardPublicUrl ?? null, row.id),
      'created-at': toTimestamp(row.createdAt),
      'updated-at': toTimestamp(row.updatedAt),
    },
  };
}

/** C248.3 (review P01): the permission through an organisation-wide assignment, or 403. */
async function assertOrganizationWide(
  deps: SsoProviderServiceDeps,
  acting: SsoProviderActing,
  permission: 'settings:read' | 'settings:write',
): Promise<void> {
  const held = organizationWidePermissions(
    await listUserRoleAssignments(deps.db, acting.ctx.organizationId, acting.userId),
  );
  if (!held.has(permission)) {
    throw new PermissionDeniedError(
      `Single sign-on is the organization's: it needs ${permission} in every environment of the organization.`,
      [permission],
    );
  }
}

/** C248.3: Phase 9's step-up, a second factor (or an SSO re-authentication) in the window. */
async function assertSteppedUp(deps: SsoProviderServiceDeps, acting: SsoProviderActing) {
  const session = await getUserSession(deps.db, acting.sessionId);
  const verifiedAt = session?.mfaVerifiedAt ?? null;
  const age = verifiedAt === null ? Infinity : deps.clock.now().getTime() - verifiedAt.getTime();
  if (!(age >= 0 && age <= STEP_UP_WINDOW_SECONDS * 1000)) {
    throw new AccessProblemError(
      'step_up_required',
      'Verify your second factor again before changing single sign-on.',
    );
  }
}

/** The provider's settings as stored, from a body (create) or a body over the current row. */
function inputOf(
  body: CreateSsoProviderBody['data']['attributes'] | UpdateSsoProviderBody['data']['attributes'],
  current?: SsoProvider,
): SsoProviderInput {
  const pin =
    body['tenant-pin'] === undefined
      ? current === undefined || current.tenantPinClaim === null
        ? null
        : { claim: current.tenantPinClaim, value: current.tenantPinValue ?? '' }
      : body['tenant-pin'];
  return {
    displayName: body['display-name'] ?? current?.displayName ?? '',
    issuer: body.issuer ?? current?.issuer ?? '',
    clientId: body['client-id'] ?? current?.clientId ?? '',
    allowedEmailDomains: body['allowed-email-domains'] ?? current?.allowedEmailDomains ?? [],
    tenantPinClaim: pin?.claim ?? null,
    tenantPinValue: pin?.value ?? null,
    requiredAmr: body['required-amr'] ?? current?.requiredAmr ?? [],
    requiredAcr: body['required-acr'] ?? current?.requiredAcr ?? [],
    jitProvisioning: body['jit-provisioning'] ?? current?.jitProvisioning ?? false,
    defaultRoleIds: body['default-role-ids'] ?? current?.defaultRoleIds ?? [],
    enforced: body.enforced ?? current?.enforced ?? false,
  };
}

/** The refusals at save (C248.3, C248.5), each with its pointer. */
async function assertSavable(
  deps: SsoProviderServiceDeps,
  organizationId: string,
  input: SsoProviderInput,
): Promise<void> {
  if ((await getOrganizationSlug(deps.db, organizationId)) === null) {
    throw new UnprocessableContentError(
      'Set the organization’s sign-in name (organization-slug) before adding single sign-on.',
      [
        {
          location: 'body',
          pointer: '',
          detail: 'the organization needs a sign-in name (organization-slug) first',
        },
      ],
    );
  }
  const errors: { location: string; pointer: string; detail: string }[] = [];
  if (deps.production && new URL(input.issuer).protocol !== 'https:') {
    errors.push({ location: 'body', pointer: at('issuer'), detail: 'must be https in production' });
  }
  if (
    isMultiTenantIssuer(input.issuer, deps.sharedIssuers ?? SHARED_ISSUERS) &&
    input.tenantPinClaim === null
  ) {
    errors.push({
      location: 'body',
      pointer: at('tenant-pin'),
      detail: 'is required for an issuer many tenants share (tid or hd)',
    });
  }
  const roles = await getRoles(deps.db, organizationId, input.defaultRoleIds);
  if (roles.length !== new Set(input.defaultRoleIds).size) {
    errors.push({
      location: 'body',
      pointer: at('default-role-ids'),
      detail: 'names a role this organization does not have',
    });
  } else {
    const refused = jitRoleRefusals(roles.flatMap((role) => role.permissions));
    if (refused.length > 0) {
      errors.push({
        location: 'body',
        pointer: at('default-role-ids'),
        detail: `a just-in-time role may not hold ${[...new Set(refused)].join(', ')}`,
      });
    }
  }
  if (input.jitProvisioning && input.defaultRoleIds.length === 0) {
    errors.push({
      location: 'body',
      pointer: at('default-role-ids'),
      detail: 'needs at least one role when just-in-time provisioning is on',
    });
  }
  if (errors.length > 0) {
    throw new UnprocessableContentError('The SSO provider cannot be saved.', errors);
  }
}

/** One organisation-wide audit entry, in every environment of the organisation. */
async function auditEverywhere(
  deps: SsoProviderServiceDeps,
  acting: SsoProviderActing,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  for (const environment of await listEnvironments(deps.db, acting.ctx.organizationId)) {
    await deps.audit.record(deps.db, {
      organizationId: acting.ctx.organizationId,
      environmentId: environment.id,
      actor: { type: 'user', id: acting.userId },
      action,
      resourceType: 'sso-provider',
      resourceId,
      metadata,
      ...(acting.ctx.requestId === undefined ? {} : { requestId: acting.ctx.requestId }),
      ...(acting.ctx.ipAddress === undefined ? {} : { ipAddress: acting.ctx.ipAddress }),
      ...(acting.ctx.userAgent === undefined ? {} : { userAgent: acting.ctx.userAgent }),
    });
  }
}

export async function listSsoProviderResources(
  deps: SsoProviderServiceDeps,
  acting: SsoProviderActing,
): Promise<SsoProviderResource[]> {
  await assertOrganizationWide(deps, acting, 'settings:read');
  return (await listSsoProviders(deps.db, acting.ctx.organizationId)).map((row) =>
    ssoProviderResourceOf(row, deps.dashboardPublicUrl),
  );
}

export async function getSsoProviderResource(
  deps: SsoProviderServiceDeps,
  acting: SsoProviderActing,
  id: string,
): Promise<SsoProviderResource> {
  await assertOrganizationWide(deps, acting, 'settings:read');
  const row = await getSsoProvider(deps.db, acting.ctx.organizationId, id);
  if (row === null) {
    throw new NotFoundError(NOT_FOUND);
  }
  return ssoProviderResourceOf(row, deps.dashboardPublicUrl);
}

export async function createSsoProviderFor(
  deps: SsoProviderServiceDeps,
  acting: SsoProviderActing,
  body: CreateSsoProviderBody,
): Promise<SsoProviderResource> {
  await assertOrganizationWide(deps, acting, 'settings:write');
  await assertSteppedUp(deps, acting);
  const attributes = body.data.attributes;
  const input = inputOf(attributes);
  await assertSavable(deps, acting.ctx.organizationId, input);
  const row = await createSsoProvider(deps.db, {
    ...input,
    id: deps.ids.newId('ssop'),
    organizationId: acting.ctx.organizationId,
    clientSecret: attributes['client-secret'],
    at: deps.clock.now(),
  });
  await auditEverywhere(deps, acting, ACCESS_11B_AUDIT_ACTIONS.ssoProviderCreated, row.id, {
    issuer: row.issuer,
    enforced: row.enforced,
    'jit-provisioning': row.jitProvisioning,
  });
  return ssoProviderResourceOf(row, deps.dashboardPublicUrl);
}

export async function updateSsoProviderFor(
  deps: SsoProviderServiceDeps,
  acting: SsoProviderActing,
  id: string,
  body: UpdateSsoProviderBody,
): Promise<SsoProviderResource> {
  await assertOrganizationWide(deps, acting, 'settings:write');
  await assertSteppedUp(deps, acting);
  const current = await getSsoProvider(deps.db, acting.ctx.organizationId, id);
  if (current === null) {
    throw new NotFoundError(NOT_FOUND);
  }
  const attributes = body.data.attributes;
  const input = inputOf(attributes, current);
  await assertSavable(deps, acting.ctx.organizationId, input);
  const secret = attributes['client-secret'];
  const row = await updateSsoProvider(deps.db, acting.ctx.organizationId, id, {
    ...input,
    ...(secret === undefined ? {} : { clientSecret: secret }),
    at: deps.clock.now(),
  });
  if (row === null) {
    throw new NotFoundError(NOT_FOUND);
  }
  await auditEverywhere(deps, acting, ACCESS_11B_AUDIT_ACTIONS.ssoProviderUpdated, id, {
    changed: Object.keys(attributes).filter((key) => key !== 'client-secret'),
    'client-secret-changed': secret !== undefined,
  });
  return ssoProviderResourceOf(row, deps.dashboardPublicUrl);
}

export async function deleteSsoProviderFor(
  deps: SsoProviderServiceDeps,
  acting: SsoProviderActing,
  id: string,
): Promise<void> {
  await assertOrganizationWide(deps, acting, 'settings:write');
  await assertSteppedUp(deps, acting);
  if (!(await deleteSsoProvider(deps.db, acting.ctx.organizationId, id))) {
    throw new NotFoundError(NOT_FOUND);
  }
  await auditEverywhere(deps, acting, ACCESS_11B_AUDIT_ACTIONS.ssoProviderDeleted, id, {});
}
