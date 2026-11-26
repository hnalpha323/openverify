/**
 * Workflow 7A Stage 1b, checkpoint (H) (plan C91.1, C96.2, C96.3, C96.4, C96.7, V02, V03, V05):
 * the handoff tables and columns of migration 0023, read from the migrated database's catalogs.
 *
 * - `handoff_tokens`: one row per `ovh_` token, stored as its SHA-256 only, bound to the inquiry,
 *   the handoff step and the issuing session; at most one live token per issuing session (C96.2).
 *   A confirmation code is kept only as a digest over the token and the code, so the row alone
 *   cannot reveal it.
 * - `inquiry_handoff_steps`: the handoff state per inquiry and step, not per session (V05).
 * - the session's handoff fields (C91.1, C96.4, C96.7), and `handoff_rejected_at` (ours, V03).
 * - `created_by_session_id` on verifications and selfie captures, and `from_rejected_handoff` on
 *   verifications (V02).
 *
 * Every value is synthetic; every digest is random hex.
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

const digest = () => randomBytes(32).toString('hex');

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

/** An active session of `inquiryId`, by SQL, with `columns` beside the required ones. */
async function insertSession(
  environmentId: string,
  inquiryId: string,
  columns: Record<string, unknown> = {},
): Promise<string> {
  const id = testId('iqse');
  await insert('inquiry_sessions', {
    id,
    environment_id: environmentId,
    inquiry_id: inquiryId,
    token_hash: digest(),
    expires_at: new Date(Date.now() + 3_600_000),
    ...columns,
  });
  return id;
}

/** A tenant, an inquiry and an active (desktop) session of it. */
async function seedSession() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const sessionId = await insertSession(environment.id, inquiry.id);
  return { environmentId: environment.id, inquiryId: inquiry.id, sessionId };
}

type Seeded = Awaited<ReturnType<typeof seedSession>>;

/** A QR token issued by the seeded session, with `columns` beside the required ones. */
function token(seeded: Seeded, columns: Record<string, unknown> = {}) {
  const id = testId('hnd');
  return {
    id,
    done: insert('handoff_tokens', {
      id,
      environment_id: seeded.environmentId,
      inquiry_id: seeded.inquiryId,
      issuing_session_id: seeded.sessionId,
      step_id: 'device_handoff',
      method: 'qr',
      token_hash: digest(),
      expires_at: new Date(Date.now() + 300_000),
      ...columns,
    }),
  };
}

const HANDED_OFF = (fromSessionId: string, columns: Record<string, unknown> = {}) => ({
  device_handoff_method: 'qr',
  handoff_from_session_id: fromSessionId,
  handoff_redeemed_at: new Date(),
  ...columns,
});

describe('C96.2: handoff_tokens, the ovh_ tokens', () => {
  it('stores the token as its digest only, bound to the inquiry, the step and the issuing session', async () => {
    expect(await columnsOf('handoff_tokens')).toEqual({
      id: 'text not null',
      environment_id: 'text not null',
      inquiry_id: 'text not null',
      issuing_session_id: 'text not null',
      step_id: 'text not null',
      method: 'text not null',
      token_hash: 'text not null',
      confirmation_code_hash: 'text',
      code_attempts: 'integer not null',
      destination_confirmed: 'boolean not null',
      expires_at: 'timestamp with time zone not null',
      redeemed_at: 'timestamp with time zone',
      redeemed_session_id: 'text',
      revoked_at: 'timestamp with time zone',
      declined_at: 'timestamp with time zone',
      created_at: 'timestamp with time zone not null',
      updated_at: 'timestamp with time zone not null',
    });
    const foreign = (await constraintsOf('handoff_tokens')).filter((c) => c.type === 'f');
    expect(foreign).toContainEqual({
      type: 'f',
      columns: ['environment_id', 'inquiry_id'],
      foreignTable: 'inquiries',
      foreignColumns: ['environment_id', 'id'],
      onDelete: 'c',
    });
    expect(foreign).toContainEqual({
      type: 'f',
      columns: ['environment_id', 'issuing_session_id'],
      foreignTable: 'inquiry_sessions',
      foreignColumns: ['environment_id', 'id'],
      onDelete: 'c',
    });
    expect(foreign).toContainEqual({
      type: 'f',
      columns: ['environment_id', 'redeemed_session_id'],
      foreignTable: 'inquiry_sessions',
      foreignColumns: ['environment_id', 'id'],
      onDelete: 'c',
    });
    expect(await indexDefinition('handoff_tokens_token_hash_key')).toMatch(
      /UNIQUE INDEX .* \(token_hash\)/,
    );
    // C96.2: retention finds the tokens past use or expiry.
    expect(await indexDefinition('handoff_tokens_expires_at_idx')).toMatch(/\(expires_at\)/);
    expect(await hasUpdatedAtTrigger('handoff_tokens')).toBe(true);
  });

  it('starts unused with no code attempt and a confirmed destination', async () => {
    const seeded = await seedSession();
    const issued = token(seeded);
    await issued.done;
    const row = await query<{ code_attempts: number; destination_confirmed: boolean }>(
      `select code_attempts, destination_confirmed from handoff_tokens where id = $1`,
      [issued.id],
    );

    expect(row.rows).toEqual([{ code_attempts: 0, destination_confirmed: true }]);
  });

  it('keeps at most one live token per issuing session: a new one needs the old one revoked or redeemed (C96.2)', async () => {
    const seeded = await seedSession();
    const first = token(seeded);
    await first.done;

    await expect(token(seeded).done).rejects.toThrow(/handoff_tokens_live_per_session_key/);
    await query(`update handoff_tokens set revoked_at = now() where id = $1`, [first.id]);
    await expect(token(seeded).done).resolves.toBeDefined();
  });

  it.each([
    ['an unknown method', { method: 'push' }, /handoff_tokens_method_valid/],
    ['a token digest that is not hex', { token_hash: 'x'.repeat(64) }, /token_hash_hex/],
    [
      'a code digest that is not hex',
      { confirmation_code_hash: 'z'.repeat(64) },
      /confirmation_code_hash_hex/,
    ],
    ['negative code attempts', { code_attempts: -1 }, /code_attempts_non_negative/],
    ['an id of another prefix', { id: testId('iqse') }, /handoff_tokens_id_format/],
    ['a step id that is not one', { step_id: 'Device Handoff' }, /handoff_tokens_step_id_format/],
    [
      'a redemption without its session',
      { redeemed_at: new Date() },
      /handoff_tokens_redeemed_session/,
    ],
    [
      'a token both redeemed and revoked',
      { redeemed_at: new Date(), revoked_at: new Date() },
      /handoff_tokens_redeemed_or_revoked/,
    ],
    ['a decline that leaves the token live', { declined_at: new Date() }, /declined_revokes/],
    [
      'an unconfirmed destination without a code (V16)',
      { method: 'email', destination_confirmed: false },
      /handoff_tokens_unconfirmed_needs_code/,
    ],
    [
      'a QR token marked unconfirmed',
      { destination_confirmed: false, confirmation_code_hash: digest() },
      /handoff_tokens_unconfirmed_needs_code/,
    ],
  ])('refuses %s', async (_label, columns, constraint) => {
    const seeded = await seedSession();
    await expect(token(seeded, columns).done).rejects.toThrow(constraint);
  });

  it('records the redeeming session, and goes with its issuing session or inquiry', async () => {
    const seeded = await seedSession();
    const phone = await insertSession(
      seeded.environmentId,
      seeded.inquiryId,
      HANDED_OFF(seeded.sessionId),
    );
    const redeemed = token(seeded, { redeemed_at: new Date(), redeemed_session_id: phone });
    await redeemed.done;
    await query(`delete from inquiries where id = $1`, [seeded.inquiryId]);
    const left = await query<{ count: string }>(
      `select count(*)::text as count from handoff_tokens where id = $1`,
      [redeemed.id],
    );

    expect(left.rows[0]?.count).toBe('0');
  });
});

describe('C96.3 (V05): inquiry_handoff_steps, the state per inquiry and step', () => {
  it('is keyed by the inquiry and the step, goes with the inquiry, and bumps updated_at', async () => {
    const constraints = await constraintsOf('inquiry_handoff_steps');

    expect(constraints.filter((c) => c.type === 'p').map((c) => c.columns)).toEqual([
      ['environment_id', 'inquiry_id', 'step_id'],
    ]);
    expect(constraints.filter((c) => c.type === 'f')).toContainEqual({
      type: 'f',
      columns: ['environment_id', 'inquiry_id'],
      foreignTable: 'inquiries',
      foreignColumns: ['environment_id', 'id'],
      onDelete: 'c',
    });
    expect(await columnsOf('inquiry_handoff_steps')).toEqual({
      environment_id: 'text not null',
      inquiry_id: 'text not null',
      step_id: 'text not null',
      state: 'text not null',
      created_at: 'timestamp with time zone not null',
      updated_at: 'timestamp with time zone not null',
    });
    expect(await hasUpdatedAtTrigger('inquiry_handoff_steps')).toBe(true);
  });

  it('takes every C96.3 state and refuses any other', async () => {
    const { environmentId, inquiryId } = await seedSession();
    for (const [index, state] of [
      'pending',
      'issued',
      'redeemed',
      'continued_here',
      'skipped',
      'rejected',
      'declined',
    ].entries()) {
      await insert('inquiry_handoff_steps', {
        environment_id: environmentId,
        inquiry_id: inquiryId,
        step_id: `handoff_${String(index)}`,
        state,
      });
    }

    await expect(
      insert('inquiry_handoff_steps', {
        environment_id: environmentId,
        inquiry_id: inquiryId,
        step_id: 'handoff_x',
        state: 'done',
      }),
    ).rejects.toThrow(/inquiry_handoff_steps_state_valid/);
    await expect(
      insert('inquiry_handoff_steps', {
        environment_id: environmentId,
        inquiry_id: inquiryId,
        step_id: 'Handoff X',
        state: 'pending',
      }),
    ).rejects.toThrow(/inquiry_handoff_steps_step_id_format/);
  });
});

describe('C91.1, C96.4, C96.7: the session handoff fields', () => {
  it('adds the handoff method, origin, redemption, distance facts and rejection, all nullable', async () => {
    const columns = await columnsOf('inquiry_sessions');

    expect(columns).toMatchObject({
      device_handoff_method: 'text',
      handoff_from_session_id: 'text',
      handoff_redeemed_at: 'timestamp with time zone',
      handoff_distance_meters: 'integer',
      handoff_country_changed: 'boolean',
      handoff_asn_changed: 'boolean',
      handoff_rejected_at: 'timestamp with time zone',
    });
    expect((await constraintsOf('inquiry_sessions')).filter((c) => c.type === 'f')).toContainEqual({
      type: 'f',
      columns: ['environment_id', 'handoff_from_session_id'],
      foreignTable: 'inquiry_sessions',
      foreignColumns: ['environment_id', 'id'],
      onDelete: 'a',
    });
    // `assertSessionNotHandedOff` finds the issuing session's redeemed sessions (F13).
    expect(await indexDefinition('inquiry_sessions_handoff_from_session_id_idx')).toMatch(
      /\(environment_id, handoff_from_session_id\) WHERE \(handoff_from_session_id IS NOT NULL\)/,
    );
  });

  it('records a redeemed session with its issuing session', async () => {
    const seeded = await seedSession();
    const phone = await insertSession(
      seeded.environmentId,
      seeded.inquiryId,
      HANDED_OFF(seeded.sessionId, {
        handoff_distance_meters: 1200,
        handoff_country_changed: false,
        handoff_asn_changed: null,
        handoff_rejected_at: new Date(),
      }),
    );
    const row = await query<{ handoff_from_session_id: string; device_handoff_method: string }>(
      `select handoff_from_session_id, device_handoff_method from inquiry_sessions where id = $1`,
      [phone],
    );

    expect(row.rows).toEqual([
      { handoff_from_session_id: seeded.sessionId, device_handoff_method: 'qr' },
    ]);
  });

  it.each([
    ['an unknown method', { device_handoff_method: 'nfc' }, /device_handoff_method_valid/],
    [
      'a method without its issuing session and time',
      { handoff_from_session_id: null, handoff_redeemed_at: null },
      /inquiry_sessions_handoff_fields_together/,
    ],
    ['a negative distance', { handoff_distance_meters: -1 }, /handoff_distance_non_negative/],
  ])('refuses %s', async (_label, columns, constraint) => {
    const seeded = await seedSession();

    await expect(
      insertSession(seeded.environmentId, seeded.inquiryId, HANDED_OFF(seeded.sessionId, columns)),
    ).rejects.toThrow(constraint);
  });

  it.each([
    ['distance facts', { handoff_distance_meters: 5 }],
    ['a country comparison', { handoff_country_changed: true }],
    ['an ASN comparison', { handoff_asn_changed: true }],
    ['a rejection', { handoff_rejected_at: new Date() }],
  ])('refuses %s on a session no handoff created', async (_label, columns) => {
    const seeded = await seedSession();

    await expect(insertSession(seeded.environmentId, seeded.inquiryId, columns)).rejects.toThrow(
      /inquiry_sessions_handoff_facts_need_handoff/,
    );
  });
});

describe('V02: the session that created a verification or a selfie capture', () => {
  it('adds created_by_session_id to verifications and selfie captures, and from_rejected_handoff to verifications', async () => {
    expect(await columnsOf('verifications')).toMatchObject({
      created_by_session_id: 'text',
      from_rejected_handoff: 'boolean not null',
    });
    expect(await columnsOf('selfie_captures')).toMatchObject({ created_by_session_id: 'text' });
    for (const table of ['verifications', 'selfie_captures']) {
      expect(
        (await constraintsOf(table)).filter((c) => c.type === 'f'),
        table,
      ).toContainEqual({
        type: 'f',
        columns: ['environment_id', 'created_by_session_id'],
        foreignTable: 'inquiry_sessions',
        foreignColumns: ['environment_id', 'id'],
        onDelete: 'a',
      });
    }
  });

  it('starts a verification as not from a rejected handoff, and refuses a session that is not there', async () => {
    const seeded = await seedSession();
    const id = testId('ver');
    await insert('verifications', {
      id,
      environment_id: seeded.environmentId,
      inquiry_id: seeded.inquiryId,
      type: 'government_id',
      created_by_session_id: seeded.sessionId,
    });
    const row = await query<{ from_rejected_handoff: boolean; created_by_session_id: string }>(
      `select from_rejected_handoff, created_by_session_id from verifications where id = $1`,
      [id],
    );

    expect(row.rows).toEqual([
      { from_rejected_handoff: false, created_by_session_id: seeded.sessionId },
    ]);
    await expect(
      insert('verifications', {
        id: testId('ver'),
        environment_id: seeded.environmentId,
        inquiry_id: seeded.inquiryId,
        type: 'government_id',
        created_by_session_id: testId('iqse'),
      }),
    ).rejects.toThrow(/verifications_created_by_session_fk/);
  });
});
