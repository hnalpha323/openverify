/**
 * C10 one-time link redemption against Postgres 17 (Testcontainers): concurrent redeems of one
 * link race on separate connections, and exactly one of them gets a session.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { newOneTimeLinkToken } from '@openverify/contracts';
import {
  createDatabase,
  createKeyring,
  createOneTimeLink,
  hashSessionToken,
  runMigrations,
  setDefaultKeyring,
  type Database,
  type Keyring,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { systemClock, ulidIdGenerator } from '../../ports.js';
import { createDbAccountsService } from '../../services/inquiries.test-support.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  createRecordingQueue,
  createRecordingRedactionService,
  phase5TestDependencies,
} from '../../test-support/fakes.js';

const REDEEM = '/api/v1/flow/one-time-links/redeem';

let postgres: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;
let keyring: Keyring;
let environmentId: string;
let app: ReturnType<typeof buildApp> | undefined;

beforeAll(async () => {
  postgres = await startIntegrationPostgres();
  pool = createIntegrationPool(postgres.getConnectionUri(), { max: 12 });
  db = createDatabase(pool);
  keyring = createKeyring(randomBytes(32));
  setDefaultKeyring(keyring);
  await runMigrations(db);
  environmentId = (await createTestTenant(db)).environment.id;
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

/** A fresh inquiry with one unused link; returns the redeem body. */
async function link(): Promise<{ 'inquiry-id': string; 'one-time-token': string }> {
  const { inquiry } = await createTestInquiry(db, environmentId);
  const token = newOneTimeLinkToken();
  await createOneTimeLink(db, environmentId, {
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { 'inquiry-id': inquiry.id, 'one-time-token': token };
}

describe('POST /api/v1/flow/one-time-links/redeem on Postgres', () => {
  it('lets exactly one of several concurrent redeems of a link succeed', async () => {
    const server = app;
    if (server === undefined) {
      throw new Error('the app did not start');
    }
    for (let round = 0; round < 10; round += 1) {
      const body = await link();

      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          server.inject({ method: 'POST', url: REDEEM, payload: body, remoteAddress: '192.0.2.8' }),
        ),
      );

      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401, 401, 401]);
      const sessions = await pool?.query<{ count: number }>(
        'select count(*)::int as count from inquiry_sessions where inquiry_id = $1',
        [body['inquiry-id']],
      );
      expect(sessions?.rows[0]?.count).toBe(1);
    }
  });
});
