/**
 * C200.2, C221.12 (Workflow 10A, api-android-10a; reviews H07, F06, V13; 10A decision 6) against
 * Postgres 17 (Testcontainers): the flow session serves the environment's `organization-display-name`
 * NFC-normalised (a name saved decomposed is served composed), `null` while it is unset; and the
 * settings service refuses on save a name whose first character is not a stable NFC boundary
 * (canonical combining class 0 and NFC_Quick_Check=Yes: no combining mark, no conjoining Hangul
 * vowel or final consonant), through the settings route's validation problem, so a consent text a
 * device fills with the served name has the digest the server takes. Every value is synthetic, and
 * every character outside ASCII is built from its code point.
 */
import { randomBytes } from 'node:crypto';
import { FLOW_SPEC_HEADER, newId } from '@openverify/contracts';
import {
  createDatabase,
  createInquirySession,
  createKeyring,
  getEnvironment,
  hashSessionToken,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import { flowV2Schema } from '@openverify/flow-spec';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { UnprocessableContentError } from '../errors.js';
import { systemClock, ulidIdGenerator } from '../ports.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  createRecordingQueue,
  createRecordingRedactionService,
  phase5TestDependencies,
} from '../test-support/fakes.js';
import { createDbAccountsService } from './inquiries.test-support.js';
import { updateDashboardSettings } from './settings.js';

const cp = (...codes: readonly number[]): string => String.fromCodePoint(...codes);

let postgres: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;
let app: ReturnType<typeof buildApp> | undefined;

beforeAll(async () => {
  postgres = await startIntegrationPostgres();
  pool = createIntegrationPool(postgres.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  const keyring = createKeyring(randomBytes(32));
  setDefaultKeyring(keyring);
  await runMigrations(db);
  app = buildApp({
    lookupApiKey: () => Promise.resolve(null),
    logger: false,
    mode: 'test',
    api: {
      db,
      keyring,
      storage: createInMemoryFileStorage(),
      events: createRecordingEventPublisher(),
      queue: createRecordingQueue(),
      clock: systemClock,
      ids: ulidIdGenerator,
      flowPublicUrl: 'https://flow.example.test',
      flowCorsOrigins: ['https://flow.example.test'],
      accounts: createDbAccountsService(),
      redaction: createRecordingRedactionService(),
      audit: createRecordingAuditLogger(),
      rateLimiter: createAllowAllRateLimiter(),
      mailer: createCapturingMailer(),
      ...phase5TestDependencies(),
    },
  });
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await postgres?.stop();
  setDefaultKeyring(undefined);
});

const FLOW = flowV2Schema.parse({
  metadata: { specVersion: 2, id: 'organization-name', version: 1, name: 'Organization name' },
  entry: 'consent',
  steps: [
    { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
    { id: 'done', type: 'completion' },
  ],
  edges: [{ id: 'e1', from: 'consent', port: 'next', to: 'done' }],
});

/** A fresh tenant: its context and actor for the settings service. */
async function tenant() {
  const { organization, environment } = await createTestTenant(db);
  return {
    ctx: { organizationId: organization.id, environmentId: environment.id },
    actor: { type: 'user' as const, id: newId('usr') },
  };
}

const save = (
  { ctx, actor }: Awaited<ReturnType<typeof tenant>>,
  name: string | null,
): Promise<unknown> =>
  updateDashboardSettings(
    db,
    createRecordingAuditLogger(),
    ctx,
    actor,
    { 'organization-display-name': name },
    100,
  );

/** What the flow session of a fresh inquiry of `environmentId` serves as the name. */
async function served(environmentId: string): Promise<unknown> {
  const server = app;
  if (server === undefined) {
    throw new Error('the app did not start');
  }
  const { inquiry } = await createTestInquiry(db, environmentId, { flow: FLOW });
  const token = `ovs_synthetic${randomBytes(32).toString('base64url').slice(0, 34)}`;
  await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const response = await server.inject({
    method: 'GET',
    url: '/api/v1/flow/session',
    headers: {
      'user-agent': 'OpenVerify-Android/0.1.0',
      [FLOW_SPEC_HEADER.toLowerCase()]: '2',
      authorization: `Bearer ${token}`,
    },
    remoteAddress: '192.0.2.11',
  });
  expect(response.statusCode).toBe(200);
  const body = response.json<Record<string, unknown>>();
  expect(body).toHaveProperty('organization-display-name');
  return body['organization-display-name'];
}

describe('organization-display-name on the flow session (C200.2, C221.12)', () => {
  it('serves null while the setting is unset', async () => {
    const { ctx } = await tenant();
    expect(await served(ctx.environmentId)).toBeNull();
  });

  it('serves a name saved decomposed in its NFC form, and stores it as saved', async () => {
    const owner = await tenant();
    const decomposed = `Cafe${cp(0x0301)} Exemple`;
    await save(owner, decomposed);

    const name = await served(owner.ctx.environmentId);

    expect(name).toBe(`Caf${cp(0x00e9)} Exemple`);
    expect(name).toBe(decomposed.normalize('NFC'));
    expect(
      (await getEnvironment(db, owner.ctx.environmentId))?.settings['organization-display-name'],
    ).toBe(decomposed);
  });

  it('serves a Korean name of precomposed syllables and an Arabic name unchanged', async () => {
    for (const name of [
      cp(0xd55c, 0xad6d, 0x0020, 0xc778, 0xc99d),
      cp(0x0634, 0x0631, 0x0643, 0x0629, 0x0020, 0x0627, 0x0644, 0x062a, 0x062d, 0x0642, 0x0642),
    ]) {
      const owner = await tenant();
      await save(owner, name);
      expect(await served(owner.ctx.environmentId)).toBe(name);
    }
  });
});

describe('the display name refused on save (C200.2; review V13)', () => {
  it.each([
    ['a combining acute accent', `${cp(0x0301)}Exemple`],
    ['a Hangul vowel (U+1161)', `${cp(0x1161)}${cp(0xad6d)}`],
    ['a Hangul final consonant (U+11A8)', `${cp(0x11a8)}Example`],
    ['a Tamil vowel sign that composes (U+0BBE)', `${cp(0x0bbe)}Example`],
    ['the angstrom sign, which NFC replaces', `${cp(0x212b)}ngstrom Labs`],
  ])('refuses a name that starts with %s, and keeps the setting', async (_name, name) => {
    const owner = await tenant();
    await save(owner, 'Example Verification Ltd');

    const refused = await save(owner, name).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refused).toBeInstanceOf(UnprocessableContentError);
    expect(refused).toMatchObject({
      status: 422,
      errors: [{ location: 'body', pointer: '/organization-display-name' }],
    });
    expect(await served(owner.ctx.environmentId)).toBe('Example Verification Ltd');
  });

  it('still clears the name with null', async () => {
    const owner = await tenant();
    await save(owner, 'Example Verification Ltd');
    await save(owner, null);
    expect(await served(owner.ctx.environmentId)).toBeNull();
  });
});
