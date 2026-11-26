/**
 * Workflow 2E: the inquiry timeline (C25.7 `GET /events?filter[inquiry-id]=`) and the API logs of
 * a user (C25.9 `GET /api-logs?filter[user-id]=`) are served by indexes. The proof is the plan
 * Postgres 17 chooses (EXPLAIN) for the exact query the repository sends, captured from the
 * pool, over tables holding enough rows (tens of thousands, analyzed) that a scan would cost
 * more than the index.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { runMigrations } from './migrate.js';
import {
  createApiLog,
  createEnvironment,
  createEvent,
  createInquiry,
  createInquirySession,
  createInquiryTemplate,
  createOrganization,
  createSelfieCapture,
  createVerification,
  listApiLogs,
  listEvents,
} from './repositories/index.js';
import { createIntegrationPool, testId, startIntegrationPostgres, ifSet } from './testing.js';
import { hashSessionToken } from './tokens.js';

const keyring = createKeyring(randomBytes(32));
/** Filler rows per table in the environment under test, and in a second environment. */
const FILLER_ROWS = 40_000;
const OTHER_ENVIRONMENT_ROWS = 10_000;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 4 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
});

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

async function environment(): Promise<string> {
  const organization = await createOrganization(db, { id: testId('org'), name: 'Example Org' });
  const created = await createEnvironment(db, {
    id: testId('env'),
    organizationId: organization.id,
    kind: 'sandbox',
  });
  return created.id;
}

/** `count` synthetic ids of one prefix. */
const ids = (prefix: Parameters<typeof testId>[0], count: number): string[] =>
  Array.from({ length: count }, () => testId(prefix));

/** Creation times spread over the last 30 days. */
const times = (count: number): string[] =>
  Array.from({ length: count }, (_, index) =>
    new Date(Date.now() - (index % 43_200) * 60_000).toISOString(),
  );

/**
 * Inserts filler events in one statement. Their payloads are never read: the queries under test
 * do not match them, and a plan is not an execution.
 */
async function fillEvents(env: string, count: number): Promise<void> {
  const objectIds = ids('inq', count / 4).flatMap((id) => [id, id, id, id]);
  await pool.query(
    `insert into events (id, environment_id, name, payload, object_id, object_type, created_at)
     select id, $2, 'inquiry.created', 'filler', object_id, 'inquiry', created_at
       from unnest($1::text[], $3::text[], $4::timestamptz[]) as t(id, object_id, created_at)`,
    [ids('evt', count), env, objectIds, times(count)],
  );
}

/**
 * Inserts `count` filler inquiries next to `inquiry` (same template version and account), each
 * with two verifications, a session and a selfie capture (C40.1), so the subqueries that gather
 * an inquiry's subjects run over tables of realistic size.
 */
async function fillInquiries(
  inquiry: {
    environmentId: string;
    inquiryTemplateId: string;
    inquiryTemplateVersionId: string;
    accountId: string;
  },
  count: number,
): Promise<void> {
  const inquiryIds = ids('inq', count);
  await pool.query(
    `insert into inquiries (id, environment_id, inquiry_template_id, inquiry_template_version_id,
                            account_id, fields)
     select id, $2, $3, $4, $5, 'filler' from unnest($1::text[]) as t(id)`,
    [
      inquiryIds,
      inquiry.environmentId,
      inquiry.inquiryTemplateId,
      inquiry.inquiryTemplateVersionId,
      inquiry.accountId,
    ],
  );
  const verificationIds = ids('ver', count * 2);
  await pool.query(
    `insert into verifications (id, environment_id, inquiry_id, type)
     select id, $2, inquiry_id, 'government_id'
       from unnest($1::text[], $3::text[]) as t(id, inquiry_id)`,
    [verificationIds, inquiry.environmentId, [...inquiryIds, ...inquiryIds]],
  );
  await pool.query(
    `insert into selfie_captures (id, environment_id, verification_id, inquiry_id, status, method,
                                  liveness, prompts, nonce_sha256, expires_at, processed_at)
     select id, $2, verification_id, inquiry_id, 'processed', 'camera', 'active', '["center"]',
            sha256(convert_to(id, 'UTF8')), now(), now()
       from unnest($1::text[], $3::text[], $4::text[]) as t(id, verification_id, inquiry_id)`,
    [ids('self', count), inquiry.environmentId, verificationIds.slice(0, count), inquiryIds],
  );
  await pool.query(
    `insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at)
     select id, $2, inquiry_id, encode(sha256(convert_to(id, 'UTF8')), 'hex'), now() + interval '1 day'
       from unnest($1::text[], $3::text[]) as t(id, inquiry_id)`,
    [ids('iqse', count), inquiry.environmentId, inquiryIds],
  );
}

/** Inserts filler API logs in one statement: 200 users and API keys share them. */
async function fillApiLogs(env: string, count: number): Promise<void> {
  const users = ids('usr', 200);
  const keys = ids('key', 50);
  const userIds = Array.from({ length: count }, (_, index) =>
    index % 3 === 0 ? null : users[index % users.length],
  );
  const keyIds = userIds.map((user, index) => (user === null ? keys[index % keys.length] : null));
  await pool.query(
    `insert into api_logs (id, environment_id, method, path, route, status, duration_ms,
                           user_id, api_key_id, created_at)
     select id, $2, 'GET', '/api/v1/inquiries', '/api/v1/inquiries', 200, 5,
            user_id, api_key_id, created_at
       from unnest($1::text[], $3::text[], $4::text[], $5::timestamptz[])
            as t(id, user_id, api_key_id, created_at)`,
    [ids('alog', count), env, userIds, keyIds, times(count)],
  );
}

/**
 * Runs `list` and returns the plan Postgres chooses for the last query it sent on `table`,
 * with the parameters it was sent with.
 */
async function planOf(table: string, list: () => Promise<unknown>): Promise<string> {
  const spy = vi.spyOn(pool, 'query');
  let calls: unknown[][];
  try {
    await list();
  } finally {
    // mockRestore() also forgets the calls, so they are read first.
    calls = [...spy.mock.calls];
    spy.mockRestore();
  }
  const sent = calls
    .map((call) => {
      const [config, values] = call as unknown as [string | { text: string }, unknown[]?];
      return { text: typeof config === 'string' ? config : config.text, values: values ?? [] };
    })
    .filter(({ text }) => text.includes(`from "${table}"`))
    .at(-1);
  if (sent === undefined) {
    throw new Error(`no query on ${table} was sent`);
  }
  const explained = await pool.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sent.text}`, sent.values);
  return explained.rows.map((row) => row['QUERY PLAN']).join('\n');
}

describe('query plans (Workflow 2E)', () => {
  // Seeding the filler rows (about 100,000 inserts) takes about 15 s on an idle machine and
  // more than the default 30 s under a heavy load, so this test states its own bound.
  it(
    'serves an inquiry timeline, selfie captures included, from the events object index (C25.7, C40.1)',
    { timeout: 180_000 },
    async () => {
      const env = await environment();
      const other = await environment();
      const template = await createInquiryTemplate(db, env, {
        id: testId('itmpl'),
        name: 'KYC',
        version: { id: testId('itmplv'), flow: {}, verificationConfig: {} },
      });
      const inquiry = await createInquiry(db, env, {
        id: testId('inq'),
        inquiryTemplateId: template.id,
        inquiryTemplateVersionId: template.currentVersion.id,
      });
      const verification = await createVerification(db, env, {
        id: testId('ver'),
        inquiryId: inquiry.id,
        type: 'government_id',
      });
      const session = await createInquirySession(db, env, {
        id: testId('iqse'),
        inquiryId: inquiry.id,
        tokenHash: hashSessionToken(`ovs_${'S'.repeat(43)}${testId('iqse')}`),
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      const selfie = await createVerification(db, env, {
        id: testId('ver'),
        inquiryId: inquiry.id,
        type: 'selfie',
      });
      const capture = await createSelfieCapture(db, env, {
        id: testId('self'),
        verificationId: selfie.id,
        inquiryId: inquiry.id,
        method: 'camera',
        liveness: 'active',
        prompts: ['center', 'left', 'right'],
        nonceSha256: new Uint8Array(32),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 180_000),
      });
      const timeline = [];
      for (const [name, type, id] of [
        ['inquiry.created', 'inquiry', inquiry.id],
        ['inquiry-session.started', 'inquiry-session', session.id],
        ['verification.created', 'verification', verification.id],
        ['selfie.created', 'selfie', capture.id],
      ] as const) {
        timeline.unshift(
          await createEvent(db, env, {
            id: testId('evt'),
            name,
            payload: { data: { type, id, attributes: {} } },
          }),
        );
      }
      await fillInquiries(inquiry, FILLER_ROWS / 4);
      await fillEvents(env, FILLER_ROWS);
      await fillEvents(other, OTHER_ENVIRONMENT_ROWS);
      await pool.query(
        'ANALYZE inquiries, events, verifications, inquiry_sessions, selfie_captures',
      );

      let listed: string[] = [];
      const plan = await planOf('events', async () => {
        listed = (await listEvents(db, env, { inquiryId: inquiry.id, size: 25 })).items.map(
          ({ id }) => id,
        );
      });

      expect(listed).toEqual(timeline.map(({ id }) => id));
      console.info(
        `EXPLAIN listEvents({ inquiryId }) over ${String(FILLER_ROWS)} events, ${String(FILLER_ROWS / 2)} verifications, ${String(FILLER_ROWS / 4)} sessions and ${String(FILLER_ROWS / 4)} selfie captures:\n${plan}`,
      );
      expect(plan).toContain('events_environment_id_object_id_idx');
      expect(plan).toContain('verifications_environment_id_inquiry_id_created_at_idx');
      expect(plan).toContain('inquiry_sessions_environment_id_inquiry_id_idx');
      expect(plan).toContain('selfie_captures_environment_id_inquiry_id_idx');
      expect(plan).not.toMatch(/Seq Scan on events/);
    },
  );

  it('serves the API logs of a user from the user index (C25.9)', async () => {
    const env = await environment();
    const other = await environment();
    const userId = testId('usr');
    const own = [];
    for (let index = 0; index < 3; index += 1) {
      own.unshift(
        await createApiLog(db, env, {
          id: testId('alog'),
          method: 'GET',
          path: '/api/v1/inquiries',
          route: '/api/v1/inquiries',
          status: 200,
          durationMs: 4,
          userId,
        }),
      );
    }
    await fillApiLogs(env, FILLER_ROWS);
    await fillApiLogs(other, OTHER_ENVIRONMENT_ROWS);
    await pool.query('ANALYZE api_logs');

    let listed: string[] = [];
    const plan = await planOf('api_logs', async () => {
      listed = (await listApiLogs(db, env, { userId, size: 25 })).items.map(({ id }) => id);
    });

    expect(listed).toEqual(own.map(({ id }) => id));
    console.info(`EXPLAIN listApiLogs({ userId }) over ${String(FILLER_ROWS)} API logs:\n${plan}`);
    expect(plan).toContain('api_logs_environment_id_user_id_created_at_id_idx');
    expect(plan).not.toMatch(/Seq Scan on api_logs/);
    // The index is in the list's order, so a page reads its rows and stops: no sort of all of
    // the user's requests, which an operator's session makes many of.
    expect(plan).not.toMatch(/\bSort\b/);
  });
});
