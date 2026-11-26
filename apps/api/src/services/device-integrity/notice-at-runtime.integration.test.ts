/**
 * Workflow 10D review, A001 (C211.9 at run time) against Postgres 17 (Testcontainers), through the
 * flow routes with the SDK's `User-Agent` and `OpenVerify-Flow-Spec: 2`.
 *
 * `play_integrity_notice_missing` is a publish rule, and it applies only while a `deviceIntegrity`
 * provider is bound. A flow published before the provider was bound can therefore show
 * `notice.session-integrity` without `notice.play-integrity`, the notice that names Google as a
 * recipient. Once the operator binds the provider, the inquiries pinned to that version must still
 * never be asked for a token: the session reads `integrity.request: false`, the challenge route
 * answers 409 `integrity_challenge_invalid` and stores no challenge. A session whose consent showed
 * both notices is asked as before.
 *
 * Every id, token and value is synthetic; no test reaches a Google endpoint.
 */
import { randomBytes } from 'node:crypto';
import { FLOW_SPEC_HEADER, newId } from '@openverify/contracts';
import {
  createDatabase,
  createInquirySession,
  createKeyring,
  getInquiry,
  getInquiryTemplateVersion,
  hashSessionToken,
  recordInquirySessionConsent,
  runMigrations,
  setDefaultKeyring,
  transitionInquiryStatus,
  type Database,
  type Keyring,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import { flowV2Schema, type FlowV2 } from '@openverify/flow-spec';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { systemClock, ulidIdGenerator, type ProviderBindings } from '../../ports.js';
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
import { createDbAccountsService } from '../inquiries.test-support.js';
import { flowPublishReport } from '../publish/flow-v2.js';
import { createDeviceIntegrityProvider } from './index.js';

const FLOW = '/api/v1/flow';
const SDK_AGENT = 'OpenVerify-Android/0.1.0';
const SESSION_NOTICE = 'notice.session-integrity';
const PLAY_NOTICE = 'notice.play-integrity';
const RULE = 'play_integrity_notice_missing';

let postgres: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;
let environmentId: string;
let keyring: Keyring;
/** The same database served by an install with no provider, and by one that binds it. */
let unbound: ReturnType<typeof buildApp> | undefined;
let bound: ReturnType<typeof buildApp> | undefined;

function appWith(providers: ProviderBindings | undefined): ReturnType<typeof buildApp> {
  const phase5 = phase5TestDependencies();
  return buildApp({
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
      ...phase5,
      ...(providers === undefined ? {} : { providers }),
    },
  });
}

beforeAll(async () => {
  postgres = await startIntegrationPostgres();
  pool = createIntegrationPool(postgres.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  keyring = createKeyring(randomBytes(32));
  setDefaultKeyring(keyring);
  await runMigrations(db);
  environmentId = (await createTestTenant(db)).environment.id;
  unbound = appWith(undefined);
  bound = appWith({
    sandbox: { deviceIntegrity: createDeviceIntegrityProvider('sandbox') },
    production: {},
  });
  await unbound.ready();
  await bound.ready();
}, 180_000);

afterAll(async () => {
  await unbound?.close();
  await bound?.close();
  await pool?.end();
  await postgres?.stop();
  setDefaultKeyring(undefined);
});

/** A v2 flow: a consent showing `textKeys`, a one-sided ID, completion. */
function flowShowing(textKeys: string[]): FlowV2 {
  return flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'integrity-notice', version: 1, name: 'Integrity notice' },
    entry: 'consent',
    steps: [
      { id: 'consent', type: 'consent', textKeys, required: true },
      {
        id: 'id_card',
        type: 'government_id',
        sides: 'front',
        maxAttempts: 2,
        captureMethods: ['camera'],
      },
      { id: 'done', type: 'completion' },
    ],
    edges: [
      { id: 'e1', from: 'consent', port: 'next', to: 'id_card' },
      { id: 'e2', from: 'id_card', port: 'next', to: 'done' },
    ],
  });
}

interface Opened {
  inquiryId: string;
  token: string;
}

/** An inquiry pinned to `flow` whose person accepted the consent that shows `textKeys`. */
async function consentedOn(flow: FlowV2, textKeys: string[]): Promise<Opened> {
  const { inquiry } = await createTestInquiry(db, environmentId, { flow });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const token = `ovs_synthetic${randomBytes(32).toString('base64url').slice(0, 34)}`;
  const session = await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await recordInquirySessionConsent(db, environmentId, session.id, {
    acceptedAt: new Date(),
    textKeys,
    optionalTextKeys: [],
    locale: 'en',
    ip: null,
    userAgent: null,
  });
  return { inquiryId: inquiry.id, token };
}

async function call(
  server: ReturnType<typeof buildApp> | undefined,
  method: 'GET' | 'POST',
  url: string,
  token: string,
) {
  if (server === undefined) {
    throw new Error('the app did not start');
  }
  const response = await server.inject({
    method,
    url: `${FLOW}${url}`,
    headers: {
      'user-agent': SDK_AGENT,
      [FLOW_SPEC_HEADER.toLowerCase()]: '2',
      authorization: `Bearer ${token}`,
    },
    remoteAddress: '192.0.2.10',
    ...(method === 'POST' ? { payload: {} } : {}),
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

/** Whether the publish rule refuses the inquiry's pinned version, bound or not. */
async function publishRefuses(inquiryId: string, deviceIntegrityBound: boolean): Promise<boolean> {
  const inquiry = await getInquiry(db, environmentId, inquiryId);
  const version =
    inquiry === null
      ? null
      : await getInquiryTemplateVersion(db, environmentId, inquiry.inquiryTemplateVersionId);
  if (version === null) {
    throw new Error('the inquiry pins no version');
  }
  const report = await flowPublishReport(db, {
    environment: { id: environmentId, kind: 'sandbox' },
    templateId: version.inquiryTemplateId,
    version,
    deviceIntegrityBound,
  });
  return report.problems.some(({ code }) => code === RULE);
}

async function challengesOf(inquiryId: string): Promise<{ id: string }[]> {
  if (pool === undefined) {
    throw new Error('the pool did not start');
  }
  const found = await pool.query<{ id: string }>(
    'select id from inquiry_integrity_challenges where inquiry_id = $1',
    [inquiryId],
  );
  return found.rows;
}

describe('a flow published before the provider was bound (A001; C211.9)', () => {
  it('is never asked for a token once the provider is bound', async () => {
    const keys = ['consent.processing', SESSION_NOTICE];
    const target = await consentedOn(flowShowing(keys), keys);
    // Published while nothing was bound: the rule does not apply; today it would refuse it.
    expect(await publishRefuses(target.inquiryId, false)).toBe(false);
    expect(await publishRefuses(target.inquiryId, true)).toBe(true);
    expect((await call(unbound, 'GET', '/session', target.token)).body).not.toHaveProperty(
      'integrity',
    );

    // The operator binds the provider; the inquiry still pins the version it started on.
    const session = await call(bound, 'GET', '/session', target.token);
    const challenge = await call(bound, 'POST', '/integrity-challenges', target.token);

    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({
      signals: { integrity: true },
      integrity: { request: false },
    });
    expect(challenge.status).toBe(409);
    expect(challenge.body).toMatchObject({ code: 'integrity_challenge_invalid' });
    expect(await challengesOf(target.inquiryId)).toEqual([]);
  });

  it('is asked when its consent showed the notice naming Google', async () => {
    const keys = ['consent.processing', SESSION_NOTICE, PLAY_NOTICE];
    const target = await consentedOn(flowShowing(keys), keys);
    expect(await publishRefuses(target.inquiryId, true)).toBe(false);

    const session = await call(bound, 'GET', '/session', target.token);
    const challenge = await call(bound, 'POST', '/integrity-challenges', target.token);

    expect(session.body).toMatchObject({ integrity: { request: true } });
    expect(challenge.status).toBe(201);
    expect(await challengesOf(target.inquiryId)).toHaveLength(1);
  });
});
