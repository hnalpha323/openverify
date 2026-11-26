/**
 * C38 (the Workflow 2E follow-up) on Postgres 17: a list page is read from its index in the
 * list's own order (`created_at DESC, id DESC`, NULLS FIRST) and stops after its rows, instead of
 * sorting every row of the scope. The proof is the plan Postgres chooses (EXPLAIN) for the exact
 * query the repository sends, captured from the pool, over tens of thousands of analyzed rows:
 * no `Sort` node above the index scan.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { DecryptionError, createKeyring, setDefaultKeyring } from './crypto.js';
import { runMigrations } from './migrate.js';
import {
  createEnvironment,
  createInquiry,
  createInquiryTemplate,
  createOrganization,
  listEvents,
  listInquiries,
} from './repositories/index.js';
import { createIntegrationPool, testId, startIntegrationPostgres, ifSet } from './testing.js';

const keyring = createKeyring(randomBytes(32));
const FILLER_ROWS = 40_000;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;

const ids = (prefix: Parameters<typeof testId>[0], count: number): string[] =>
  Array.from({ length: count }, () => testId(prefix));

const times = (count: number): string[] =>
  Array.from({ length: count }, (_, index) =>
    new Date(Date.now() - (index % 43_200) * 60_000).toISOString(),
  );

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 4 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);

  const organization = await createOrganization(db, { id: testId('org'), name: 'Example Org' });
  environmentId = (
    await createEnvironment(db, {
      id: testId('env'),
      organizationId: organization.id,
      kind: 'sandbox',
    })
  ).id;
  const template = await createInquiryTemplate(db, environmentId, {
    id: testId('itmpl'),
    name: 'KYC',
    version: { id: testId('itmplv'), flow: {}, verificationConfig: {} },
  });
  const inquiry = await createInquiry(db, environmentId, {
    id: testId('inq'),
    inquiryTemplateId: template.id,
    inquiryTemplateVersionId: template.currentVersion.id,
  });
  const statuses = ['created', 'pending', 'completed', 'failed'];
  await pool.query(
    `insert into inquiries (id, environment_id, inquiry_template_id, inquiry_template_version_id,
                            account_id, fields, status, created_at)
     select id, $2, $3, $4, $5, '{}', status::inquiry_status, created_at
       from unnest($1::text[], $6::text[], $7::timestamptz[]) as t(id, status, created_at)`,
    [
      ids('inq', FILLER_ROWS),
      environmentId,
      template.id,
      template.currentVersion.id,
      inquiry.accountId,
      Array.from({ length: FILLER_ROWS }, (_, index) => statuses[index % statuses.length]),
      times(FILLER_ROWS),
    ],
  );
  await pool.query(
    `insert into events (id, environment_id, name, payload, object_id, object_type, created_at)
     select id, $2, name, 'filler', id, 'inquiry', created_at
       from unnest($1::text[], $3::text[], $4::timestamptz[]) as t(id, name, created_at)`,
    [
      ids('evt', FILLER_ROWS),
      environmentId,
      // One event in twenty is the name listed, as a timeline holds many names.
      Array.from({ length: FILLER_ROWS }, (_, index) =>
        index % 20 === 0 ? 'inquiry.completed' : 'inquiry.created',
      ),
      times(FILLER_ROWS),
    ],
  );
  await pool.query('ANALYZE inquiries, events');
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

/**
 * The plan Postgres chooses for the last query `list` sent on `table`, with its parameters. The
 * filler rows hold no sealed values, so reading them fails once the query has been sent; only the
 * query matters here.
 */
async function planOf(table: string, list: () => Promise<unknown>): Promise<string> {
  const spy = vi.spyOn(pool, 'query');
  let calls: unknown[][];
  try {
    await list().catch((error: unknown) => {
      if (!(error instanceof DecryptionError)) {
        throw error;
      }
    });
  } finally {
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

describe('list pages read from their index in order (C38)', () => {
  it.each([
    [
      'inquiries',
      'inquiries_environment_id_created_at_id_idx',
      () => listInquiries(db, environmentId, { size: 25 }),
    ],
    [
      'inquiries',
      'inquiries_environment_id_status_created_at_id_idx',
      () => listInquiries(db, environmentId, { status: 'completed', size: 25 }),
    ],
    [
      'events',
      'events_environment_id_name_created_at_id_idx',
      () => listEvents(db, environmentId, { name: 'inquiry.completed', size: 25 }),
    ],
  ] as const)('serves a page of %s from %s without sorting', async (table, index, list) => {
    const plan = await planOf(table, list);

    console.info(`EXPLAIN a page of ${table} over ${String(FILLER_ROWS)} rows:\n${plan}`);
    expect(plan).toContain(index);
    expect(plan).not.toMatch(/\bSort\b/);
  });
});
