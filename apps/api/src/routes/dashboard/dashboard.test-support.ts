/**
 * A dashboard API (C4 and C15) over a PGlite database for route tests: a fast stand-in for
 * Argon2id, a capturing mailer, the real audit logger, a fixed clock, and helpers that create
 * organizations (with their built-in roles) and operators. Only tests import this file.
 * Every value is synthetic.
 */
import { newId, type EnvironmentKind } from '@openverify/contracts';
import type { BuiltinRoleKey } from '@openverify/core';
import {
  createEnvironment,
  createOrganization,
  createUser,
  listAuditLogs,
  setOrganizationRequireMfa,
  setUserRoles,
  type AuditLog,
  type User,
} from '@openverify/db';
import type { TestDatabase } from '@openverify/db/testing';
import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../app.js';
import type { ConnectInstallSettings, NfcSettings } from '../../config.js';
import {
  createLoginRateLimiter,
  createOperatorAuth,
  type LoginRateLimiter,
  type OperatorAuth,
  type PasswordHasher,
  type WebauthnSettings,
} from '../../operator-auth/index.js';
import type { Mailer, RateLimiter } from '../../ports.js';
import { createAuditLogger } from '../../services/audit-log.js';
import { syncOrganizationRoles } from '../../services/roles.js';
import { createInMemoryFileStorage, type InMemoryFileStorage } from '../../storage/index.js';
import {
  createCapturingMailer,
  fixedClock,
  type CapturingMailer,
  type TestClock,
} from '../../test-support/fakes.js';
import { ulidIdGenerator } from '../../ports.js';
import { dashboardRoutes } from './index.js';
import type { SsoRouteOptions } from './sso.js';

export const PREFIX = '/api/v1/dashboard';
export const PASSWORD = 'correct horse battery staple';
export const DASHBOARD_URL = 'http://localhost:3001';
export const BFF_TOKEN = 'synthetic-bff-token-0123456789abcdef-0123';
export const WEBAUTHN: WebauthnSettings = {
  rpId: 'localhost',
  rpName: 'OpenVerify',
  origin: DASHBOARD_URL,
};

const encodeFake = (password: string) =>
  `$argon2id$fake$${Buffer.from(password, 'utf8').toString('base64url')}`;

/** A fast stand-in for Argon2id that still yields `$argon2id$` strings. */
export const fakeHasher: PasswordHasher = {
  hash: (password) => Promise.resolve(encodeFake(password)),
  verify: (stored, password) => Promise.resolve(stored === encodeFake(password)),
};

export interface DashboardHarnessOptions {
  /** `null`: no WebAuthn relying party. Defaults to {@link WEBAUTHN}. */
  webauthn?: WebauthnSettings | null;
  /** `null`: no `OPENVERIFY_DASHBOARD_PUBLIC_URL`. Defaults to {@link DASHBOARD_URL}. */
  dashboardPublicUrl?: string | null;
  mailer?: Mailer;
  rateLimiter?: LoginRateLimiter;
  /** Defaults to {@link BFF_TOKEN}. */
  bffToken?: string;
  /** C62.7: the trust-store settings the API reads; both off by default. */
  nfc?: NfcSettings;
  /** C174.4 (Workflow 9B): the route policies' limiter (`invitations-resend`); none by default. */
  routeRateLimiter?: RateLimiter;
  /** C231.10 (Workflow 11A): the install switch; Connect is off by default. */
  connect?: ConnectInstallSettings;
  /** C254.1 (Q10 granted 2026-11-21): the UN opt-in's install switch; off unless a test sets it. */
  watchlistUnOptInAllowed?: boolean;
  /**
   * C248.3 (Workflow 11B, sso-oidc's borrowed edit): what the SSO routes hand the SSO service; the
   * routes' safe default (production rules, no private issuer) when left out.
   */
  sso?: SsoRouteOptions;
}

export interface TestOrganization {
  id: string;
  sandboxId: string;
  /** Set when created with `production: true`. */
  productionId: string | undefined;
  roleIds: Record<BuiltinRoleKey, string>;
}

export interface TestOperator {
  user: User;
  email: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface CallOptions {
  token?: string | undefined;
  payload?: unknown;
  headers?: Record<string, string>;
  remoteAddress?: string;
}

export interface DashboardHarness {
  app: ReturnType<typeof buildApp>;
  database: TestDatabase;
  clock: TestClock;
  mailer: CapturingMailer;
  storage: InMemoryFileStorage;
  operatorAuth: OperatorAuth;
  organization(options?: { requireMfa?: boolean; production?: boolean }): Promise<TestOrganization>;
  operator(
    organization: TestOrganization,
    options?: { roles?: BuiltinRoleKey[]; roleIds?: string[]; name?: string },
  ): Promise<TestOperator>;
  /** Signs in with the password; the operator must not have MFA. */
  signIn(email: string): Promise<string>;
  call(method: HttpMethod, path: string, options?: CallOptions): Promise<LightMyRequestResponse>;
  audit(environmentId: string, action?: string): Promise<AuditLog[]>;
  close(): Promise<void>;
}

let emailCounter = 0;

/** A dashboard API for one test; close it afterwards. */
export async function createDashboardHarness(
  database: TestDatabase,
  options: DashboardHarnessOptions = {},
): Promise<DashboardHarness> {
  const clock = fixedClock();
  const mailer = createCapturingMailer();
  const storage = createInMemoryFileStorage();
  const webauthn = options.webauthn === null ? undefined : (options.webauthn ?? WEBAUTHN);
  const operatorAuth = createOperatorAuth({
    db: database.db,
    hasher: fakeHasher,
    clock,
    rateLimiter: options.rateLimiter ?? createLoginRateLimiter({ clock }),
    bffToken: options.bffToken ?? BFF_TOKEN,
    webauthn,
  });
  const app = buildApp({ lookupApiKey: () => Promise.resolve(null), logger: false, mode: 'test' });
  await app.register(dashboardRoutes, {
    prefix: PREFIX,
    db: database.db,
    storage,
    keyring: database.keyring,
    operatorAuth,
    ...(options.connect === undefined ? {} : { connect: options.connect }),
    ...(options.sso === undefined ? {} : { sso: options.sso }),
    admin: {
      api: {
        audit: createAuditLogger(),
        mailer: options.mailer ?? mailer,
        clock,
        ids: ulidIdGenerator,
        ...(options.nfc === undefined ? {} : { nfc: options.nfc }),
        ...(options.routeRateLimiter === undefined
          ? {}
          : { rateLimiter: options.routeRateLimiter }),
      },
      ...(options.dashboardPublicUrl === null
        ? {}
        : { dashboardPublicUrl: options.dashboardPublicUrl ?? DASHBOARD_URL }),
      ...(options.watchlistUnOptInAllowed === undefined
        ? {}
        : { watchlistUnOptInAllowed: options.watchlistUnOptInAllowed }),
    },
  });
  await app.ready();

  const call: DashboardHarness['call'] = (method, path, callOptions = {}) =>
    app.inject({
      method,
      url: `${PREFIX}${path}`,
      headers: {
        ...(callOptions.token === undefined
          ? {}
          : { authorization: `Bearer ${callOptions.token}` }),
        ...callOptions.headers,
      },
      ...(callOptions.payload === undefined ? {} : { payload: callOptions.payload as never }),
      ...(callOptions.remoteAddress === undefined
        ? {}
        : { remoteAddress: callOptions.remoteAddress }),
    });

  return {
    app,
    database,
    clock,
    mailer,
    storage,
    operatorAuth,
    async organization(orgOptions = {}) {
      // C168.2 (Workflow 9B): new organisations require MFA by default; the harness keeps the old
      // `false` unless a test asks for it.
      const organization = await createOrganization(database.db, {
        id: newId('org'),
        name: 'Example Synthetic Org',
        requireMfa: false,
      });
      const environment = async (kind: EnvironmentKind) =>
        createEnvironment(database.db, { id: newId('env'), organizationId: organization.id, kind });
      const sandbox = await environment('sandbox');
      const production = orgOptions.production === true ? await environment('production') : null;
      if (orgOptions.requireMfa === true) {
        await setOrganizationRequireMfa(database.db, organization.id, true);
      }
      const roles = await syncOrganizationRoles(database.db, organization.id, ulidIdGenerator);
      const roleIds = Object.fromEntries(roles.map((role) => [role.key, role.id])) as Record<
        BuiltinRoleKey,
        string
      >;
      return { id: organization.id, sandboxId: sandbox.id, productionId: production?.id, roleIds };
    },
    async operator(organization, operatorOptions = {}) {
      emailCounter += 1;
      const email = `operator-${String(emailCounter)}-${newId('usr').slice(-6).toLowerCase()}@example.test`;
      const user = await createUser(database.db, {
        id: newId('usr'),
        organizationId: organization.id,
        email,
        passwordHash: encodeFake(PASSWORD),
        name: operatorOptions.name ?? null,
      });
      const roleIds = [
        ...(operatorOptions.roles ?? ['admin']).map((key) => organization.roleIds[key]),
        ...(operatorOptions.roleIds ?? []),
      ];
      await setUserRoles(database.db, organization.id, user.id, roleIds);
      return { user, email };
    },
    async signIn(email) {
      const response = await call('POST', '/sessions', { payload: { email, password: PASSWORD } });
      if (response.statusCode !== 201) {
        throw new Error(`sign-in failed with ${String(response.statusCode)}: ${response.body}`);
      }
      return response.json<{ token: string }>().token;
    },
    call,
    async audit(environmentId, action) {
      const entries = await listAuditLogs(database.db, environmentId);
      return action === undefined ? entries : entries.filter((entry) => entry.action === action);
    },
    close: () => app.close(),
  };
}

/** Parses a JSON response, failing with the body when the status is unexpected. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the shape it reads
export function expectJson<T = Record<string, unknown>>(
  response: LightMyRequestResponse,
  status: number,
): T {
  if (response.statusCode !== status) {
    throw new Error(
      `expected HTTP ${String(status)}, got ${String(response.statusCode)}: ${response.body}`,
    );
  }
  return response.json<T>();
}
