/**
 * A bare Fastify app with principal auth over two synthetic tenants on a PGlite database, for
 * testing the C12 platform plugins (idempotency, API logs) without the rest of the API. Only
 * tests import this file. Every value is synthetic.
 */
import { newId, newUserSessionToken } from '@openverify/contracts';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerProblemDetails } from '../problem-details.js';
import { requestIdFor } from '../request-id.js';
import { fixedClock, type TestClock } from '../test-support/fakes.js';
import { userPrincipal } from '../test-support/principals.js';
import type { UserPrincipal } from '../ports.js';
import principalAuth, { type ApiKeyRecord } from './principal-auth.js';

export interface PlatformTenant {
  organizationId: string;
  environmentId: string;
  /** An API key token holding every scope. */
  token: string;
  apiKeyId: string;
}

export interface PlatformTest {
  database: TestDatabase;
  clock: TestClock;
  /** Two environments of two organizations. */
  tenants: [PlatformTenant, PlatformTenant];
  /** A second API key in the first environment. */
  secondKey: { token: string; apiKeyId: string };
  /** A dashboard user session token in `environmentId` for one user (the same in each). */
  userToken(environmentId: string): string;
  userId: string;
  /** Builds an app with principal auth; `register` adds the plugins and routes under test. */
  app(register: (app: FastifyInstance) => void): FastifyInstance & { logs: LogLine[] };
  close(): Promise<void>;
}

export type LogLine = Record<string, unknown>;

/** A synthetic API key token: the sandbox prefix plus 43 characters. */
const syntheticToken = () => `ov_sbx_${newId('key').slice(4, 30)}${'A'.repeat(17)}`;

export async function createPlatformTest(): Promise<PlatformTest> {
  const database = await createTestDatabase();
  const clock = fixedClock();
  const keys = new Map<string, ApiKeyRecord>();
  const users = new Map<string, UserPrincipal>();
  const userId = newId('usr');
  const tenants: PlatformTenant[] = [];
  const addKey = (organizationId: string, environmentId: string) => {
    const token = syntheticToken();
    const apiKeyId = newId('key');
    keys.set(token, {
      id: apiKeyId,
      organizationId,
      environmentId,
      environmentKind: 'sandbox',
      scopes: [],
      expiresAt: null,
      revokedAt: null,
    });
    return { token, apiKeyId };
  };
  for (let index = 0; index < 2; index += 1) {
    const { organization, environment } = await createTestTenant(database.db);
    tenants.push({
      organizationId: organization.id,
      environmentId: environment.id,
      ...addKey(organization.id, environment.id),
    });
  }
  const [first, second] = tenants as [PlatformTenant, PlatformTenant];
  const apps: FastifyInstance[] = [];

  return {
    database,
    clock,
    tenants: [first, second],
    secondKey: addKey(first.organizationId, first.environmentId),
    userId,
    userToken(environmentId) {
      const tenant = tenants.find((candidate) => candidate.environmentId === environmentId);
      if (tenant === undefined) {
        throw new Error(`unknown environment ${environmentId}`);
      }
      const token = newUserSessionToken();
      users.set(
        token,
        userPrincipal({ organizationId: tenant.organizationId, environmentId, userId }),
      );
      return token;
    },
    app(register) {
      const logs: LogLine[] = [];
      const app = Fastify({
        genReqId: requestIdFor,
        requestIdHeader: false,
        logger: {
          level: 'info',
          stream: { write: (line: string) => logs.push(JSON.parse(line) as LogLine) },
        },
      });
      apps.push(app);
      registerProblemDetails(app, { exposeInternals: true });
      // A scope created before the plugins' decorations, as @fastify/swagger's routes are.
      void app.register((early, _options, next) => {
        early.get('/early', { config: { public: true } }, () => ({ early: true }));
        early.post('/early', { config: { public: true } }, () => ({ early: true }));
        next();
      });
      void app.register(principalAuth, {
        lookupApiKey: (token) => Promise.resolve(keys.get(token) ?? null),
        resolveUserSession: (token) => Promise.resolve(users.get(token) ?? null),
      });
      register(app);
      return Object.assign(app, { logs });
    },
    async close() {
      await Promise.all(apps.map((app) => app.close()));
      await database.close();
    },
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
