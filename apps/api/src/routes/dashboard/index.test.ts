import { createHash, randomBytes } from 'node:crypto';
import {
  FILE_CONTENT_CACHE_CONTROL,
  FILE_VIEWED_AUDIT_ACTION,
  USER_SESSION_TOKEN_TTL_SECONDS,
  dashboardInquiryDocumentSchema,
  dashboardInquiryListDocumentSchema,
  dashboardMeDocumentSchema,
  dashboardSessionResponseSchema,
  problemSchema,
} from '@openverify/contracts';
import { emptyExtractedFields } from '@openverify/core';
import { sql } from 'drizzle-orm';
import {
  createFile,
  createGovernmentIdExtraction,
  createRole,
  createSelfieCapture,
  createUser,
  createVerification,
  encryptBytes,
  errorOpenSelfieCaptures,
  listAuditLogs,
  replaceVerificationChecks,
  setUserRoles,
  transitionInquiryStatus,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import {
  createLoginRateLimiter,
  createOperatorAuth,
  hashPassword,
  type PasswordHasher,
} from '../../operator-auth/index.js';
import type { ApiKeyRecord } from '../../plugins/principal-auth.js';
import { ulidIdGenerator, type Clock, type FileStorage } from '../../ports.js';
import { builtinRoleId, syncOrganizationRoles } from '../../services/roles.js';
import {
  DASHBOARD_TAG,
  USER_SESSION_SECURITY_SCHEME,
  dashboardRoutes,
  type DashboardRoutesOptions,
} from './index.js';

// Synthetic operators, inquiries and images only: no real people, no real faces.
const PASSWORD = 'correct horse battery staple';
const T0 = Date.parse('2026-10-20T12:00:00.000Z');
const PREFIX = '/api/v1/dashboard';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const API_KEY = 'ov_sbx_synthetic_dashboard_test_key';

let database: TestDatabase;
let emailCounter = 0;
const apps: { close(): Promise<unknown> }[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

afterAll(async () => {
  await database.close();
});

const encodeFake = (password: string) =>
  `$argon2id$fake$${Buffer.from(password, 'utf8').toString('base64url')}`;

/** A fast stand-in for Argon2id; one test below runs the real one end to end. */
const fakeHasher: PasswordHasher = {
  hash: (password) => Promise.resolve(encodeFake(password)),
  verify: (stored, password) => Promise.resolve(stored === encodeFake(password)),
};

function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  const storage: FileStorage = {
    put: (key, ciphertext) => {
      objects.set(key, ciphertext);
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(objects.get(key) ?? null),
    delete: (key) => {
      objects.delete(key);
      return Promise.resolve();
    },
  };
  return { storage, objects };
}

const clock: Clock = { now: () => new Date(T0) };

async function makeApp(overrides: Partial<DashboardRoutesOptions> = {}) {
  const { storage, objects } = memoryStorage();
  const lookupApiKey = vi.fn((token: string) =>
    Promise.resolve<ApiKeyRecord | null>(
      token === API_KEY
        ? {
            id: testId('key'),
            organizationId: testId('org'),
            environmentId: testId('env'),
            environmentKind: 'sandbox',
            scopes: [],
            expiresAt: null,
            revokedAt: null,
          }
        : null,
    ),
  );
  const app = buildApp({ lookupApiKey, logger: false, mode: 'test' });
  apps.push(app);
  await app.register(dashboardRoutes, {
    prefix: PREFIX,
    db: database.db,
    storage,
    keyring: database.keyring,
    operatorAuth: createOperatorAuth({
      db: database.db,
      hasher: fakeHasher,
      clock,
      rateLimiter: createLoginRateLimiter({ perEmail: { max: 3, windowMs: 60_000 }, clock }),
    }),
    ...overrides,
  });
  await app.ready();
  return { app, storage, objects, lookupApiKey };
}

type App = Awaited<ReturnType<typeof makeApp>>['app'];

/**
 * An organization with a sandbox environment and one operator with a unique email. The
 * operator is an admin: since C15 the dashboard routes check role permissions.
 */
async function seedOperator(passwordHash = encodeFake(PASSWORD)) {
  const { organization, environment } = await createTestTenant(database.db);
  emailCounter += 1;
  const user = await createUser(database.db, {
    id: testId('usr'),
    organizationId: organization.id,
    email: `operator-${String(emailCounter)}@example.test`,
    passwordHash,
  });
  await syncOrganizationRoles(database.db, organization.id, ulidIdGenerator);
  await setUserRoles(database.db, organization.id, user.id, [
    await builtinRoleId(database.db, organization.id, 'admin'),
  ]);
  return { organization, environment, user };
}

function login(app: App, body: Record<string, unknown>, remoteAddress = '203.0.113.10') {
  return app.inject({ method: 'POST', url: `${PREFIX}/sessions`, payload: body, remoteAddress });
}

async function signIn(app: App, email: string): Promise<string> {
  const response = await login(app, { email, password: PASSWORD });
  expect(response.statusCode).toBe(201);
  return dashboardSessionResponseSchema.parse(response.json()).token;
}

function get(app: App, url: string, token?: string, remoteAddress?: string) {
  return app.inject({
    method: 'GET',
    url,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    ...(remoteAddress === undefined ? {} : { remoteAddress }),
  });
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A synthetic "PNG": the signature plus random bytes. It is never decoded as an image. */
const syntheticPng = () => Buffer.concat([PNG_SIGNATURE, randomBytes(64)]);

/** An inquiry with a government ID verification (checks and two files) and a selfie. */
async function seedInquiry(environmentId: string, storage: FileStorage) {
  const { inquiry, template } = await createTestInquiry(database.db, environmentId, {
    referenceId: 'ref-synthetic-001',
    fields: { name_first: 'Synthetic' },
  });
  const governmentId = await createVerification(database.db, environmentId, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
    country: 'US',
    idClass: 'drivers_license',
  });
  const selfie = await createVerification(database.db, environmentId, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'selfie',
  });
  await replaceVerificationChecks(database.db, environmentId, governmentId.id, [
    {
      name: 'id_blur_detection',
      status: 'passed',
      type: 'user_behavior',
      requirement: 'required',
      metadata: { blur_score: 182.5 },
    },
    {
      name: 'id_glare_detection',
      status: 'failed',
      type: 'user_behavior',
      requirement: 'not_required',
      reasons: ['glare_present'],
    },
  ]);
  const files = [];
  for (const kind of ['front', 'back'] as const) {
    const id = testId('file');
    const bytes = syntheticPng();
    const sealed = encryptBytes(bytes, database.keyring, { context: id });
    const storageKey = `${environmentId}/${id}`;
    await storage.put(storageKey, sealed.ciphertext);
    files.push({
      bytes,
      row: await createFile(database.db, environmentId, {
        id,
        verificationId: governmentId.id,
        kind,
        storageKey,
        mimeType: 'image/png',
        byteSize: bytes.length,
        sha256: sha256(bytes),
        wrappedDek: sealed.wrappedDek,
      }),
    });
  }
  return { inquiry, template, governmentId, selfie, files };
}

describe('POST /api/v1/dashboard/sessions', () => {
  it('signs an operator in without an API key and returns a 12 hour token once', async () => {
    const { app, lookupApiKey } = await makeApp();
    const { user, environment } = await seedOperator();

    const response = await login(app, { email: user.email, password: PASSWORD });

    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = dashboardSessionResponseSchema.parse(response.json());
    expect(body['expires-at']).toBe(
      new Date(T0 + USER_SESSION_TOKEN_TTL_SECONDS * 1000).toISOString(),
    );
    expect(body.user).toEqual({
      type: 'user',
      id: user.id,
      attributes: {
        email: user.email,
        name: null,
        status: 'active',
        'created-at': user.createdAt.toISOString(),
        'updated-at': user.updatedAt.toISOString(),
      },
    });
    expect(lookupApiKey).not.toHaveBeenCalled();

    const audit = await listAuditLogs(database.db, environment.id, {
      resourceType: 'user-session',
    });
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'user-session.created',
        actorType: 'user',
        actorId: user.id,
        requestId: response.headers['x-request-id'],
        ip: '203.0.113.10',
      }),
    ]);
  });

  it('answers a wrong password and an unknown email with the same generic 401', async () => {
    const { app } = await makeApp();
    const { user } = await seedOperator();

    const wrong = await login(app, { email: user.email, password: 'not the password' });
    const unknown = await login(app, { email: 'nobody@example.test', password: PASSWORD });

    for (const response of [wrong, unknown]) {
      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    }
    // Request ids differ by design; everything else must be identical.
    const strip = (body: unknown) => ({ ...problemSchema.parse(body), requestId: 'any' });
    expect(strip(wrong.json())).toEqual(strip(unknown.json()));
    expect(strip(wrong.json())).toMatchObject({
      status: 401,
      detail: 'The email or password is incorrect.',
    });
  });

  it('validates the body against the C4 schema', async () => {
    const { app } = await makeApp();

    const malformed = await login(app, { email: 'not-an-email', password: PASSWORD });
    const extra = await login(app, {
      email: 'operator@example.test',
      password: PASSWORD,
      environment: 'production',
    });

    expect(malformed.statusCode).toBe(400);
    expect(extra.statusCode).toBe(400);
  });

  it('rate-limits per email with 429 and Retry-After, across client addresses', async () => {
    const { app } = await makeApp();
    const { user } = await seedOperator();

    for (const address of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) {
      const response = await login(app, { email: user.email, password: 'wrong' }, address);
      expect(response.statusCode).toBe(401);
    }
    const limited = await login(app, { email: user.email, password: PASSWORD }, '203.0.113.4');

    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(problemSchema.parse(limited.json()).detail).toBe(
      'Too many sign-in attempts. Try again later.',
    );
  });

  it('rate-limits per client address', async () => {
    const { app } = await makeApp({
      operatorAuth: createOperatorAuth({
        db: database.db,
        hasher: fakeHasher,
        rateLimiter: createLoginRateLimiter({ perIp: { max: 2, windowMs: 60_000 } }),
      }),
    });

    await login(app, { email: 'a@example.test', password: 'x' }, '198.51.100.7');
    await login(app, { email: 'b@example.test', password: 'x' }, '198.51.100.7');
    const limited = await login(app, { email: 'c@example.test', password: 'x' }, '198.51.100.7');
    const elsewhere = await login(app, { email: 'c@example.test', password: 'x' }, '198.51.100.8');

    expect(limited.statusCode).toBe(429);
    expect(elsewhere.statusCode).toBe(401);
  });

  it('works end to end with the default Argon2id hasher and process keyring', async () => {
    const { app } = await makeApp({ operatorAuth: undefined, keyring: undefined });
    const { user } = await seedOperator(await hashPassword(PASSWORD));

    const token = await signIn(app, user.email);
    const me = await get(app, `${PREFIX}/me`, token);

    expect(me.statusCode).toBe(200);
  });
});

describe('user session authentication', () => {
  it('returns the current operator', async () => {
    const { app } = await makeApp();
    const { user } = await seedOperator();
    const token = await signIn(app, user.email);

    const response = await get(app, `${PREFIX}/me`, token);

    expect(response.statusCode).toBe(200);
    expect(dashboardMeDocumentSchema.parse(response.json()).data).toMatchObject({
      type: 'user',
      id: user.id,
      attributes: { email: user.email },
    });
  });

  it('requires a session token, with a Bearer challenge', async () => {
    const { app } = await makeApp();

    const response = await get(app, `${PREFIX}/me`);

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer realm="openverify"');
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
  });

  it('rejects an unknown token as invalid_token', async () => {
    const { app } = await makeApp();

    const response = await get(app, `${PREFIX}/me`, `ovu_${'A'.repeat(43)}`);

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('never accepts an API key in place of a user session', async () => {
    const { app, lookupApiKey } = await makeApp();

    const response = await get(app, `${PREFIX}/me`, API_KEY);

    expect(response.statusCode).toBe(401);
    expect(lookupApiKey).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/dashboard/sessions/current', () => {
  it('revokes the session so its token stops working', async () => {
    const { app } = await makeApp();
    const { user, environment } = await seedOperator();
    const token = await signIn(app, user.email);

    const response = await app.inject({
      method: 'DELETE',
      url: `${PREFIX}/sessions/current`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect((await get(app, `${PREFIX}/me`, token)).statusCode).toBe(401);
    const audit = await listAuditLogs(database.db, environment.id, {
      resourceType: 'user-session',
    });
    expect(audit.map((entry) => entry.action)).toEqual([
      'user-session.revoked',
      'user-session.created',
    ]);
  });
});

describe('GET /api/v1/dashboard/inquiries', () => {
  async function seedList() {
    const context = await makeApp();
    const operator = await seedOperator();
    const token = await signIn(context.app, operator.user.email);
    const first = await seedInquiry(operator.environment.id, context.storage);
    const second = await createTestInquiry(database.db, operator.environment.id);
    const third = await createTestInquiry(database.db, operator.environment.id);
    await transitionInquiryStatus(database.db, operator.environment.id, third.inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    return { ...context, ...operator, token, first, second, third };
  }

  it("lists the session environment's inquiries, newest first, with their verifications", async () => {
    const { app, token, first, second, third } = await seedList();
    const other = await seedOperator();
    await createTestInquiry(database.db, other.environment.id);

    const response = await get(app, `${PREFIX}/inquiries`, token);

    expect(response.statusCode).toBe(200);
    const body = dashboardInquiryListDocumentSchema.parse(response.json());
    expect(body.data.map((inquiry) => inquiry.id)).toEqual([
      third.inquiry.id,
      second.inquiry.id,
      first.inquiry.id,
    ]);
    expect(body.links.next).toBeNull();
    expect(body.data[2]?.relationships.verifications.data).toEqual([
      { type: 'verification/government-id', id: first.governmentId.id },
      { type: 'verification/selfie', id: first.selfie.id },
    ]);
    expect(body.data[2]?.attributes).toMatchObject({
      status: 'created',
      'reference-id': 'ref-synthetic-001',
    });
  });

  it('filters by status', async () => {
    const { app, token, third } = await seedList();

    const response = await get(app, `${PREFIX}/inquiries?filter[status]=pending`, token);

    const body = dashboardInquiryListDocumentSchema.parse(response.json());
    expect(body.data.map((inquiry) => inquiry.id)).toEqual([third.inquiry.id]);
  });

  it('pages with a cursor, keeping the filters in the next link', async () => {
    const { app, token, first, second, third } = await seedList();

    const firstPage = dashboardInquiryListDocumentSchema.parse(
      (await get(app, `${PREFIX}/inquiries?page[size]=2&filter[status]=created`, token)).json(),
    );
    expect(firstPage.data.map((inquiry) => inquiry.id)).toEqual([
      second.inquiry.id,
      first.inquiry.id,
    ]);
    expect(firstPage.links.next).toBeNull();

    const page = dashboardInquiryListDocumentSchema.parse(
      (await get(app, `${PREFIX}/inquiries?page[size]=1`, token)).json(),
    );
    expect(page.data.map((inquiry) => inquiry.id)).toEqual([third.inquiry.id]);
    const next = new URL(page.links.next ?? '', 'http://dashboard.invalid');
    expect(next.pathname).toBe(`${PREFIX}/inquiries`);
    expect(next.searchParams.get('page[after]')).toBe(third.inquiry.id);
    expect(next.searchParams.get('page[size]')).toBe('1');

    const following = dashboardInquiryListDocumentSchema.parse(
      (await get(app, `${next.pathname}${next.search}`, token)).json(),
    );
    expect(following.data.map((inquiry) => inquiry.id)).toEqual([second.inquiry.id]);
  });

  it('refuses a cursor from another environment with 400', async () => {
    const { app, token } = await seedList();
    const other = await seedOperator();
    const foreign = await createTestInquiry(database.db, other.environment.id);

    const response = await get(app, `${PREFIX}/inquiries?page[after]=${foreign.inquiry.id}`, token);

    expect(response.statusCode).toBe(400);
    expect(problemSchema.parse(response.json()).detail).toBe(
      'page[after] does not name an inquiry in this list.',
    );
  });

  it('validates the query', async () => {
    const { app, token } = await seedList();

    expect((await get(app, `${PREFIX}/inquiries?page[size]=101`, token)).statusCode).toBe(400);
    expect((await get(app, `${PREFIX}/inquiries?filter[status]=bogus`, token)).statusCode).toBe(
      400,
    );
  });

  it('requires a session', async () => {
    const { app } = await makeApp();

    expect((await get(app, `${PREFIX}/inquiries`)).statusCode).toBe(401);
  });
});

describe('GET /api/v1/dashboard/inquiries with the C165.3 filters (Workflow 9C, DA1)', () => {
  it('applies the server route’s filters, never answering them unfiltered', async () => {
    const context = await makeApp();
    const operator = await seedOperator();
    const token = await signIn(context.app, operator.user.email);
    const env = operator.environment.id;
    const first = await createTestInquiry(database.db, env);
    const second = await createTestInquiry(database.db, env);
    const third = await createTestInquiry(database.db, env);
    await database.db.execute(sql`update inquiries set flow_step_id = 'address-step',
      flow_state = 'active', flow_spec_version = 2
      where id in (${first.inquiry.id}, ${second.inquiry.id})`);
    const list = async (query: string) => {
      const response = await get(context.app, `${PREFIX}/inquiries?${query}`, token);
      expect(response.statusCode, response.body).toBe(200);
      return dashboardInquiryListDocumentSchema.parse(response.json());
    };
    const ids = async (query: string) => (await list(query)).data.map(({ id }) => id).sort();

    expect(await ids('filter[next-step-name]=address-step')).toEqual(
      [first.inquiry.id, second.inquiry.id].sort(),
    );
    expect(await ids('filter[check]=id_expired&filter[check-status]=failed')).toEqual([]);
    expect(await ids('filter[list-match]=matched')).toEqual([]);
    expect(await ids(`filter[list-id]=${testId('lst')}`)).toEqual([]);
    const paged = await list('filter[next-step-name]=address-step&page[size]=1');
    expect(paged.data).toHaveLength(1);
    expect(paged.links.next).toContain('filter%5Bnext-step-name%5D=address-step');
    expect(await ids('page[size]=100')).toContain(third.inquiry.id);
  });

  it('refuses filter[next-step-name] without pii:view (403), as the server route does', async () => {
    const context = await makeApp();
    const operator = await seedOperator();
    emailCounter += 1;
    const viewer = await createUser(database.db, {
      id: testId('usr'),
      organizationId: operator.organization.id,
      email: `viewer-${String(emailCounter)}@example.test`,
      passwordHash: encodeFake(PASSWORD),
    });
    await setUserRoles(database.db, operator.organization.id, viewer.id, [
      await builtinRoleId(database.db, operator.organization.id, 'viewer'),
    ]);
    const token = await signIn(context.app, viewer.email);

    const response = await get(
      context.app,
      `${PREFIX}/inquiries?filter[next-step-name]=address-step`,
      token,
    );

    expect(response.statusCode).toBe(403);
  });
});

describe('GET /api/v1/dashboard/inquiries/:id', () => {
  it('returns the inquiry with its verifications, checks and file metadata', async () => {
    const { app, storage } = await makeApp();
    const operator = await seedOperator();
    const token = await signIn(app, operator.user.email);
    const seeded = await seedInquiry(operator.environment.id, storage);

    const response = await get(app, `${PREFIX}/inquiries/${seeded.inquiry.id}`, token);

    expect(response.statusCode).toBe(200);
    const body = dashboardInquiryDocumentSchema.parse(response.json());
    expect(body.data).toMatchObject({
      id: seeded.inquiry.id,
      attributes: { fields: { name_first: 'Synthetic' } },
      relationships: {
        'inquiry-template': { data: { type: 'inquiry-template', id: seeded.template.id } },
      },
    });
    const [governmentId, selfie, front, back] = body.included;
    expect(governmentId).toMatchObject({
      type: 'verification/government-id',
      id: seeded.governmentId.id,
      attributes: {
        status: 'initiated',
        country: 'US',
        'id-class': 'drivers_license',
        checks: [
          {
            name: 'id_blur_detection',
            status: 'passed',
            reasons: [],
            requirement: 'required',
            metadata: { blur_score: 182.5 },
          },
          {
            name: 'id_glare_detection',
            status: 'failed',
            reasons: ['glare_present'],
            requirement: 'not_required',
            metadata: {},
          },
        ],
      },
      relationships: {
        inquiry: { data: { type: 'inquiry', id: seeded.inquiry.id } },
        files: {
          data: seeded.files.map(({ row }) => ({ type: 'file', id: row.id })),
        },
      },
    });
    expect(selfie).toMatchObject({
      type: 'verification/selfie',
      id: seeded.selfie.id,
      attributes: { checks: [] },
      relationships: { files: { data: [] } },
    });
    expect([front, back]).toEqual(
      seeded.files.map(({ row, bytes }) => ({
        type: 'file',
        id: row.id,
        attributes: {
          kind: row.kind,
          'mime-type': 'image/png',
          'byte-size': bytes.length,
          'created-at': row.createdAt.toISOString(),
          // Workflow 10B (C206): client-reported; none sent here.
          'capture-method': null,
          'capture-trigger': null,
        },
        relationships: {
          verification: {
            data: { type: 'verification/government-id', id: seeded.governmentId.id },
          },
        },
      })),
    );
    // Storage internals never leave the API.
    expect(response.body).not.toMatch(/storage|wrapped|sha256|ov1\./);
  });

  it('serves the extraction attributes of its government ID, masked without pii:view (C31.6)', async () => {
    const { app, storage } = await makeApp();
    const admin = await seedOperator();
    const seeded = await seedInquiry(admin.environment.id, storage);
    await createGovernmentIdExtraction(database.db, admin.environment.id, {
      verificationId: seeded.governmentId.id,
      // A fictional Utopia holder: synthetic values only.
      fields: { ...emptyExtractedFields(), 'name-last': 'VALEMONT', birthdate: '1990-02-14' },
      fieldSources: { 'name-last': ['viz'] },
      identificationNumberIndex: null,
      frontPhash: null,
    });
    const developer = await createUser(database.db, {
      id: testId('usr'),
      organizationId: admin.organization.id,
      email: `developer-${String((emailCounter += 1))}@example.test`,
      passwordHash: encodeFake(PASSWORD),
    });
    await setUserRoles(database.db, admin.organization.id, developer.id, [
      await builtinRoleId(database.db, admin.organization.id, 'developer'),
    ]);

    const shown = await get(
      app,
      `${PREFIX}/inquiries/${seeded.inquiry.id}`,
      await signIn(app, admin.user.email),
    );
    const hidden = await get(
      app,
      `${PREFIX}/inquiries/${seeded.inquiry.id}`,
      await signIn(app, developer.email),
    );

    // Both verifications can share a created_at millisecond, and the id tiebreak is random within
    // it, so the government ID is found by type rather than by position.
    const governmentIdOf = (body: unknown) =>
      dashboardInquiryDocumentSchema
        .parse(body)
        .included.find((resource) => resource.type === 'verification/government-id');
    expect(governmentIdOf(shown.json())).toMatchObject({
      attributes: { 'name-last': 'VALEMONT', 'extraction-sources': { 'name-last': ['viz'] } },
    });
    expect(governmentIdOf(hidden.json())).toMatchObject({
      attributes: {
        'name-last': null,
        birthdate: null,
        'extraction-sources': { 'name-last': ['viz'] },
      },
    });
    expect(hidden.body).not.toContain('VALEMONT');
  });

  it("answers 404 for another environment's inquiry", async () => {
    const { app } = await makeApp();
    const operator = await seedOperator();
    const other = await seedOperator();
    const token = await signIn(app, operator.user.email);
    const foreign = await createTestInquiry(database.db, other.environment.id);

    const response = await get(app, `${PREFIX}/inquiries/${foreign.inquiry.id}`, token);

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
  });

  it('validates the id', async () => {
    const { app } = await makeApp();
    const operator = await seedOperator();
    const token = await signIn(app, operator.user.email);

    expect((await get(app, `${PREFIX}/inquiries/not-an-id`, token)).statusCode).toBe(400);
  });
});

describe('GET /api/v1/dashboard/files/:id/content', () => {
  async function seedFiles() {
    const context = await makeApp();
    const operator = await seedOperator();
    const token = await signIn(context.app, operator.user.email);
    const seeded = await seedInquiry(operator.environment.id, context.storage);
    const [front] = seeded.files;
    if (front === undefined) throw new Error('seedInquiry made no files');
    return { ...context, ...operator, token, seeded, front };
  }

  it('streams the decrypted image, uncached, and audits the view', async () => {
    const { app, token, front, user, environment } = await seedFiles();

    const response = await get(app, `${PREFIX}/files/${front.row.id}/content`, token, '192.0.2.44');

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(front.bytes)).toBe(true);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe(FILE_CONTENT_CACHE_CONTROL);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-length']).toBe(String(front.bytes.length));

    const audit = await listAuditLogs(database.db, environment.id, {
      resourceType: 'file',
      resourceId: front.row.id,
    });
    expect(audit).toEqual([
      expect.objectContaining({
        action: FILE_VIEWED_AUDIT_ACTION,
        actorType: 'user',
        actorId: user.id,
        requestId: response.headers['x-request-id'],
        ip: '192.0.2.44',
        metadata: { kind: 'front', verificationId: front.row.verificationId },
      }),
    ]);
  });

  it("answers 404 for another environment's file and audits nothing", async () => {
    const { app, storage } = await makeApp();
    const operator = await seedOperator();
    const other = await seedOperator();
    const token = await signIn(app, operator.user.email);
    const foreign = await seedInquiry(other.environment.id, storage);
    const fileId = foreign.files[0]?.row.id ?? '';

    const response = await get(app, `${PREFIX}/files/${fileId}/content`, token);

    expect(response.statusCode).toBe(404);
    expect(
      await listAuditLogs(database.db, other.environment.id, { resourceType: 'file' }),
    ).toEqual([]);
  });

  it('answers 404 when the stored object is missing', async () => {
    const { app, token, front, objects } = await seedFiles();
    objects.delete(front.row.storageKey);

    const response = await get(app, `${PREFIX}/files/${front.row.id}/content`, token);

    expect(response.statusCode).toBe(404);
  });

  it('refuses tampered ciphertext with an opaque 500 and audits nothing', async () => {
    const { app, token, front, objects, environment } = await seedFiles();
    const ciphertext = Uint8Array.from(objects.get(front.row.storageKey) ?? []);
    ciphertext[20] = (ciphertext[20] ?? 0) ^ 0xff;
    objects.set(front.row.storageKey, ciphertext);

    const response = await get(app, `${PREFIX}/files/${front.row.id}/content`, token);

    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.headers['cache-control']).toBe(FILE_CONTENT_CACHE_CONTROL);
    expect(await listAuditLogs(database.db, environment.id, { resourceType: 'file' })).toEqual([]);
  });

  it('refuses content whose digest does not match the file record', async () => {
    const { app, token, objects, environment, seeded } = await seedFiles();
    // A validly sealed object for this file id, but with other bytes than the record describes.
    const [front] = seeded.files;
    const id = front?.row.id ?? '';
    const sealed = encryptBytes(syntheticPng(), database.keyring, { context: id });
    objects.set(front?.row.storageKey ?? '', sealed.ciphertext);
    await database.client.query('update files set wrapped_dek = $1 where id = $2', [
      sealed.wrappedDek,
      id,
    ]);

    const response = await get(app, `${PREFIX}/files/${id}/content`, token);

    expect(response.statusCode).toBe(500);
    expect(await listAuditLogs(database.db, environment.id, { resourceType: 'file' })).toEqual([]);
  });

  it('requires a session and a well-formed id', async () => {
    const { app, token, front } = await seedFiles();

    expect((await get(app, `${PREFIX}/files/${front.row.id}/content`)).statusCode).toBe(401);
    expect((await get(app, `${PREFIX}/files/not-a-file/content`, token)).statusCode).toBe(400);
  });
});

describe('caching', () => {
  it('marks every dashboard response no-store, errors included, as they carry PII', async () => {
    const { app, storage } = await makeApp();
    const operator = await seedOperator();
    const token = await signIn(app, operator.user.email);
    const { inquiry } = await seedInquiry(operator.environment.id, storage);

    const responses = await Promise.all([
      get(app, `${PREFIX}/me`, token),
      get(app, `${PREFIX}/inquiries`, token),
      get(app, `${PREFIX}/inquiries/${inquiry.id}`, token),
      get(app, `${PREFIX}/inquiries/${inquiry.id}`),
      get(app, `${PREFIX}/inquiries/inq_00000000000000000000000000`, token),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 401, 404]);
    for (const response of responses) {
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('verifications of every type (C50.6)', () => {
  it('are named by the list and served by the detail', async () => {
    const { app, storage } = await makeApp();
    const operator = await seedOperator();
    const token = await signIn(app, operator.user.email);
    const seeded = await seedInquiry(operator.environment.id, storage);
    const document = await createVerification(database.db, operator.environment.id, {
      id: testId('ver'),
      inquiryId: seeded.inquiry.id,
      type: 'document',
    });

    const list = dashboardInquiryListDocumentSchema.parse(
      (await get(app, `${PREFIX}/inquiries`, token)).json(),
    );
    const detail = dashboardInquiryDocumentSchema.parse(
      (await get(app, `${PREFIX}/inquiries/${seeded.inquiry.id}`, token)).json(),
    );

    expect(list.data[0]?.relationships.verifications.data).toEqual([
      { type: 'verification/government-id', id: seeded.governmentId.id },
      { type: 'verification/selfie', id: seeded.selfie.id },
      { type: 'verification/document', id: document.id },
    ]);
    expect(detail.included.map(({ type, id }) => [type, id])).toEqual([
      ['verification/government-id', seeded.governmentId.id],
      ['verification/selfie', seeded.selfie.id],
      ['verification/document', document.id],
      ...seeded.files.map(({ row }) => ['file', row.id]),
    ]);
  });
});

describe('the pinned template version on dashboard inquiries (C25.4, Workflow 2E)', () => {
  it('is named by the list and the detail', async () => {
    const { app, storage } = await makeApp();
    const operator = await seedOperator();
    const token = await signIn(app, operator.user.email);
    const seeded = await seedInquiry(operator.environment.id, storage);
    const pinned = {
      'inquiry-template-version': {
        data: { type: 'inquiry-template-version', id: seeded.inquiry.inquiryTemplateVersionId },
      },
    };

    const detail = dashboardInquiryDocumentSchema.parse(
      (await get(app, `${PREFIX}/inquiries/${seeded.inquiry.id}`, token)).json(),
    );
    const list = dashboardInquiryListDocumentSchema.parse(
      (await get(app, `${PREFIX}/inquiries`, token)).json(),
    );

    expect(detail.data.relationships).toMatchObject(pinned);
    expect(list.data[0]?.relationships).toMatchObject(pinned);
  });
});

describe('edge cases of the inquiry list', () => {
  it('lists nothing for an environment without inquiries', async () => {
    const { app } = await makeApp();
    const operator = await seedOperator();
    const token = await signIn(app, operator.user.email);

    const response = await get(app, `${PREFIX}/inquiries`, token);

    expect(response.json()).toEqual({ data: [], links: { next: null } });
  });

  it('turns a database failure into an opaque 500, not a cursor error', async () => {
    const operator = await seedOperator();
    const token = await signIn((await makeApp()).app, operator.user.email);
    const broken = await createTestDatabase();
    await broken.close();
    // The session still resolves (operator auth uses the live database); the routes' does not.
    const { app } = await makeApp({ db: broken.db });

    const response = await get(app, `${PREFIX}/inquiries`, token);

    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
  }, 60_000);
});

describe('filters in the next link', () => {
  it('keeps the reference-id filter', async () => {
    const { app } = await makeApp();
    const operator = await seedOperator();
    const token = await signIn(app, operator.user.email);
    for (let index = 0; index < 2; index += 1) {
      await createTestInquiry(database.db, operator.environment.id, { referenceId: 'ref-shared' });
    }

    const page = dashboardInquiryListDocumentSchema.parse(
      (
        await get(app, `${PREFIX}/inquiries?filter[reference-id]=ref-shared&page[size]=1`, token)
      ).json(),
    );

    const next = new URL(page.links.next ?? '', 'http://dashboard.invalid');
    expect(next.searchParams.get('filter[reference-id]')).toBe('ref-shared');
    expect(next.searchParams.has('filter[status]')).toBe(false);
  });
});

describe('OpenAPI', () => {
  it("documents every C4 operation under the 'dashboard' tag with the user session scheme", async () => {
    const { app } = await makeApp();

    const response = await app.inject({ url: '/openapi.json' });
    const document = response.json<{
      paths: Record<string, Record<string, { tags?: string[]; security?: unknown }>>;
      components: { securitySchemes: Record<string, unknown> };
    }>();

    expect(response.statusCode).toBe(200);
    // The routes register the scheme they reference, next to the app's own API key scheme.
    expect(document.components.securitySchemes).toEqual({
      apiKey: expect.objectContaining({ type: 'http', scheme: 'bearer' }) as unknown,
      ...USER_SESSION_SECURITY_SCHEME,
    });
    const operations = [
      ['post', `${PREFIX}/sessions`],
      ['delete', `${PREFIX}/sessions/current`],
      ['get', `${PREFIX}/me`],
      ['get', `${PREFIX}/inquiries`],
      ['get', `${PREFIX}/inquiries/{id}`],
      ['get', `${PREFIX}/files/{id}/content`],
    ] as const;
    for (const [method, path] of operations) {
      const operation = document.paths[path]?.[method];
      expect(operation?.tags, `${method} ${path}`).toEqual([DASHBOARD_TAG]);
      expect(operation?.security, `${method} ${path}`).toEqual(
        path.endsWith('/sessions') ? [] : [{ userSession: [] }],
      );
    }
    // The zod schemas are still converted to JSON Schema.
    expect(JSON.stringify(document.paths[`${PREFIX}/sessions`])).toContain('"password"');
    const content = document.paths[`${PREFIX}/files/{id}/content`]?.get as unknown as {
      responses: Record<string, { content: Record<string, { schema: unknown }> }>;
    };
    // C52.4: a PDF document is served too, as an attachment.
    expect(Object.keys(content.responses['200']?.content ?? {})).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ]);
    expect(content.responses['200']?.content['image/png']?.schema).toEqual({
      type: 'string',
      format: 'binary',
    });
  });

  it('references the shared contract components and documents problem+json errors', async () => {
    const { app } = await makeApp();

    const document = (await app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    }>();
    const operation = (method: string, path: string) =>
      document.paths[`${PREFIX}${path}`]?.[method]?.responses ?? {};

    // Same component names as the server API, instead of inlined copies.
    expect(JSON.stringify(operation('get', '/inquiries/{id}')['200'])).toContain(
      '#/components/schemas/Inquiry',
    );
    expect(JSON.stringify(operation('get', '/inquiries')['200'])).toContain(
      '#/components/schemas/Inquiry',
    );
    const errors: [string, string, string[]][] = [
      ['post', '/sessions', ['400', '401', '429']],
      ['delete', '/sessions/current', ['401']],
      ['get', '/me', ['401']],
      ['get', '/inquiries', ['400', '401']],
      ['get', '/inquiries/{id}', ['400', '401', '404']],
      ['get', '/files/{id}/content', ['400', '401', '404', '500']],
    ];
    for (const [method, path, statuses] of errors) {
      const responses = operation(method, path);
      for (const status of statuses) {
        expect(JSON.stringify(responses[status]), `${method} ${path} ${status}`).toContain(
          '"application/problem+json"',
        );
      }
    }
  });

  it('exports the security scheme the OpenAPI document needs', () => {
    expect(DASHBOARD_TAG).toBe('dashboard');
    expect(USER_SESSION_SECURITY_SCHEME).toEqual({
      userSession: {
        type: 'http',
        scheme: 'bearer',
        description: 'Dashboard user session token sent as "Authorization: Bearer <ovu_...>".',
      },
    });
  });
});

describe('GET /api/v1/dashboard/inquiries/:id with selfie captures (C40.1, C47)', () => {
  /** Two captures of the seeded selfie: an errored one, then the open one. */
  async function seedCaptures(environmentId: string, inquiryId: string, verificationId: string) {
    const ids = [];
    for (const [index, at] of [T0 - 60_000, T0].entries()) {
      const id = testId('self');
      await createSelfieCapture(database.db, environmentId, {
        id,
        verificationId,
        inquiryId,
        method: 'camera',
        liveness: 'active',
        prompts: ['center', 'left', 'right'],
        nonceSha256: new Uint8Array(32).fill(index + 1),
        createdAt: new Date(at),
        expiresAt: new Date(at + 180_000),
      });
      if (index === 0) {
        await errorOpenSelfieCaptures(database.db, environmentId, verificationId, 'superseded');
      }
      ids.push(id);
    }
    return ids;
  }

  it('includes the captures, newest first, never their nonce or device', async () => {
    const { app, storage } = await makeApp();
    const operator = await seedOperator();
    const token = await signIn(app, operator.user.email);
    const seeded = await seedInquiry(operator.environment.id, storage);
    const [older, newer] = await seedCaptures(
      operator.environment.id,
      seeded.inquiry.id,
      seeded.selfie.id,
    );

    const response = await get(app, `${PREFIX}/inquiries/${seeded.inquiry.id}`, token);

    const body = dashboardInquiryDocumentSchema.parse(response.json());
    const captures = body.included.filter((resource) => resource.type === 'selfie');
    expect(captures.map((capture) => [capture.id, capture.attributes.status])).toEqual([
      [newer, 'initiated'],
      [older, 'errored'],
    ]);
    expect(body.data.relationships.selfies?.data.map((link) => link.id)).toEqual([newer, older]);
    const selfie = body.included.find((resource) => resource.id === seeded.selfie.id);
    expect(selfie?.type === 'verification/selfie' && selfie.relationships.selfies?.data).toEqual([
      { type: 'selfie', id: newer },
      { type: 'selfie', id: older },
    ]);
  });

  it('tells a reviewer which verifications came from a rejected handoff (C96.3)', async () => {
    const { app, storage } = await makeApp();
    const operator = await seedOperator();
    const token = await signIn(app, operator.user.email);
    const seeded = await seedInquiry(operator.environment.id, storage);
    await database.db.execute(
      sql`update verifications set from_rejected_handoff = true where id = ${seeded.selfie.id}`,
    );

    const response = await get(app, `${PREFIX}/inquiries/${seeded.inquiry.id}`, token);

    const body = dashboardInquiryDocumentSchema.parse(response.json());
    const selfie = body.included.find((resource) => resource.id === seeded.selfie.id);
    expect(selfie?.attributes).toMatchObject({ 'from-rejected-handoff': true });
  });

  it('leaves the captures out without verifications:read', async () => {
    const { app, storage } = await makeApp();
    const admin = await seedOperator();
    const seeded = await seedInquiry(admin.environment.id, storage);
    await seedCaptures(admin.environment.id, seeded.inquiry.id, seeded.selfie.id);
    const viewer = await createUser(database.db, {
      id: testId('usr'),
      organizationId: admin.organization.id,
      email: `capture-viewer-${String((emailCounter += 1))}@example.test`,
      passwordHash: encodeFake(PASSWORD),
    });
    const role = await createRole(database.db, admin.organization.id, {
      id: testId('role'),
      name: 'Synthetic Inquiry Reader',
      permissions: ['inquiries:read'],
    });
    await setUserRoles(database.db, admin.organization.id, viewer.id, [role.id]);

    const response = await get(
      app,
      `${PREFIX}/inquiries/${seeded.inquiry.id}`,
      await signIn(app, viewer.email),
    );

    expect(response.statusCode).toBe(200);
    expect(dashboardInquiryDocumentSchema.parse(response.json()).included).toEqual([]);
  });
});
