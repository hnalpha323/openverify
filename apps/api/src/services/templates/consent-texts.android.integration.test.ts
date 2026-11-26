/**
 * C162.9, C200.3, C200.4 (Workflow 10A, api-android-10a) against Postgres 17 (Testcontainers): the
 * server's consent digest check accepts a consent whose `text-sha256` is an Android row's digest
 * (`android-consent-digests.json`, the server's own fill and hash) at the environment's retention,
 * and refuses a wrong digest with 422 `consent_text_mismatch`, recording nothing. Driven through
 * `POST /api/v1/flow/consent` with the SDK's `User-Agent`; every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FLOW_SPEC_HEADER, newId } from '@openverify/contracts';
import {
  createDatabase,
  createInquirySession,
  createKeyring,
  getLatestInquiryConsent,
  hashSessionToken,
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
import { buildApp } from '../../app.js';
import { systemClock, ulidIdGenerator } from '../../ports.js';
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

interface DigestCase {
  'catalog-version': string;
  key: string;
  locale: string;
  values: { days: string; organization?: string };
  'text-sha256': string;
}

const ALL_VECTORS = JSON.parse(
  readFileSync(
    new URL('../../../../../contracts/fixtures/i18n/android-consent-digests.json', import.meta.url),
    'utf8',
  ),
) as { cases: (DigestCase & { 'copy-source'?: string })[] };

/** The built-in cases (KP10-9 added custom-copy ones, which name no catalog version). */
const VECTORS = { cases: ALL_VECTORS.cases.filter((entry) => entry['copy-source'] === undefined) };

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

/** The newest Android catalog version's case of `key` in `locale` at `days`, without a name. */
function vector(key: string, locale: string, days: string): DigestCase {
  const versions = [...new Set(VECTORS.cases.map((entry) => entry['catalog-version']))];
  const newest = versions.at(-1);
  const found = VECTORS.cases.find(
    (entry) =>
      entry['catalog-version'] === newest &&
      entry.key === key &&
      entry.locale === locale &&
      entry.values.days === days &&
      entry.values.organization === undefined,
  );
  if (found === undefined) {
    throw new Error(`no Android digest of ${key} in ${locale} at ${days} days`);
  }
  return found;
}

/**
 * A consent step showing `keys` (and offering `optional`), its inquiry in a fresh environment with
 * `days` of face-template retention, and a flow session token.
 */
async function consentStep(
  keys: readonly string[],
  days: number,
  optional: readonly string[] = [],
): Promise<{ environmentId: string; inquiryId: string; token: string }> {
  const environmentId = (await createTestTenant(db)).environment.id;
  await updateEnvironmentSettings(db, environmentId, { 'face-template-retention-days': days });
  const flow = flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'android-consent', version: 1, name: 'Android consent' },
    entry: 'consent',
    steps: [
      {
        id: 'consent',
        type: 'consent',
        textKeys: [...keys],
        ...(optional.length === 0 ? {} : { optionalTextKeys: [...optional] }),
        required: true,
      },
      { id: 'done', type: 'completion' },
    ],
    edges: [{ id: 'e1', from: 'consent', port: 'next', to: 'done' }],
  });
  const { inquiry } = await createTestInquiry(db, environmentId, { flow });
  const token = `ovs_synthetic${randomBytes(32).toString('base64url').slice(0, 34)}`;
  await createInquirySession(db, environmentId, {
    id: newId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { environmentId, inquiryId: inquiry.id, token };
}

async function consent(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; code: unknown }> {
  const server = app;
  if (server === undefined) {
    throw new Error('the app did not start');
  }
  const headers = {
    'user-agent': 'OpenVerify-Android/0.1.0',
    [FLOW_SPEC_HEADER.toLowerCase()]: '2',
    authorization: `Bearer ${token}`,
  };
  const session = await server.inject({ method: 'GET', url: '/api/v1/flow/session', headers });
  expect(session.statusCode).toBe(200);
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/flow/consent',
    headers,
    payload: body,
    remoteAddress: '192.0.2.12',
  });
  const answer = response.json<{ code?: unknown }>();
  return { status: response.statusCode, code: answer.code };
}

describe('the consent digest check over the Android rows (C162.9, C200.3)', () => {
  const keys = ['consent.biometric', 'consent.processing', 'notice.session-integrity'];

  it.each(['en', 'ar'])(
    'accepts the Android texts in %s by their digests at the environment retention',
    async (locale) => {
      const step = await consentStep(keys, 30);
      const digests = keys.map((key) => vector(key, locale, '30'));

      const { status } = await consent(step.token, {
        accepted: true,
        'text-keys': keys,
        locale,
        'text-sha256': digests.map((entry) => entry['text-sha256']),
        'copy-source': 'built-in',
        'catalog-version': digests[0]?.['catalog-version'],
      });

      expect(status).toBe(201);
      const recorded = await getLatestInquiryConsent(db, step.environmentId, step.inquiryId);
      expect(recorded).toMatchObject({ textKeys: keys, locale });
    },
  );

  it('accepts the optional matching text with its days filled, at the default retention', async () => {
    const step = await consentStep(['consent.biometric'], 365, ['consent.biometric-matching']);
    const required = vector('consent.biometric', 'fr', '365');
    const optional = vector('consent.biometric-matching', 'fr', '365');

    const { status } = await consent(step.token, {
      accepted: true,
      'text-keys': ['consent.biometric'],
      'optional-text-keys': ['consent.biometric-matching'],
      locale: 'fr',
      'text-sha256': [required['text-sha256'], optional['text-sha256']],
      'copy-source': 'built-in',
    });

    expect(status).toBe(201);
  });

  it('refuses a wrong digest with 422 consent_text_mismatch and records nothing', async () => {
    const step = await consentStep(keys, 30);
    const wrong = keys.map((key) => vector(key, 'en', '30')['text-sha256']);
    // consent.biometric's place holds another text's digest.
    wrong[0] = vector('consent.processing', 'en', '30')['text-sha256'];

    const { status, code } = await consent(step.token, {
      accepted: true,
      'text-keys': keys,
      locale: 'en',
      'text-sha256': wrong,
      'copy-source': 'built-in',
    });

    expect(status).toBe(422);
    expect(code).toBe('consent_text_mismatch');
    expect(await getLatestInquiryConsent(db, step.environmentId, step.inquiryId)).toBeNull();
  });
});
