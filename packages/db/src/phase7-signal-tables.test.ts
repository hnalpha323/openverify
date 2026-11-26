/**
 * Workflow 7A Stage 1b, checkpoint (S) (plan C90.5, C90.6, C91.1, C91.2, C94.2, C94.4): the signal
 * and device tables and columns of migration 0023, read from the migrated database's catalogs.
 *
 * - `inquiry_session_signals`: the flow signal bodies, unique per `(session, sequence)`, the
 *   collector components and the behaviour aggregates sealed in two columns for their row (C94.2,
 *   P19), so retention can null the components alone (C91.7).
 * - `inquiry_signal_computations`: the outbox `createSignalComputationInTx` writes on an inquiry's
 *   first move into `completed`, `failed` or `expired`, one row per inquiry (C90.5, F02).
 * - `devices` and `session_devices`: a device exists only with a recorded identifier, keyed per
 *   environment by its HMAC and key id; each session links to at most one (C91.2, C94.4).
 * - the inquiry's `signals` and `signal_details`, the version's `signal_config`, and the session's
 *   parsed device fields, `signals_collected` and `signal_bodies_dropped` (C91.1, V15).
 *
 * Every value is synthetic; every HMAC is random hex.
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

const hmac = () => randomBytes(32).toString('hex');
const KEY_ID = 'AAAAAAAAAAA';

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

/** `insert into <table> (<columns>) values (...)` with `$n` parameters. */
function insert(table: string, all: Record<string, unknown>) {
  const names = Object.keys(all);
  return query(
    `insert into ${table} (${names.join(', ')})
       values (${names.map((_, index) => `$${String(index + 1)}`).join(', ')})`,
    Object.values(all),
  );
}

/** A tenant, an inquiry and an active session of it, by SQL. */
async function seedSession() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const sessionId = testId('iqse');
  await query(
    `insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at)
       values ($1, $2, $3, $4, now() + interval '1 hour')`,
    [sessionId, environment.id, inquiry.id, hmac()],
  );
  return { environmentId: environment.id, inquiryId: inquiry.id, sessionId };
}

type Seeded = Awaited<ReturnType<typeof seedSession>>;

const signalBody = (session: Seeded, columns: Record<string, unknown> = {}) =>
  insert('inquiry_session_signals', {
    environment_id: session.environmentId,
    inquiry_session_id: session.sessionId,
    sequence: 0,
    screen: 'consent',
    platform: 'web',
    collector_version: 1,
    ...columns,
  });

const webDevice = (environmentId: string, columns: Record<string, unknown> = {}) => {
  const id = testId('dev');
  return {
    id,
    done: insert('devices', {
      id,
      environment_id: environmentId,
      platform: 'web',
      collector_version: 1,
      browser_fingerprint: hmac(),
      device_class: hmac(),
      key_id: KEY_ID,
      first_seen_at: new Date(),
      last_seen_at: new Date(),
      ...columns,
    }),
  };
};

describe('C94.2: inquiry_session_signals, the flow signal bodies', () => {
  it('keeps the components and the behaviour sealed in their own columns, the rest plain', async () => {
    expect(await columnsOf('inquiry_session_signals')).toEqual({
      id: 'bigint not null',
      environment_id: 'text not null',
      inquiry_session_id: 'text not null',
      sequence: 'integer not null',
      screen: 'text not null',
      platform: 'text not null',
      collector_version: 'integer not null',
      components: 'text',
      behaviour: 'text',
      created_at: 'timestamp with time zone not null',
    });
  });

  it('goes with its session, is unique per (session, sequence), and is found by age for retention', async () => {
    const constraints = await constraintsOf('inquiry_session_signals');

    expect(constraints.filter((c) => c.type === 'f')).toContainEqual({
      type: 'f',
      columns: ['environment_id', 'inquiry_session_id'],
      foreignTable: 'inquiry_sessions',
      foreignColumns: ['environment_id', 'id'],
      onDelete: 'c',
    });
    expect(await indexDefinition('inquiry_session_signals_session_sequence_key')).toMatch(
      /UNIQUE INDEX .* \(inquiry_session_id, sequence\)/,
    );
    expect(await indexDefinition('inquiry_session_signals_environment_id_created_at_idx')).toMatch(
      /\(environment_id, created_at\)/,
    );
  });

  it('refuses a repeated sequence of one session', async () => {
    const session = await seedSession();
    await signalBody(session, { sequence: 3 });

    await expect(signalBody(session, { sequence: 3 })).rejects.toThrow(
      /inquiry_session_signals_session_sequence_key/,
    );
  });

  it.each([
    ['a negative sequence', { sequence: -1 }, /inquiry_session_signals_sequence_non_negative/],
    ['an unknown platform', { platform: 'ios' }, /inquiry_session_signals_platform_valid/],
    ['a collector version of 0', { collector_version: 0 }, /collector_version_positive/],
    ['a screen that is not a step id', { screen: 'Consent Step' }, /screen_format/],
  ])('refuses %s', async (_label, columns, constraint) => {
    const session = await seedSession();

    await expect(signalBody(session, columns)).rejects.toThrow(constraint);
  });

  it('goes when its session is deleted', async () => {
    const session = await seedSession();
    await signalBody(session);
    await query(`delete from inquiry_sessions where id = $1`, [session.sessionId]);
    const left = await query<{ count: string }>(
      `select count(*)::text as count from inquiry_session_signals where inquiry_session_id = $1`,
      [session.sessionId],
    );

    expect(left.rows[0]?.count).toBe('0');
  });
});

describe('C90.5: inquiry_signal_computations, the signals outbox', () => {
  it('has one row per inquiry, goes with it, and finds the pending rows by age', async () => {
    const constraints = await constraintsOf('inquiry_signal_computations');

    expect(constraints.filter((c) => c.type === 'p').map((c) => c.columns)).toEqual([
      ['environment_id', 'inquiry_id'],
    ]);
    expect(constraints.filter((c) => c.type === 'f')).toContainEqual({
      type: 'f',
      columns: ['environment_id', 'inquiry_id'],
      foreignTable: 'inquiries',
      foreignColumns: ['environment_id', 'id'],
      onDelete: 'c',
    });
    expect(await columnsOf('inquiry_signal_computations')).toEqual({
      environment_id: 'text not null',
      inquiry_id: 'text not null',
      trigger_status: 'text not null',
      state: 'text not null',
      attempts: 'integer not null',
      last_error_code: 'text',
      enqueued_at: 'timestamp with time zone',
      computed_at: 'timestamp with time zone',
      created_at: 'timestamp with time zone not null',
      updated_at: 'timestamp with time zone not null',
    });
    expect(await indexDefinition('inquiry_signal_computations_pending_idx')).toMatch(
      /\(created_at\) WHERE \(state = 'pending'::text\)/,
    );
    expect(await hasUpdatedAtTrigger('inquiry_signal_computations')).toBe(true);
  });

  it('starts pending with no attempt', async () => {
    const { environmentId, inquiryId } = await seedSession();
    await insert('inquiry_signal_computations', {
      environment_id: environmentId,
      inquiry_id: inquiryId,
      trigger_status: 'expired',
    });
    const row = await query<{ state: string; attempts: number }>(
      `select state, attempts from inquiry_signal_computations where inquiry_id = $1`,
      [inquiryId],
    );

    expect(row.rows).toEqual([{ state: 'pending', attempts: 0 }]);
  });

  it.each([
    [
      'a trigger that is not a first terminal move',
      { trigger_status: 'approved' },
      /trigger_valid/,
    ],
    ['an unknown state', { trigger_status: 'completed', state: 'done' }, /state_valid/],
    ['negative attempts', { trigger_status: 'failed', attempts: -1 }, /attempts_non_negative/],
    [
      'a computed state without its time',
      { trigger_status: 'completed', state: 'computed' },
      /computed_at/,
    ],
  ])('refuses %s', async (_label, columns, constraint) => {
    const { environmentId, inquiryId } = await seedSession();

    await expect(
      insert('inquiry_signal_computations', {
        environment_id: environmentId,
        inquiry_id: inquiryId,
        ...columns,
      }),
    ).rejects.toThrow(constraint);
  });
});

describe('C91.2, C94.4: devices and the session links', () => {
  it('keeps the HMACs plain, keyed per environment with their key id', async () => {
    expect(await columnsOf('devices')).toEqual({
      id: 'text not null',
      environment_id: 'text not null',
      platform: 'text not null',
      collector_version: 'integer not null',
      browser_fingerprint: 'text',
      device_fingerprint: 'text',
      device_class: 'text',
      fingerprint_randomised: 'boolean not null',
      key_id: 'text not null',
      first_seen_at: 'timestamp with time zone not null',
      last_seen_at: 'timestamp with time zone not null',
      trusted_at: 'timestamp with time zone',
      trusted_by_type: 'text',
      trusted_by_id: 'text',
      trust_reason: 'text',
      created_at: 'timestamp with time zone not null',
      updated_at: 'timestamp with time zone not null',
    });
    expect(await indexDefinition('devices_browser_fingerprint_key')).toMatch(
      /UNIQUE INDEX .* \(environment_id, browser_fingerprint, key_id\) WHERE \(browser_fingerprint IS NOT NULL\)/,
    );
    expect(await indexDefinition('devices_device_fingerprint_key')).toMatch(
      /UNIQUE INDEX .* \(environment_id, device_fingerprint, key_id\) WHERE \(device_fingerprint IS NOT NULL\)/,
    );
    expect(await indexDefinition('devices_environment_id_last_seen_at_idx')).toMatch(
      /\(environment_id, last_seen_at\)/,
    );
    expect(await hasUpdatedAtTrigger('devices')).toBe(true);
  });

  it('refuses a second device with the same strict HMAC under the same key id', async () => {
    const { environmentId } = await seedSession();
    const fingerprint = hmac();
    await webDevice(environmentId, { browser_fingerprint: fingerprint }).done;

    await expect(
      webDevice(environmentId, { browser_fingerprint: fingerprint }).done,
    ).rejects.toThrow(/devices_browser_fingerprint_key/);
    // Another key id is another device (C94.4: rotated keys never match).
    await webDevice(environmentId, { browser_fingerprint: fingerprint, key_id: 'BBBBBBBBBBB' })
      .done;
  });

  it.each([
    ['an HMAC that is not 64 lower-case hex', { browser_fingerprint: 'ABC' }, /_hex/],
    ['an unknown platform', { platform: 'ios' }, /devices_platform_valid/],
    ['a key id that is not 11 base64url characters', { key_id: 'short' }, /devices_key_id_format/],
    [
      'a web device with an Android identifier (V10)',
      { device_fingerprint: hmac() },
      /devices_identifiers_fit_platform/,
    ],
    [
      'an Android device with browser identifiers',
      { platform: 'android', device_fingerprint: hmac() },
      /devices_identifiers_fit_platform/,
    ],
    [
      'a randomised canvas that kept the strict HMAC (C94.4)',
      { fingerprint_randomised: true },
      /devices_randomised_drops_strict/,
    ],
    [
      'a device with no identifier (C91.2)',
      { browser_fingerprint: null, device_class: null },
      /devices_has_identifier/,
    ],
    ['an id with another prefix', { id: testId('net') }, /devices_id_format/],
  ])('refuses %s', async (_label, columns, constraint) => {
    const { environmentId } = await seedSession();

    await expect(webDevice(environmentId, columns).done).rejects.toThrow(constraint);
  });

  it('links a session to one device; the link goes with the session or the device', async () => {
    const constraints = await constraintsOf('session_devices');

    expect(constraints.filter((c) => c.type === 'p').map((c) => c.columns)).toEqual([
      ['environment_id', 'inquiry_session_id'],
    ]);
    expect(constraints.filter((c) => c.type === 'f')).toEqual(
      expect.arrayContaining([
        {
          type: 'f',
          columns: ['environment_id', 'inquiry_session_id'],
          foreignTable: 'inquiry_sessions',
          foreignColumns: ['environment_id', 'id'],
          onDelete: 'c',
        },
        {
          type: 'f',
          columns: ['environment_id', 'device_id'],
          foreignTable: 'devices',
          foreignColumns: ['environment_id', 'id'],
          onDelete: 'c',
        },
      ]),
    );
    expect(await indexDefinition('session_devices_environment_id_device_id_idx')).toMatch(
      /\(environment_id, device_id\)/,
    );

    const session = await seedSession();
    const device = webDevice(session.environmentId);
    await device.done;
    const link = {
      environment_id: session.environmentId,
      inquiry_session_id: session.sessionId,
      device_id: device.id,
    };
    await insert('session_devices', link);
    await expect(insert('session_devices', link)).rejects.toThrow(/session_devices_pkey/);
    await query(`delete from devices where id = $1`, [device.id]);
    const left = await query<{ count: string }>(
      `select count(*)::text as count from session_devices where inquiry_session_id = $1`,
      [session.sessionId],
    );
    expect(left.rows[0]?.count).toBe('0');
  });
});

describe('C90.5, C90.6, C91.1: the signal and device columns of existing tables', () => {
  it('gives the inquiry its signals and signal details, null until computed', async () => {
    expect(await columnsOf('inquiries')).toMatchObject({
      signals: 'jsonb',
      signal_details: 'jsonb',
    });
  });

  it('gives the version its signal-config, {} by default', async () => {
    expect(await columnsOf('inquiry_template_versions')).toMatchObject({
      signal_config: 'jsonb not null',
    });
    const { environment } = await createTestTenant(database.db);
    const { template } = await createTestInquiry(database.db, environment.id);
    const row = await query<{ signal_config: unknown }>(
      `select signal_config from inquiry_template_versions where id = $1`,
      [template.latestVersion.id],
    );

    expect(row.rows).toEqual([{ signal_config: {} }]);
  });

  it('gives the session its parsed device fields, the tiers that applied and the dropped count', async () => {
    expect(await columnsOf('inquiry_sessions')).toMatchObject({
      os_name: 'text',
      os_full_version: 'text',
      browser_name: 'text',
      browser_full_version: 'text',
      device_type: 'text',
      device_name: 'text',
      mobile_sdk_name: 'text',
      mobile_sdk_full_version: 'text',
      signals_collected: 'ARRAY not null',
      signal_bodies_dropped: 'integer not null',
    });
    const session = await seedSession();
    const row = await query<{ signals_collected: string[]; signal_bodies_dropped: number }>(
      `select signals_collected, signal_bodies_dropped from inquiry_sessions where id = $1`,
      [session.sessionId],
    );

    expect(row.rows).toEqual([{ signals_collected: [], signal_bodies_dropped: 0 }]);
  });

  it.each([
    ['an unknown device type', `device_type = 'watch'`, /device_type_valid/],
    ['an unknown SDK', `mobile_sdk_name = 'other-sdk'`, /mobile_sdk_name_valid/],
    ['an unknown collection tier', `signals_collected = '{server}'`, /signals_collected_valid/],
    ['a negative dropped count', `signal_bodies_dropped = -1`, /signal_bodies_dropped/],
    ['a parsed field over 64 characters', `os_name = repeat('x', 65)`, /device_fields_length/],
  ])('refuses %s', async (_label, assignment, constraint) => {
    const session = await seedSession();

    await expect(
      query(`update inquiry_sessions set ${assignment} where id = $1`, [session.sessionId]),
    ).rejects.toThrow(constraint);
  });

  it('takes both collection tiers and the parsed fields', async () => {
    const session = await seedSession();
    await query(
      `update inquiry_sessions set signals_collected = '{session-integrity,device-recognition}',
         device_type = 'smartphone', mobile_sdk_name = 'openverify-android',
         mobile_sdk_full_version = '1.2.3', signal_bodies_dropped = 4 where id = $1`,
      [session.sessionId],
    );
    const row = await query<{ signals_collected: string[]; device_type: string }>(
      `select signals_collected, device_type from inquiry_sessions where id = $1`,
      [session.sessionId],
    );

    expect(row.rows).toEqual([
      { signals_collected: ['session-integrity', 'device-recognition'], device_type: 'smartphone' },
    ]);
  });
});
