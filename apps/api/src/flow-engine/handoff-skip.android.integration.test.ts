/**
 * C221.13 (Workflow 10A, api-android-10a; Phase 7 C96.1 amended; reviews H20, V05) against
 * Postgres 17 (Testcontainers): the server skips a `device_handoff` step for every session whose
 * `mobile-sdk-name` is set, whatever the step's `skipOnMobile` says, because the handoff's target
 * would be the same phone. The position never rests on the step for such a session: the engine
 * leaves it through `next` (outcome `skipped`) before the session is answered, so the Android SDK
 * renders the next step. A browser session stops at the step either way (Phase 7's view-only skip
 * of a phone's browser is unchanged). Driven through the flow routes with the SDK's `User-Agent`
 * and `OpenVerify-Flow-Spec: 2`; every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { FLOW_SPEC_HEADER, newId } from '@openverify/contracts';
import {
  createDatabase,
  createInquirySession,
  createKeyring,
  getInquiry,
  hashSessionToken,
  listInquiryFlowSteps,
  runMigrations,
  setDefaultKeyring,
  updateEnvironmentSettings,
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
import { systemClock, ulidIdGenerator } from '../ports.js';
import { createDbAccountsService } from '../services/inquiries.test-support.js';
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

const FLOW = '/api/v1/flow';
/** The SDK's `User-Agent` (Phase 7 C94.5): the server reads it as `mobile-sdk-name`. */
const SDK_AGENT = 'OpenVerify-Android/0.1.0';
const DESKTOP_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CONSENT_BODY = { accepted: true, 'text-keys': ['consent.processing'], locale: 'en' };

let postgres: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;
let environmentId: string;
let app: ReturnType<typeof buildApp> | undefined;

beforeAll(async () => {
  postgres = await startIntegrationPostgres();
  pool = createIntegrationPool(postgres.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  const keyring = createKeyring(randomBytes(32));
  setDefaultKeyring(keyring);
  await runMigrations(db);
  environmentId = (await createTestTenant(db)).environment.id;
  // C96.2 (Phase 7): a handoff step names the organisation on the phone.
  await updateEnvironmentSettings(db, environmentId, {
    'organization-display-name': 'Example Verification Ltd',
  });
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

const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

/** consent -> device_handoff (with `skipOnMobile`) -> about (a screen) -> done. */
const flowWith = (skipOnMobile: boolean) =>
  flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'handoff-skip', version: 1, name: 'Handoff skip' },
    entry: 'consent',
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
      { id: 'handoff', type: 'device_handoff', skipOnMobile },
      {
        id: 'about',
        type: 'screen',
        components: [
          { id: 'nick', kind: 'text_input', field: 'nickname', labelKey: 'about.nickname' },
          { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
        ],
      },
      { id: 'done', type: 'completion' },
    ],
    edges: [
      edge('e1', 'consent', 'next', 'handoff'),
      edge('e2', 'handoff', 'next', 'about'),
      edge('e3', 'about', 'next', 'done'),
    ],
  });

interface Session {
  position?: { 'step-id': string | null; state: string };
  step?: { id: string; type: string };
}

/** A fresh inquiry of `flowWith(skipOnMobile)` and a flow session token for it. */
async function inquiryWithSession(
  skipOnMobile: boolean,
): Promise<{ inquiryId: string; token: string }> {
  const { inquiry } = await createTestInquiry(db, environmentId, { flow: flowWith(skipOnMobile) });
  const token = `ovs_synthetic${randomBytes(32).toString('base64url').slice(0, 34)}`;
  await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { inquiryId: inquiry.id, token };
}

async function call(
  method: 'GET' | 'POST',
  url: string,
  token: string,
  agent: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: Session }> {
  const server = app;
  if (server === undefined) {
    throw new Error('the app did not start');
  }
  const response = await server.inject({
    method,
    url: `${FLOW}${url}`,
    headers: {
      'user-agent': agent,
      [FLOW_SPEC_HEADER.toLowerCase()]: '2',
      authorization: `Bearer ${token}`,
    },
    remoteAddress: '192.0.2.10',
    ...(payload === undefined ? {} : { payload }),
  });
  return { status: response.statusCode, body: response.json<Session>() };
}

/** Reads the session, consents, and reads it again, as the SDK's driver does (C193.3). */
async function consentAndRead(token: string, agent: string): Promise<Session> {
  const first = await call('GET', '/session', token, agent);
  expect(first.status).toBe(200);
  expect(first.body.position).toMatchObject({ 'step-id': 'consent', state: 'active' });
  expect((await call('POST', '/consent', token, agent, CONSENT_BODY)).status).toBe(201);
  const after = await call('GET', '/session', token, agent);
  expect(after.status).toBe(200);
  return after.body;
}

describe('the device_handoff skip for a native SDK session (C221.13)', () => {
  it.each([false, true])(
    'moves an SDK session past a handoff step with skipOnMobile %s',
    async (skipOnMobile) => {
      const { inquiryId, token } = await inquiryWithSession(skipOnMobile);

      const session = await consentAndRead(token, SDK_AGENT);

      expect(session.position).toMatchObject({ 'step-id': 'about', state: 'active' });
      expect(session.step).toMatchObject({ id: 'about', type: 'screen' });
      expect(await getInquiry(db, environmentId, inquiryId)).toMatchObject({
        flowStepId: 'about',
        flowState: 'active',
      });
      const handoff = (await listInquiryFlowSteps(db, environmentId, inquiryId)).find(
        (entry) => entry.stepId === 'handoff',
      );
      expect(handoff).toMatchObject({ exitPort: 'next', outcome: 'skipped' });
    },
  );

  it.each([false, true])(
    'keeps a browser session at a handoff step with skipOnMobile %s',
    async (skipOnMobile) => {
      const { inquiryId, token } = await inquiryWithSession(skipOnMobile);

      const session = await consentAndRead(token, DESKTOP_AGENT);

      expect(session.position).toMatchObject({ 'step-id': 'handoff', state: 'active' });
      expect(session.step).toMatchObject({ id: 'handoff', type: 'device_handoff' });
      expect(await getInquiry(db, environmentId, inquiryId)).toMatchObject({
        flowStepId: 'handoff',
      });
      const handoff = (await listInquiryFlowSteps(db, environmentId, inquiryId)).find(
        (entry) => entry.stepId === 'handoff',
      );
      expect(handoff).toMatchObject({ exitPort: null });
    },
  );

  it('skips a handoff step an SDK session meets first, and two in a row', async () => {
    const flow = flowV2Schema.parse({
      metadata: { specVersion: 2, id: 'handoff-first', version: 1, name: 'Handoff first' },
      entry: 'first',
      steps: [
        { id: 'first', type: 'device_handoff', skipOnMobile: false },
        { id: 'second', type: 'device_handoff', skipOnMobile: false },
        { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
        { id: 'done', type: 'completion' },
      ],
      edges: [
        edge('e1', 'first', 'next', 'second'),
        edge('e2', 'second', 'next', 'consent'),
        edge('e3', 'consent', 'next', 'done'),
      ],
    });
    const { inquiry } = await createTestInquiry(db, environmentId, { flow });
    const token = `ovs_synthetic${randomBytes(32).toString('base64url').slice(0, 34)}`;
    await createInquirySession(db, environmentId, {
      id: newId('iqse'),
      inquiryId: inquiry.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const { status, body } = await call('GET', '/session', token, SDK_AGENT);

    expect(status).toBe(200);
    expect(body.position).toMatchObject({ 'step-id': 'consent', state: 'active' });
    const record = await listInquiryFlowSteps(db, environmentId, inquiry.id);
    expect(record.map(({ stepId, exitPort, outcome }) => [stepId, exitPort, outcome])).toEqual([
      ['first', 'next', 'skipped'],
      ['second', 'next', 'skipped'],
      ['consent', null, null],
    ]);
  });
});
