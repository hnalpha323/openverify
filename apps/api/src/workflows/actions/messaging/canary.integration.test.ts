/**
 * C125.5 (P30), on Postgres 17, Valkey and RustFS: one step of each egress kind runs with recognisable
 * synthetic secrets and link tokens, a failing Slack step and a sandbox Slack step among them, and
 * they appear in no table (every text, `jsonb` and `bytea` column found through `information_schema`,
 * sealed ones opened with the test KEK), no Valkey key or value, no object in storage and no log line.
 *
 * A value's own sealed home is the one place it may be, so `workflow_secret_values` is scanned as
 * ciphertext and never opened. `api-actions`' inquiry-link steps run here too, so this test comes
 * after both messaging checkpoints (C126.8); `integration-8a` re-runs it at the end of the stage.
 */
import { randomBytes } from 'node:crypto';
import {
  GetObjectCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  ENCRYPTED_COLUMNS,
  createDatabase,
  createKeyring,
  createVerification,
  decrypt,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  ifSet,
  seedOtpChallenge,
  seedWorkflowSecret,
  seedWorkflowSecretValue,
  startIntegrationPostgres,
  testId,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { MockAgent } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCacheRedis, createKeyValueCache } from '../../../cache/index.js';
import { createOutboundHttp, type OutboundHttp } from '../../../http/index.js';
import { createSandboxMailer } from '../../../mail/sandbox.js';
import type { Mailer, RateLimiter } from '../../../ports.js';
import { createSlackSender } from '../../../providers/slack/index.js';
import {
  closeRateLimitRedis,
  createRateLimiter,
  createRateLimitRedis,
} from '../../../rate-limit/index.js';
import { createAuditLogger } from '../../../services/audit-log.js';
import { createFileStorage, type S3FileStorage } from '../../../storage/index.js';
import { fixedClock } from '../../../test-support/fakes.js';
import {
  startIntegrationRustfs,
  type StartedIntegrationRustfs,
} from '../../../test-support/integration-rustfs.js';
import {
  action,
  chain,
  createEngineHarnessOnDatabase,
  drain,
  runOf,
  start,
  type EngineHarness,
} from '../../engine/testing.js';
import {
  SEND_INQUIRY_LINK_EMAIL_HANDLER,
  SEND_INQUIRY_LINK_SMS_HANDLER,
} from '../inquiries/links.js';
import { EGRESS_ACTION_HANDLERS } from './egress-handlers.js';
import { createWorkflowMessenger } from './messenger.js';
import type { WorkflowMessenger } from './port.js';
import { VALKEY_TEST_IMAGE } from '../../../test-support/integration-valkey.js';

const keyring = createKeyring(randomBytes(32));
const S3 = { accessKeyId: 'synthetic-storage-key', secretAccessKey: 'synthetic-storage-secret' };
const BUCKET = 'canary';
const SANDBOX_LISTS = 'openverify:sandbox-messages:';
const clock = fixedClock();

const CURRENT = 'canary-current-7f3a9c1e5b2d';
const PREVIOUS = 'canary-previous-4e8d1a6c9b0f';
const BODY_CANARY = 'canary-body-2c7e5f3a8d1b';
const SIGNING = 'canary-signing-9a4b2e7d6c13';
const SLACK_PATH = '/services/T0CANARY/B0CANARY/canaryhook5d2e8f7a1c3b';
const SLACK_URL = `https://hooks.slack.com${SLACK_PATH}`;
const PERSON = 'person@example.com';
const PHONE = '+12025550123';

let postgres: StartedPostgreSqlContainer | undefined;
let valkey: StartedTestContainer;
let rustfs: StartedIntegrationRustfs;
let pool: Pool;
let db: Database;
let harness: EngineHarness;
let cacheRedis: Redis;
let limiterRedis: ReturnType<typeof createRateLimitRedis>;
let s3: S3Client;
let storage: S3FileStorage;
let mock: MockAgent;
let outbound: OutboundHttp;
let limiter: RateLimiter;
const logged: string[] = [];
const tokens: string[] = [];
const mailed: string[] = [];

const realMail: Mailer = {
  configured: true,
  send(message) {
    mailed.push(JSON.stringify(message));
    return Promise.resolve();
  },
};

const record = (...parts: unknown[]) => {
  logged.push(JSON.stringify(parts));
};

/** The messenger, with the tokens each message names kept for the scan. */
function messengerWith(slackName: 'incoming-webhook' | 'sandbox'): WorkflowMessenger {
  const cache = createKeyValueCache({ redis: cacheRedis });
  const messenger = createWorkflowMessenger({
    db,
    keyring,
    blindIndexKey: randomBytes(32),
    providers: {
      sandbox: {
        sms: { id: 'sandbox', sandbox: true, send: () => Promise.reject(new Error('OTP sink')) },
        slack: createSlackSender(slackName, { outboundHttp: outbound, cache, clock }),
      },
      production: {},
    },
    mail: { sandbox: createSandboxMailer({ cache, clock }), production: realMail },
    rateLimiter: limiter,
    cache,
    clock,
  });
  return {
    send(message, context) {
      tokens.push(...context.scrub);
      return messenger.send(message, context);
    },
  };
}

async function confirmedInquiry(channel: 'email' | 'sms', destination: string) {
  const { inquiry } = await createTestInquiry(db, harness.environmentId, {
    flow: { 'schema-version': 1, steps: [{ type: 'phone_otp', allowedCountries: ['US'] }] },
  });
  const verification = await createVerification(db, harness.environmentId, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: channel === 'email' ? 'email_address' : 'phone_number',
  });
  await pool.query(`update verifications set status = 'passed' where id = $1`, [verification.id]);
  await seedOtpChallenge(db, harness.environmentId, {
    verificationId: verification.id,
    inquiryId: inquiry.id,
    channel,
    destination,
    status: 'confirmed',
    confirmedAt: clock.now(),
  });
  return inquiry;
}

async function secretWith(
  key: string,
  value: string,
  hosts: readonly string[],
  placements: object,
  previousValue?: string,
): Promise<void> {
  const { id } = await seedWorkflowSecret(db, harness.organizationId, {
    key,
    allowedHosts: hosts,
  });
  await seedWorkflowSecretValue(db, {
    organizationId: harness.organizationId,
    environmentId: harness.environmentId,
    secretId: id,
    value,
    ...(previousValue === undefined ? {} : { previousValue }),
  });
  await pool.query(`update workflow_secrets set allowed_placements = $1::jsonb where id = $2`, [
    JSON.stringify(placements),
    id,
  ]);
}

const GRANT = { scopes: ['inquiries:write', 'inquiry-sessions:write'], pii: true } as const;

/** A step's end, so an assertion that fails says which step and why. */
const endOf = (run: { status: string; errorCode: string | null }) => run.errorCode ?? run.status;

async function runStep(key: string, config: Record<string, unknown>, trigger: object = {}) {
  const id = await start(harness, chain([action('step', key, config)]), {
    grant: GRANT,
    trigger: { id: 'acc_01M5CK16P0D13FXHZSS4TCFBVH', ...trigger } as never,
  });
  await drain(harness);
  return runOf(harness, id);
}

const HTTPS_CONFIG = {
  method: 'POST',
  url: 'https://api.example.com/v1/{{ trigger.id }}',
  headers: [{ name: 'authorization', value: 'Bearer {{secrets.crm_token}}' }],
  body: { credentials: { token: '{{secrets.crm_body}}' }, id: '{{ trigger.id }}' },
  signing: { secret: '{{secrets.crm_signing}}' },
  'capture-error-body': true,
};

function apiAnswers(status: number, body: string) {
  mock
    .get('https://api.example.com')
    .intercept({ method: 'POST', path: /^\/v1\// })
    .reply(status, body, {
      headers: { 'content-type': 'application/json', location: `https://a.example/?t=${CURRENT}` },
    });
}

function slackAnswers(status: number, body: string) {
  mock
    .get('https://hooks.slack.com')
    .intercept({ method: 'POST', path: SLACK_PATH })
    .reply(status, body, { headers: { 'content-type': 'text/plain' } });
}

/** Every written form of a value the test looks for. */
const formsOf = (value: string): readonly string[] => [
  value,
  Buffer.from(value).toString('base64'),
  Buffer.from(value).toString('base64url'),
  encodeURIComponent(value),
];

function canaries(): readonly string[] {
  return [CURRENT, PREVIOUS, BODY_CANARY, SIGNING, SLACK_URL, SLACK_PATH, ...tokens].flatMap(
    formsOf,
  );
}

function found(text: string): readonly string[] {
  return canaries().filter((canary) => text.includes(canary));
}

interface Column {
  table_name: string;
  column_name: string;
}

/** Every row of every table as JSON, `bytea` as text too. */
async function scanTables(): Promise<{ hits: string[]; unopened: string[] }> {
  const { rows: columns } = await pool.query<Column>(`
    select table_name, column_name from information_schema.columns
     where table_schema = 'public'
       and data_type in ('text', 'character varying', 'jsonb', 'json', 'bytea', 'ARRAY')
       and table_name not like '%drizzle%'`);
  const hits: string[] = [];
  const unopened: string[] = [];
  const tables = new Set(columns.map(({ table_name }) => table_name));
  for (const table of tables) {
    const { rows } = await pool.query<{ row: Record<string, unknown> }>(
      `select to_jsonb(t) as row from "${table}" t`,
    );
    const sealed = ENCRYPTED_COLUMNS.filter((entry) => entry.table === table);
    for (const { row } of rows) {
      const text = JSON.stringify(row);
      if (found(text).length > 0) {
        hits.push(table);
      }
      for (const value of Object.values(row)) {
        if (typeof value === 'string' && value.startsWith('\\x')) {
          if (found(Buffer.from(value.slice(2), 'hex').toString('latin1')).length > 0) {
            hits.push(table);
          }
        }
      }
      if (table !== 'workflow_secret_values') {
        for (const { column, aad } of sealed) {
          const held = row[column];
          if (typeof held === 'string' && aad !== 'file') {
            const context =
              aad === 'row' ? `${table}.${column}#${String(row.id)}` : `${table}.${column}`;
            try {
              if (found(decrypt(held, keyring, { context })).length > 0) {
                hits.push(`${table}.${column}`);
              }
            } catch {
              unopened.push(`${table}.${column}`);
            }
          }
        }
      }
    }
  }
  return { hits: [...new Set(hits)], unopened: [...new Set(unopened)] };
}

/** Every key, and every value of the kinds Valkey holds. */
async function scanValkey(redis: Redis): Promise<string[]> {
  const hits: string[] = [];
  const keys = await redis.keys('*');
  for (const key of keys) {
    const type = await redis.type(key);
    const values: unknown[] = [key];
    if (type === 'string') {
      values.push(await redis.get(key));
    } else if (type === 'hash') {
      values.push(await redis.hgetall(key));
    } else if (type === 'list') {
      values.push(await redis.lrange(key, 0, -1));
    } else if (type === 'stream') {
      values.push(await redis.xrange(key, '-', '+'));
    } else if (type === 'set') {
      values.push(await redis.smembers(key));
    } else if (type === 'zset') {
      values.push(await redis.zrange(key, 0, -1));
    }
    if (found(JSON.stringify(values)).length > 0) {
      hits.push(key);
    }
    if (key.startsWith(SANDBOX_LISTS)) {
      hits.push(...(await sealedBodyHits(redis, key)));
    }
  }
  return hits;
}

/** A sandbox list's bodies are sealed, so they are opened too: a token is scrubbed before that. */
async function sealedBodyHits(redis: Redis, key: string): Promise<string[]> {
  const hits: string[] = [];
  for (const raw of await redis.lrange(key, 0, -1)) {
    const entry = JSON.parse(raw) as { 'message-ref': string; body: string };
    const body = decrypt(entry.body, keyring, {
      context: `sandbox_messages.body#${harness.environmentId}:${entry['message-ref']}`,
    });
    if (found(body).length > 0) {
      hits.push(`${key}#${entry['message-ref']}`);
    }
  }
  return hits;
}

async function scanStorage(): Promise<string[]> {
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));
  const hits: string[] = [];
  for (const { Key } of listed.Contents ?? []) {
    const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const text = (await object.Body?.transformToString('latin1')) ?? '';
    if (found(text).length > 0) {
      hits.push(Key ?? '');
    }
  }
  return hits;
}

beforeAll(async () => {
  setDefaultKeyring(keyring);
  [postgres, valkey, rustfs] = await Promise.all([
    startIntegrationPostgres(),
    new GenericContainer(VALKEY_TEST_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    startIntegrationRustfs(S3),
  ]);
  pool = createIntegrationPool(postgres.getConnectionUri());
  db = createDatabase(pool);
  await runMigrations(db);
  const tenant = await createTestTenant(db, { kind: 'sandbox' });
  const valkeyUrl = `redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`;
  cacheRedis = createCacheRedis(valkeyUrl);
  limiterRedis = createRateLimitRedis(valkeyUrl);
  limiter = createRateLimiter({ redis: limiterRedis });
  const { endpoint } = rustfs;
  s3 = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: S3 });
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  storage = createFileStorage({
    driver: 's3',
    bucket: BUCKET,
    region: 'us-east-1',
    endpoint,
    forcePathStyle: true,
    ...S3,
  });
  mock = new MockAgent();
  mock.disableNetConnect();
  outbound = createOutboundHttp({ testDispatcher: mock });
  harness = createEngineHarnessOnDatabase(db, tenant, [
    ...EGRESS_ACTION_HANDLERS,
    SEND_INQUIRY_LINK_EMAIL_HANDLER,
    SEND_INQUIRY_LINK_SMS_HANDLER,
  ]);
  harness.deps.logger = { info: record, warn: record, error: record };
  Object.assign(harness.deps.services, {
    keyring,
    storage,
    clock,
    audit: createAuditLogger(),
    outboundHttp: outbound,
    rateLimiter: limiter,
    cache: createKeyValueCache({ redis: cacheRedis }),
    blindIndexKey: randomBytes(32),
    flowPublicUrl: 'https://flow.example.test',
    messenger: messengerWith('sandbox'),
  });
  await secretWith(
    'crm_token',
    CURRENT,
    ['api.example.com'],
    {
      headers: ['authorization'],
      'body-pointers': [],
    },
    PREVIOUS,
  );
  await secretWith('crm_body', BODY_CANARY, ['api.example.com'], {
    headers: [],
    'body-pointers': ['/credentials/token'],
  });
  await secretWith('crm_signing', SIGNING, ['api.example.com'], {
    headers: [],
    'body-pointers': [],
  });
  await secretWith('slack_hook', SLACK_URL, ['hooks.slack.com'], {
    headers: [],
    'body-pointers': [],
  });
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await outbound.close();
  await mock.close();
  s3.destroy();
  await closeRateLimitRedis(cacheRedis);
  await closeRateLimitRedis(limiterRedis);
  await Promise.all([rustfs.stop(), valkey.stop()]);
  await pool.end();
  await ifSet(postgres)?.stop();
});

describe('the canary (C125.5, P30)', () => {
  it('appears nowhere after one step of each egress kind', async () => {
    const echoed = JSON.stringify({
      echoed: CURRENT,
      body: BODY_CANARY,
      signing: Buffer.from(SIGNING).toString('base64'),
      url: encodeURIComponent(CURRENT),
    });
    const email = await confirmedInquiry('email', PERSON);
    const phone = await confirmedInquiry('sms', PHONE);

    apiAnswers(200, echoed);
    expect(endOf(await runStep('make_https_request', HTTPS_CONFIG))).toBe('completed');
    apiAnswers(500, echoed);
    expect(endOf(await runStep('make_https_request', HTTPS_CONFIG))).toBe('completed');
    mock
      .get('https://api.example.com')
      .intercept({ method: 'POST', path: /^\/v1\// })
      .replyWithError(new Error('socket hang up'));
    expect(endOf(await runStep('make_https_request', HTTPS_CONFIG))).toBe('request_failed');

    expect(
      endOf(
        await runStep(
          'send_email',
          { recipient: '{{ trigger.email }}', subject: 'Review', text: 'Ready.' },
          { id: email.id, email: PERSON },
        ),
      ),
    ).toBe('completed');
    expect(
      endOf(
        await runStep(
          'send_sms',
          { recipient: '{{ trigger.phone }}', text: 'Ready.' },
          { id: phone.id, phone: PHONE },
        ),
      ),
    ).toBe('completed');

    const slackConfig = { 'webhook-secret': '{{secrets.slack_hook}}', text: 'Ready.' };
    expect(endOf(await runStep('send_slack_message', slackConfig))).toBe('completed');

    Object.assign(harness.deps.services, { messenger: messengerWith('incoming-webhook') });
    slackAnswers(404, 'channel_not_found');
    expect(endOf(await runStep('send_slack_message', slackConfig))).toBe('slack_channel_not_found');
    slackAnswers(500, 'rollup_error');
    expect(endOf(await runStep('send_slack_message', slackConfig))).toBe('unknown_effect');
    Object.assign(harness.deps.services, { messenger: messengerWith('sandbox') });

    expect(endOf(await runStep('send_inquiry_link_email', { 'inquiry-id': email.id }))).toBe(
      'completed',
    );
    expect(endOf(await runStep('send_inquiry_link_sms', { 'inquiry-id': phone.id }))).toBe(
      'completed',
    );
    expect(tokens.length, JSON.stringify(logged)).toBeGreaterThanOrEqual(2);

    const tables = await scanTables();
    expect(tables.hits).toEqual([]);
    expect(tables.unopened.filter((name) => name.startsWith('workflow'))).toEqual([]);
    expect(await scanValkey(cacheRedis)).toEqual([]);
    expect(await scanStorage()).toEqual([]);
    expect(logged.filter((line) => found(line).length > 0)).toEqual([]);
  });
});
