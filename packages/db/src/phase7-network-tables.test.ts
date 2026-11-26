/**
 * Workflow 7A Stage 1b, checkpoint (N) (plan C91.1, C91.3, C92.2, C92.3, C93.2): the network tables
 * of migration 0023, read from the migrated database's catalogs.
 *
 * - `network_sources` and `network_syncs` are install-wide, as `watchlist_sources` and
 *   `watchlist_syncs` are (C92.5): public publications, never about a subject.
 * - `networks` is environment-scoped: one row per evaluation of a session's address, reached
 *   through its session's `(environment_id, id)` and deleted with it. Its address and location are
 *   sealed for the row; the other facts are derived facts without the address (C91.4), plain.
 * - `inquiry_sessions` gains the session's network facts (C91.1), its location sealed for the row.
 *
 * Honesty (C90.3, C93.3, H13): the never-false flags refuse `false` in the database too. Every
 * address and ASN here is from the documentation ranges.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

interface Constraint {
  type: string;
  columns: string[];
  foreignTable: string | null;
  foreignColumns: string[];
  onDelete: string;
}

async function constraintsOf(table: string): Promise<Constraint[]> {
  const result = await query<{
    type: string;
    columns: string[] | null;
    foreign_table: string | null;
    foreign_columns: string[] | null;
    on_delete: string;
  }>(
    `select c.contype as type,
            (select array_agg(a.attname order by k.ordinality) from unnest(c.conkey)
               with ordinality as k(attnum, ordinality)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns,
            f.relname as foreign_table,
            (select array_agg(a.attname order by k.ordinality) from unnest(c.confkey)
               with ordinality as k(attnum, ordinality)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
              as foreign_columns,
            c.confdeltype as on_delete
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       left join pg_class f on f.oid = c.confrelid
      where t.relname = $1`,
    [table],
  );
  return result.rows.map((row) => ({
    type: row.type,
    columns: row.columns ?? [],
    foreignTable: row.foreign_table,
    foreignColumns: row.foreign_columns ?? [],
    onDelete: row.on_delete,
  }));
}

async function columnsOf(table: string): Promise<Record<string, string>> {
  const result = await query<{ column_name: string; data_type: string; is_nullable: string }>(
    `select column_name, data_type, is_nullable from information_schema.columns
      where table_name = $1 order by ordinal_position`,
    [table],
  );
  return Object.fromEntries(
    result.rows.map((row) => [
      row.column_name,
      `${row.data_type}${row.is_nullable === 'NO' ? ' not null' : ''}`,
    ]),
  );
}

async function indexDefinition(name: string): Promise<string | null> {
  const result = await query<{ indexdef: string }>(
    `select indexdef from pg_indexes where indexname = $1`,
    [name],
  );
  return result.rows[0]?.indexdef ?? null;
}

async function hasUpdatedAtTrigger(table: string): Promise<boolean> {
  const result = await query<{ count: string }>(
    `select count(*)::text as count from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = $1 and t.tgname = $2`,
    [table, `${table}_set_updated_at`],
  );
  return result.rows[0]?.count === '1';
}

/** Source ids made so far, so each test's source row is its own. */
let sources = 0;

/** A source row, then one sync of it with `sync` over the required columns; returns its id. */
async function insertSourceAndSync(sourceId: string, sync: Record<string, unknown> = {}) {
  await query(`insert into network_sources (id, enabled) values ($1, true)`, [sourceId]);
  const all: Record<string, unknown> = {
    source_id: sourceId,
    started_at: new Date(),
    outcome: 'applied',
    actor: 'cli',
    ...sync,
  };
  const columns = Object.keys(all);
  const result = await query<{ id: string }>(
    `insert into network_syncs (${columns.join(', ')})
       values (${columns.map((_, index) => `$${String(index + 1)}`).join(', ')}) returning id`,
    Object.values(all),
  );
  return result.rows[0]?.id;
}

/** A tenant, an inquiry and an active session of it, by SQL. */
async function seedSession() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const sessionId = testId('iqse');
  await query(
    `insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at)
       values ($1, $2, $3, $4, now() + interval '1 hour')`,
    [sessionId, environment.id, inquiry.id, randomBytes(32).toString('hex')],
  );
  return { environmentId: environment.id, inquiryId: inquiry.id, sessionId };
}

/** Inserts a network row for the session, with `columns` on top of the required ones. */
function insertNetwork(
  session: { environmentId: string; sessionId: string },
  columns: Record<string, unknown> = {},
) {
  const all: Record<string, unknown> = {
    id: testId('net'),
    environment_id: session.environmentId,
    inquiry_session_id: session.sessionId,
    client_address_source: 'socket',
    evaluated_at: new Date(),
    ...columns,
  };
  const names = Object.keys(all);
  return query(
    `insert into networks (${names.join(', ')})
       values (${names.map((_, index) => `$${String(index + 1)}`).join(', ')})`,
    Object.values(all),
  );
}

describe('C92.5: the install-wide network source and sync tables', () => {
  it('creates network_sources keyed by the manifest source id, with no environment', async () => {
    const constraints = await constraintsOf('network_sources');

    expect(constraints.filter((c) => c.type === 'p').map((c) => c.columns)).toEqual([['id']]);
    expect(await columnsOf('network_sources')).toEqual({
      id: 'text not null',
      enabled: 'boolean not null',
      sandbox_only: 'boolean not null',
      last_sync_id: 'bigint',
      last_published_at: 'timestamp with time zone',
      last_sha256: 'text',
      last_applied_at: 'timestamp with time zone',
      last_checked_at: 'timestamp with time zone',
      last_origin: 'text',
      last_error_code: 'text',
      check_failures: 'integer not null',
      last_failed_at: 'timestamp with time zone',
      created_at: 'timestamp with time zone not null',
      updated_at: 'timestamp with time zone not null',
    });
    expect(await hasUpdatedAtTrigger('network_sources')).toBe(true);
  });

  it('creates network_syncs, each sync naming its source, with the guards’ sizes and the purge times', async () => {
    const constraints = await constraintsOf('network_syncs');

    expect(constraints.filter((c) => c.type === 'p').map((c) => c.columns)).toEqual([['id']]);
    expect(constraints.filter((c) => c.type === 'f')).toEqual([
      {
        type: 'f',
        columns: ['source_id'],
        foreignTable: 'network_sources',
        foreignColumns: ['id'],
        onDelete: 'a',
      },
    ]);
    expect(await columnsOf('network_syncs')).toEqual({
      id: 'bigint not null',
      source_id: 'text not null',
      started_at: 'timestamp with time zone not null',
      finished_at: 'timestamp with time zone',
      outcome: 'text not null',
      error_code: 'text',
      published_at: 'timestamp with time zone',
      sha256: 'text',
      snapshot_bytes: 'bigint',
      entry_count: 'integer not null',
      covered_ipv4: 'bigint',
      covered_ipv6: 'numeric',
      actor: 'text not null',
      origin: 'text',
      overrides: 'ARRAY not null',
      superseded_at: 'timestamp with time zone',
      snapshot_deleted_at: 'timestamp with time zone',
    });
    expect(await indexDefinition('network_syncs_source_id_started_at_idx')).toMatch(
      /\(source_id, started_at DESC\)/,
    );
    expect(await indexDefinition('network_syncs_superseded_snapshot_idx')).toMatch(
      /\(superseded_at\) WHERE \(\(outcome = 'applied'::text\) AND \(snapshot_deleted_at IS NULL\) AND \(superseded_at IS NOT NULL\)\)/,
    );
  });

  it.each([
    ['an unknown outcome', { outcome: 'maybe' }, /network_syncs_outcome_valid/],
    ['an unknown actor', { actor: 'cron' }, /network_syncs_actor_valid/],
    ['an unknown origin', { origin: 'mirror' }, /network_syncs_origin_valid/],
    ['an unknown override', { overrides: ['allow-anything'] }, /network_syncs_overrides_valid/],
    ['a digest that is not lower-case hex', { sha256: 'ABC' }, /network_syncs_sha256_hex/],
    ['a negative count', { entry_count: -1 }, /network_syncs_sizes_non_negative/],
    ['an IPv4 coverage beyond 2^32', { covered_ipv4: 4_294_967_297 }, /network_syncs_sizes/],
  ])('refuses a sync with %s', async (_label, sync, constraint) => {
    sources += 1;
    await expect(insertSourceAndSync(`synthetic-refused-${String(sources)}`, sync)).rejects.toThrow(
      constraint,
    );
  });

  it('records the three overrides together, and an IPv6 coverage of the whole space', async () => {
    const id = await insertSourceAndSync('synthetic-overrides', {
      overrides: ['allow-mass-removal', 'allow-mass-addition', 'accept-older-publication'],
      covered_ipv6: (2n ** 128n).toString(),
      origin: 'import',
    });
    const row = await query<{ covered_ipv6: string }>(
      `select covered_ipv6::text from network_syncs where id = $1`,
      [id],
    );

    expect(row.rows[0]?.covered_ipv6).toBe('340282366920938463463374607431768211456');
  });

  it.each([
    ['an id that is not a source id', `insert into network_sources (id) values ('Bad Id')`],
    [
      'a negative check-failure count',
      `insert into network_sources (id, check_failures) values ('synthetic-fail', -1)`,
    ],
    [
      'an unknown last origin',
      `insert into network_sources (id, last_origin) values ('synthetic-origin', 'mirror')`,
    ],
  ])('refuses a source with %s', async (_label, statement) => {
    await expect(query(statement)).rejects.toThrow(/network_sources_/);
  });
});

describe('C91.3, C93.2: networks, one per evaluation of a session’s address', () => {
  it('is environment-scoped and goes with its session', async () => {
    const constraints = await constraintsOf('networks');
    const foreign = constraints.filter((c) => c.type === 'f');

    expect(constraints.filter((c) => c.type === 'p').map((c) => c.columns)).toEqual([['id']]);
    expect(foreign).toContainEqual({
      type: 'f',
      columns: ['environment_id'],
      foreignTable: 'environments',
      foreignColumns: ['id'],
      onDelete: 'c',
    });
    expect(foreign).toContainEqual({
      type: 'f',
      columns: ['environment_id', 'inquiry_session_id'],
      foreignTable: 'inquiry_sessions',
      foreignColumns: ['environment_id', 'id'],
      onDelete: 'c',
    });
    expect(await indexDefinition('networks_environment_id_inquiry_session_id_key')).toMatch(
      /UNIQUE INDEX .* \(environment_id, inquiry_session_id\)/,
    );
    expect(await indexDefinition('networks_environment_id_created_at_id_idx')).toMatch(
      /\(environment_id, created_at DESC, id DESC\)/,
    );
    expect(await hasUpdatedAtTrigger('networks')).toBe(true);
  });

  it('keeps the address and the location sealed, the derived facts plain', async () => {
    expect(await columnsOf('networks')).toEqual({
      id: 'text not null',
      environment_id: 'text not null',
      inquiry_session_id: 'text not null',
      ip: 'text',
      location: 'text',
      service_provider: 'text',
      service_type: 'text',
      proxy_type: 'text',
      threat_level: 'text not null',
      country_code: 'text',
      country_name: 'text',
      asn: 'bigint',
      hosting_asn: 'boolean',
      hosting_asn_confidence: 'double precision',
      privacy_relay: 'boolean',
      client_address_source: 'text not null',
      evaluated_at: 'timestamp with time zone not null',
      reasons: 'jsonb not null',
      sources: 'jsonb not null',
      created_at: 'timestamp with time zone not null',
      updated_at: 'timestamp with time zone not null',
    });
  });

  it('stores an evaluation with the defaults: unknown threat, no reasons, no sources', async () => {
    const session = await seedSession();
    await insertNetwork(session, { asn: 64_496, country_code: 'ZZ' });
    const row = await query<{ threat_level: string; reasons: unknown; sources: unknown }>(
      `select threat_level, reasons, sources from networks where inquiry_session_id = $1`,
      [session.sessionId],
    );

    expect(row.rows).toEqual([{ threat_level: 'unknown', reasons: [], sources: [] }]);
  });

  it('refuses a second evaluation of the same session', async () => {
    const session = await seedSession();
    await insertNetwork(session);

    await expect(insertNetwork(session)).rejects.toThrow(
      /networks_environment_id_inquiry_session_id_key/,
    );
  });

  it.each([
    [
      'hosting_asn false (true or null only, H13)',
      { hosting_asn: false },
      /hosting_asn_true_or_null/,
    ],
    [
      'privacy_relay false (true or null only)',
      { privacy_relay: false },
      /privacy_relay_true_or_null/,
    ],
    ['a confidence above 1', { hosting_asn_confidence: 1.5 }, /hosting_asn_confidence_range/],
    [
      'a threat level outside the public vocabulary',
      { threat_level: 'none' },
      /threat_level_valid/,
    ],
    [
      'an unknown trust mode (C93.1)',
      { client_address_source: 'header' },
      /client_address_source_valid/,
    ],
    ['an ASN beyond 32 bits', { asn: 4_294_967_296 }, /networks_asn_range/],
    ['a lower-case country code', { country_code: 'zz' }, /networks_country_code_format/],
    ['an id with another prefix', { id: testId('dev') }, /networks_id_format/],
  ])('refuses %s', async (_label, columns, constraint) => {
    const session = await seedSession();

    await expect(insertNetwork(session, columns)).rejects.toThrow(constraint);
  });

  it('goes when its session is deleted', async () => {
    const session = await seedSession();
    await insertNetwork(session);
    await query(`delete from inquiry_sessions where id = $1`, [session.sessionId]);
    const left = await query<{ count: string }>(
      `select count(*)::text as count from networks where inquiry_session_id = $1`,
      [session.sessionId],
    );

    expect(left.rows[0]?.count).toBe('0');
  });
});

describe('C91.1: the session’s network facts', () => {
  it('adds them as nullable columns, the location sealed for the row', async () => {
    const columns = await columnsOf('inquiry_sessions');

    expect(columns).toMatchObject({
      network_evaluated_at: 'timestamp with time zone',
      is_tor: 'boolean',
      is_datacenter: 'boolean',
      is_vpn: 'boolean',
      is_proxy: 'boolean',
      hosting_asn: 'boolean',
      threat_level: 'text',
      country_code: 'text',
      country_name: 'text',
      location: 'text',
      ip_connection_type: 'text',
      network_organization: 'text',
    });
  });

  it('keys inquiry_sessions by (environment_id, id) for the tables that reach a session', async () => {
    const unique = (await constraintsOf('inquiry_sessions')).filter((c) => c.type === 'u');

    expect(unique.map((c) => c.columns)).toContainEqual(['environment_id', 'id']);
  });

  it.each([
    ['is_datacenter false (C93.3: provider ranges are not exhaustive)', 'is_datacenter = false'],
    ['is_vpn false (C93.3: the VPN seed is not exhaustive)', 'is_vpn = false'],
    ['hosting_asn false (H13)', 'hosting_asn = false'],
    ['a threat level of unknown (the session uses null)', `threat_level = 'unknown'`],
    ['a lower-case country code', `country_code = 'zz'`],
  ])('refuses %s', async (_label, assignment) => {
    const session = await seedSession();

    await expect(
      query(`update inquiry_sessions set ${assignment} where id = $1`, [session.sessionId]),
    ).rejects.toThrow(/inquiry_sessions_/);
  });

  it('takes the exhaustive negatives: is_tor and is_proxy may be false', async () => {
    const session = await seedSession();
    await query(
      `update inquiry_sessions set network_evaluated_at = now(), is_tor = false, is_proxy = false,
         is_datacenter = true, is_vpn = null, hosting_asn = true, threat_level = 'medium',
         country_code = 'ZZ' where id = $1`,
      [session.sessionId],
    );
    const row = await query<{ is_tor: boolean; is_proxy: boolean; threat_level: string }>(
      `select is_tor, is_proxy, threat_level from inquiry_sessions where id = $1`,
      [session.sessionId],
    );

    expect(row.rows).toEqual([{ is_tor: false, is_proxy: false, threat_level: 'medium' }]);
  });
});
