/**
 * C248.4-C248.6 (Phase 11, Workflow 11B, `sso-oidc`): OIDC sign-in for the console.
 *
 * - **Start** (`GET /dashboard/sso/:organization-slug/start`): the organisation's provider (or the
 *   providers to choose from), discovery, a fresh `state`, `nonce` and PKCE verifier kept in a
 *   single-use record of 10 minutes keyed by the SHA-256 of a new browser binding, and the
 *   authorization URL. An unknown sign-in name, an organisation without a provider and a provider of
 *   another organisation are one answer (`sso_not_configured`).
 * - **Callback** (`GET /dashboard/sso/callback/:provider-id`): the record is consumed once, by the
 *   binding the console's cookie carries; its provider must be the path's (review P20) and its
 *   `state` the query's; the code is exchanged and the ID token verified (`client.ts`). Then
 *   **linking** (review P07): a returning user only by its stored `(provider, issuer, subject)`; the
 *   first link of an existing user only by a verified email inside the provider's domains, and never
 *   again by email once the user has a link to this provider; otherwise **just-in-time
 *   provisioning** when the provider has it on, with default roles that hold no forbidden permission
 *   now (review P21). The session follows C245; with `require-mfa`, a token short of the provider's
 *   `required-amr`/`required-acr` must pass the user's local factor first (a 202 challenge).
 * - **Step-up** (C248.6): a re-authentication of the session's own linked identity, its `auth_time`
 *   within Phase 9's 10 minutes and the same requirements, sets `mfa_verified_at`.
 *
 * Every refusal is an `SsoFlowError`: generic toward the browser, its precise code in the log line
 * and the metric `sso_sign_in_refused` only.
 */
import { timingSafeEqual } from 'node:crypto';
import {
  ACCESS_11B_AUDIT_ACTIONS,
  SSO_LOGIN_STATE_TTL_SECONDS,
  STEP_UP_WINDOW_SECONDS,
  jitRoleRefusals,
  ssoBindingSchema,
  type SsoStartResponse,
} from '@openverify/contracts';
import type { User } from '@openverify/db';
import * as oidc from 'openid-client';
import type { Clock } from '../../ports.js';
import type { MfaChallengeResult, SessionResult } from '../operator-auth.js';
import { newSsoBinding, sha256Hex } from './binding.js';
import {
  meetsAuthenticationRequirement,
  reauthenticatedWithin,
  tenantPinHolds,
  verifiedEmailOf,
  type IdTokenClaims,
} from './claims.js';
import type { OidcClient } from './client.js';
import { SsoFlowError, type SsoFailureCode } from './failures.js';
import type { SsoTenantPin } from './issuer.js';

/** A provider as the service uses it: its secret opened for this call only. */
export interface SsoProviderRecord {
  id: string;
  organizationId: string;
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  allowedEmailDomains: readonly string[];
  tenantPin: SsoTenantPin | null;
  requiredAmr: readonly string[];
  requiredAcr: readonly string[];
  jitProvisioning: boolean;
  defaultRoleIds: readonly string[];
  enforced: boolean;
}

export type SsoLoginPurpose = 'sign-in' | 'step-up';

/** The single-use record of one attempt (`sso_login_states`, Stage 1a amendment 11). */
export interface SsoLoginStateRecord {
  bindingSha256: string;
  organizationId: string;
  providerId: string;
  purpose: SsoLoginPurpose;
  /** A step-up's `uss_` session; `null` for a sign-in. */
  sessionId: string | null;
  stateSha256: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string | null;
  createdAt: Date;
  expiresAt: Date;
}

/** One link of a console user to an identity at a provider. */
export interface SsoIdentityRecord {
  userId: string;
  providerId: string;
  issuer: string;
  subject: string;
  linkedAt: Date;
}

/** What the service reads and writes (the Postgres store, or a test's). */
export interface SsoStore {
  findOrganizationIdBySlug(slug: string): Promise<string | null>;
  listProviders(organizationId: string): Promise<SsoProviderRecord[]>;
  getProvider(id: string): Promise<SsoProviderRecord | null>;
  insertLoginState(state: SsoLoginStateRecord): Promise<void>;
  /** The record, consumed: only an unused one that has not expired at `now`; once. */
  consumeLoginState(bindingSha256: string, now: Date): Promise<SsoLoginStateRecord | null>;
  findLinkedUser(providerId: string, issuer: string, subject: string): Promise<User | null>;
  listIdentitiesOfUser(userId: string): Promise<SsoIdentityRecord[]>;
  findUserByEmail(organizationId: string, email: string): Promise<User | null>;
  /** False when the user or the identity already has a link to this provider (a race). */
  linkIdentity(identity: SsoIdentityRecord): Promise<boolean>;
  /** The current permissions of each role of the organisation named, by id. */
  rolePermissions(
    organizationId: string,
    roleIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>>;
  /** C248.5: a new active user holding `roleIds` in every environment, with its link. */
  provisionUser(input: {
    organizationId: string;
    email: string;
    name: string | null;
    roleIds: readonly string[];
    identity: Omit<SsoIdentityRecord, 'userId'>;
  }): Promise<User>;
  /** The live session `sessionId` and its active user, or `null`. */
  findLiveSession(sessionId: string, now: Date): Promise<{ user: User } | null>;
  markSessionStepUp(sessionId: string, at: Date): Promise<boolean>;
  /** One organisation-wide audit entry (in each of its environments). */
  audit(entry: {
    organizationId: string;
    userId: string;
    action: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

/** At most this many `amr` values are kept on a session (KP11-26). */
export const PROVIDER_AMR_LIMIT = 10;
/** An `amr` value as RFC 8176 registers them: a short token, never free text. */
const AMR_VALUE = /^[A-Za-z0-9_.:-]{1,64}$/u;

/**
 * C248.6 (KP11-26, Workflow 11F): the token's `amr` as the session keeps it for the console's
 * display: the string values of RFC 8176's shape, in the token's order, at most ten; `null` when it
 * names none. It is shown, never trusted: the requirement checks read the claims themselves.
 */
export function providerAmrOf(claims: Readonly<Record<string, unknown>>): string[] | null {
  const amr = Array.isArray(claims.amr) ? (claims.amr as unknown[]) : [];
  const kept = amr
    .filter((value): value is string => typeof value === 'string' && AMR_VALUE.test(value))
    .slice(0, PROVIDER_AMR_LIMIT);
  return kept.length === 0 ? null : kept;
}

/** How a sign-in becomes a session (operator-auth's own rules: C245, C15, C167.2). */
export interface SsoSessionPort {
  requireMfa(organizationId: string): Promise<boolean>;
  /**
   * `providerAmr`: the token's `amr` (C248.6, KP11-26), kept on the session for the console's
   * display; absent or `null` for a sign-in that names none.
   */
  openSession(
    user: User,
    mfaPassed: boolean,
    providerAmr?: readonly string[] | null,
  ): Promise<SessionResult>;
  /** The user's local second factor to pass, or `null` when it has none. */
  startMfaChallenge(user: User): Promise<MfaChallengeResult | null>;
}

/** Told once, when an existing user is first linked (C248.4), if the mailer is configured. */
export type SsoLinkNotifier = (user: User, providerName: string) => Promise<void>;

/** Where refusals are told: the log line's code and the metric. */
export type SsoRefusalLog = (failure: SsoFailureCode, context: { providerId?: string }) => void;

export interface SsoServiceOptions {
  store: SsoStore;
  oidc: OidcClient;
  sessions: SsoSessionPort;
  clock: Clock;
  /** `OPENVERIFY_DASHBOARD_PUBLIC_URL`: the callback is `<it>/sso/callback/<id>`; none, no SSO. */
  dashboardPublicUrl: string | null;
  notifyLinked?: SsoLinkNotifier | undefined;
  onRefused?: SsoRefusalLog | undefined;
}

export type SsoCallbackResult =
  | ({ kind: 'session' } & SessionResult)
  | ({ kind: 'mfa' } & MfaChallengeResult)
  | {
      kind: 'step-up';
      verifiedAt: Date;
      returnTo: string | null;
      /** The session stepped up, and its user (for the route's audit entry). */
      sessionId: string;
      user: User;
    };

export interface SsoRedirect {
  authorizationUrl: string;
  binding: string;
  expiresAt: Date;
}

export interface SsoService {
  start(
    slug: string,
    options: { providerId?: string | undefined; returnTo?: string | undefined },
  ): Promise<SsoStartResponse>;
  /** C248.6: a re-authentication of the session's linked identity. */
  startStepUp(session: { sessionId: string; user: User }): Promise<SsoRedirect>;
  callback(
    providerId: string,
    query: URLSearchParams,
    binding: string | undefined,
  ): Promise<SsoCallbackResult>;
}

/** The per-provider redirect URI the operator registers (review P20). */
export function ssoRedirectUri(
  dashboardPublicUrl: string | null,
  providerId: string,
): string | null {
  return dashboardPublicUrl === null
    ? null
    : `${dashboardPublicUrl.replace(/\/+$/, '')}/sso/callback/${providerId}`;
}

const sameDigest = (left: string, right: string) =>
  left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));

export function createSsoService(options: SsoServiceOptions): SsoService {
  const { store, clock, sessions } = options;

  function refuse(failure: SsoFailureCode, providerId?: string): never {
    options.onRefused?.(failure, providerId === undefined ? {} : { providerId });
    throw new SsoFlowError(failure);
  }

  function redirectUriOf(providerId: string): string {
    return ssoRedirectUri(options.dashboardPublicUrl, providerId) ?? refuse('redirect_uri_unset');
  }

  async function discover(provider: SsoProviderRecord) {
    try {
      return await options.oidc.discover({
        issuer: provider.issuer,
        clientId: provider.clientId,
        clientSecret: provider.clientSecret,
        tenantPin: provider.tenantPin,
      });
    } catch (error) {
      return refuse(
        error instanceof SsoFlowError ? error.failure : 'discovery_failed',
        provider.id,
      );
    }
  }

  async function redirectFor(
    provider: SsoProviderRecord,
    purpose: SsoLoginPurpose,
    sessionId: string | null,
    returnTo: string | null,
  ): Promise<SsoRedirect> {
    const redirectUri = redirectUriOf(provider.id);
    const discovered = await discover(provider);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const binding = newSsoBinding();
    const authorizationUrl = await options.oidc.authorizationUrl(discovered, {
      redirectUri,
      state,
      nonce,
      codeVerifier,
      reauthenticate: purpose === 'step-up',
    });
    const createdAt = clock.now();
    const expiresAt = new Date(createdAt.getTime() + SSO_LOGIN_STATE_TTL_SECONDS * 1000);
    await store.insertLoginState({
      bindingSha256: sha256Hex(binding),
      organizationId: provider.organizationId,
      providerId: provider.id,
      purpose,
      sessionId,
      stateSha256: sha256Hex(state),
      nonce,
      codeVerifier,
      returnTo,
      createdAt,
      expiresAt,
    });
    return { authorizationUrl, binding, expiresAt };
  }

  /** C248.4 (review P07): who signs in, by subject, by a first email link, or provisioned. */
  async function userFor(provider: SsoProviderRecord, claims: IdTokenClaims, issuer: string) {
    const subject = typeof claims.sub === 'string' ? claims.sub : refuse('token_exchange_failed');
    const linked = await store.findLinkedUser(provider.id, issuer, subject);
    if (linked !== null) {
      return linked.status === 'active' ? linked : refuse('user_inactive', provider.id);
    }
    const email = verifiedEmailOf(claims, provider.allowedEmailDomains);
    if (!email.ok) {
      return refuse(email.failure, provider.id);
    }
    const at = clock.now();
    const identity = { providerId: provider.id, issuer, subject, linkedAt: at };
    const existing = await store.findUserByEmail(provider.organizationId, email.email);
    if (existing !== null) {
      // Once linked to this provider, a user is never matched by email again.
      const links = await store.listIdentitiesOfUser(existing.id);
      if (links.some((link) => link.providerId === provider.id)) {
        return refuse('identity_linked_elsewhere', provider.id);
      }
      if (existing.status !== 'active') {
        return refuse('user_inactive', provider.id);
      }
      if (!(await store.linkIdentity({ ...identity, userId: existing.id }))) {
        return refuse('identity_linked_elsewhere', provider.id);
      }
      await store.audit({
        organizationId: provider.organizationId,
        userId: existing.id,
        action: ACCESS_11B_AUDIT_ACTIONS.ssoLinked,
        resourceId: existing.id,
        metadata: { 'sso-provider-id': provider.id },
      });
      await options.notifyLinked?.(existing, provider.displayName);
      return existing;
    }
    if (!provider.jitProvisioning) {
      return refuse('user_unknown', provider.id);
    }
    // C248.5 (review P21): the default roles' permissions as they are now, not when saved.
    const permissions = await store.rolePermissions(
      provider.organizationId,
      provider.defaultRoleIds,
    );
    const held = provider.defaultRoleIds.map((id) => permissions.get(id));
    if (
      provider.defaultRoleIds.length === 0 ||
      held.some((each) => each === undefined) ||
      jitRoleRefusals(held.flatMap((each) => each ?? [])).length > 0
    ) {
      return refuse('jit_role_refused', provider.id);
    }
    const name = typeof claims.name === 'string' ? claims.name.slice(0, 200) : null;
    const user = await store.provisionUser({
      organizationId: provider.organizationId,
      email: email.email,
      name,
      roleIds: provider.defaultRoleIds,
      identity,
    });
    await store.audit({
      organizationId: provider.organizationId,
      userId: user.id,
      action: ACCESS_11B_AUDIT_ACTIONS.ssoProvisioned,
      resourceId: user.id,
      metadata: { 'sso-provider-id': provider.id, 'role-ids': [...provider.defaultRoleIds] },
    });
    return user;
  }

  return {
    async start(slug, { providerId, returnTo }) {
      const organizationId = await store.findOrganizationIdBySlug(slug);
      if (organizationId === null) {
        return refuse('organization_unknown');
      }
      const providers = await store.listProviders(organizationId);
      const named =
        providerId === undefined
          ? providers.length === 1
            ? providers[0]
            : undefined
          : providers.find((provider) => provider.id === providerId);
      if (providerId === undefined && providers.length > 1) {
        return {
          kind: 'choose',
          providers: providers
            .slice(0, 20)
            .map((provider) => ({ id: provider.id, 'display-name': provider.displayName })),
        };
      }
      if (named === undefined) {
        return refuse('provider_unknown', providerId);
      }
      const redirect = await redirectFor(named, 'sign-in', null, returnTo ?? null);
      return {
        kind: 'redirect',
        'authorization-url': redirect.authorizationUrl,
        binding: redirect.binding,
        'expires-at': redirect.expiresAt.toISOString(),
      };
    },

    async startStepUp({ sessionId, user }) {
      const identities = await store.listIdentitiesOfUser(user.id);
      const newest = [...identities].sort((a, b) => b.linkedAt.getTime() - a.linkedAt.getTime());
      for (const identity of newest) {
        const provider = await store.getProvider(identity.providerId);
        if (provider?.organizationId === user.organizationId) {
          return redirectFor(provider, 'step-up', sessionId, null);
        }
      }
      return refuse('provider_unknown');
    },

    async callback(providerId, query, binding) {
      if (binding === undefined || !ssoBindingSchema.safeParse(binding).success) {
        return refuse('binding_missing', providerId);
      }
      const now = clock.now();
      const record = await store.consumeLoginState(sha256Hex(binding), now);
      if (record === null) {
        return refuse('binding_unknown', providerId);
      }
      if (record.providerId !== providerId) {
        return refuse('provider_mismatch', providerId);
      }
      const state = query.get('state') ?? '';
      if (!sameDigest(sha256Hex(state), record.stateSha256)) {
        return refuse('state_mismatch', providerId);
      }
      const provider = await store.getProvider(providerId);
      if (provider?.organizationId !== record.organizationId) {
        return refuse('provider_unknown', providerId);
      }
      const redirectUri = redirectUriOf(providerId);
      const discovered = await discover(provider);
      const stepUp = record.purpose === 'step-up';
      let claims: IdTokenClaims;
      try {
        claims = await options.oidc.exchange(discovered, {
          redirectUri,
          query,
          state,
          nonce: record.nonce,
          codeVerifier: record.codeVerifier,
          maxAgeSeconds: stepUp ? STEP_UP_WINDOW_SECONDS : undefined,
        });
      } catch (error) {
        return refuse(
          error instanceof SsoFlowError ? error.failure : 'token_exchange_failed',
          providerId,
        );
      }
      if (!tenantPinHolds(claims, provider.tenantPin)) {
        return refuse('tenant_pin_mismatch', providerId);
      }
      const met = meetsAuthenticationRequirement(
        claims,
        provider.requiredAmr,
        provider.requiredAcr,
      );
      if (stepUp) {
        const live =
          record.sessionId === null ? null : await store.findLiveSession(record.sessionId, now);
        if (live === null || record.sessionId === null) {
          return refuse('session_gone', providerId);
        }
        const subject = typeof claims.sub === 'string' ? claims.sub : '';
        const linked = await store.findLinkedUser(providerId, discovered.expectedIssuer, subject);
        if (linked?.id !== live.user.id) {
          return refuse('step_up_identity_mismatch', providerId);
        }
        if (!reauthenticatedWithin(claims, now, STEP_UP_WINDOW_SECONDS)) {
          return refuse('step_up_stale', providerId);
        }
        const required = provider.requiredAmr.length > 0 || provider.requiredAcr.length > 0;
        if (required && !met) {
          return refuse('step_up_requirement_unmet', providerId);
        }
        if (!(await store.markSessionStepUp(record.sessionId, now))) {
          return refuse('session_gone', providerId);
        }
        return {
          kind: 'step-up',
          verifiedAt: now,
          returnTo: record.returnTo,
          sessionId: record.sessionId,
          user: live.user,
        };
      }
      const user = await userFor(provider, claims, discovered.expectedIssuer);
      if (!met && (await sessions.requireMfa(user.organizationId))) {
        // C248.6: the token does not stand in for the local factor; the user passes it first.
        const challenge = await sessions.startMfaChallenge(user);
        if (challenge !== null) {
          return { kind: 'mfa', ...challenge };
        }
      }
      return {
        kind: 'session',
        ...(await sessions.openSession(user, met, providerAmrOf(claims))),
      };
    },
  };
}
