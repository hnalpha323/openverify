/**
 * Workflow 8A Stage 1b, checkpoint (X) (plan C125.1, C125.2): `workflow_secrets`, one row per key of an
 * organisation, and `workflow_secret_values`, one sealed value per environment, read from the migrated
 * database's catalogs.
 *
 * - a key is unique within an organisation and two organisations may hold the same one;
 * - a value belongs to its secret's organisation, whichever ids a caller passes;
 * - a secret holds at most one value per environment, and a previous value only with its expiry;
 * - an environment's deletion takes its values, and a secret's deletion all of its values.
 *
 * Every value is a synthetic canary.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

async function columnsOf(table: string): Promise<Record<string, string>> {
  const result = await query<{ column_name: string; udt_name: string }>(
    `select column_name, udt_name from information_schema.columns where table_name = $1`,
    [table],
  );
  return Object.fromEntries(result.rows.map((row) => [row.column_name, row.udt_name]));
}

const tenant = async () => {
  const { organization, environment } = await createTestTenant(database.db);
  return { organizationId: organization.id, environmentId: environment.id };
};

async function insertSecret(
  organizationId: string,
  overrides: { id?: string; key?: string; hosts?: readonly string[]; createdBy?: string } = {},
): Promise<string> {
  const id = overrides.id ?? testId('wsec');
  await query(
    `insert into workflow_secrets (id, organization_id, key, allowed_hosts, created_by)
     values ($1, $2, $3, $4, $5)`,
    [
      id,
      organizationId,
      overrides.key ?? `key_${id.slice(-12).toLowerCase()}`,
      overrides.hosts ?? ['api.example.com'],
      overrides.createdBy ?? testId('usr'),
    ],
  );
  return id;
}

async function insertValue(
  ids: { organizationId: string; environmentId: string; secretId: string },
  extra: { previousValue?: string; previousExpiresAt?: string } = {},
): Promise<string> {
  const id = testId('wsecv');
  await query(
    `insert into workflow_secret_values (id, organization_id, secret_id, environment_id, value, last4,
       previous_value, previous_expires_at)
     values ($1, $2, $3, $4, 'sealed-canary', 'nary', $5, $6)`,
    [
      id,
      ids.organizationId,
      ids.secretId,
      ids.environmentId,
      extra.previousValue ?? null,
      extra.previousExpiresAt ?? null,
    ],
  );
  return id;
}

describe('workflow_secrets (C125.1)', () => {
  it('holds a key, its hosts and placements, and no value', async () => {
    expect(await columnsOf('workflow_secrets')).toEqual({
      id: 'text',
      organization_id: 'text',
      key: 'text',
      description: 'text',
      allowed_hosts: '_text',
      allowed_placements: 'jsonb',
      created_by: 'text',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
    });
  });

  it('places a value in `authorization` and no pointer until told otherwise (P29)', async () => {
    const { organizationId } = await tenant();
    const id = await insertSecret(organizationId);

    const { rows } = await query<{ allowed_placements: unknown }>(
      `select allowed_placements from workflow_secrets where id = $1`,
      [id],
    );

    expect(rows[0]?.allowed_placements).toEqual({
      headers: ['authorization'],
      'body-pointers': [],
    });
  });

  it('holds a key once per organisation, and another organisation may hold it too', async () => {
    const first = await tenant();
    const second = await tenant();
    await insertSecret(first.organizationId, { key: 'crm_token' });

    await expect(insertSecret(first.organizationId, { key: 'crm_token' })).rejects.toThrow(
      'workflow_secrets_organization_id_key_key',
    );
    await expect(insertSecret(second.organizationId, { key: 'crm_token' })).resolves.toMatch(
      /^wsec_/,
    );
  });

  it.each([
    ['upper case', 'Crm_Token'],
    ['a leading digit', '1token'],
    ['a dash', 'crm-token'],
  ])('refuses a key with %s', async (_what, key) => {
    const { organizationId } = await tenant();

    await expect(insertSecret(organizationId, { key })).rejects.toThrow(
      'workflow_secrets_key_format',
    );
  });

  it('needs a host, because a secret is always bound to one (C125.4)', async () => {
    const { organizationId } = await tenant();

    await expect(insertSecret(organizationId, { hosts: [] })).rejects.toThrow(
      'workflow_secrets_hosts_present',
    );
  });

  it('is created by a user or an API key, never a run', async () => {
    const { organizationId } = await tenant();

    await expect(insertSecret(organizationId, { createdBy: testId('wfr') })).rejects.toThrow(
      'workflow_secrets_created_by_format',
    );
  });
});

describe('workflow_secret_values (C125.1)', () => {
  it('holds a sealed value, its last four and a previous value with its expiry', async () => {
    expect(await columnsOf('workflow_secret_values')).toEqual({
      id: 'text',
      organization_id: 'text',
      secret_id: 'text',
      environment_id: 'text',
      value: 'text',
      last4: 'text',
      version: 'int4',
      previous_value: 'text',
      previous_expires_at: 'timestamptz',
      rotated_by: 'text',
      rotated_at: 'timestamptz',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
    });
  });

  it('holds one value per secret and environment', async () => {
    const { organizationId, environmentId } = await tenant();
    const secretId = await insertSecret(organizationId);
    await insertValue({ organizationId, environmentId, secretId });

    await expect(insertValue({ organizationId, environmentId, secretId })).rejects.toThrow(
      'workflow_secret_values_secret_id_environment_id_key',
    );
  });

  it('never holds a value of one organisation in another organisation’s environment', async () => {
    const owner = await tenant();
    const other = await tenant();
    const secretId = await insertSecret(owner.organizationId);

    await expect(
      insertValue({
        organizationId: owner.organizationId,
        environmentId: other.environmentId,
        secretId,
      }),
    ).rejects.toThrow('workflow_secret_values_environment_fk');
    await expect(
      insertValue({
        organizationId: other.organizationId,
        environmentId: other.environmentId,
        secretId,
      }),
    ).rejects.toThrow('workflow_secret_values_secret_fk');
  });

  it('keeps a previous value only with its expiry (C125.2)', async () => {
    const { organizationId, environmentId } = await tenant();
    const secretId = await insertSecret(organizationId);

    await expect(
      insertValue({ organizationId, environmentId, secretId }, { previousValue: 'sealed-canary' }),
    ).rejects.toThrow('workflow_secret_values_previous_whole');
  });

  it('records who rotated a value, whole or not at all', async () => {
    const { organizationId, environmentId } = await tenant();
    const secretId = await insertSecret(organizationId);
    const id = await insertValue({ organizationId, environmentId, secretId });

    await expect(
      query(`update workflow_secret_values set rotated_by = $1 where id = $2`, [testId('usr'), id]),
    ).rejects.toThrow('workflow_secret_values_rotated_whole');
    await expect(
      query(`update workflow_secret_values set rotated_by = $1, rotated_at = now() where id = $2`, [
        testId('wfr'),
        id,
      ]),
    ).rejects.toThrow('workflow_secret_values_rotated_by_format');
  });

  it('goes with its secret, and with its environment', async () => {
    const { organizationId, environmentId } = await tenant();
    const deleted = await insertSecret(organizationId);
    const kept = await insertSecret(organizationId);
    await insertValue({ organizationId, environmentId, secretId: deleted });
    await insertValue({ organizationId, environmentId, secretId: kept });
    const held = async () =>
      (
        await query<{ secret_id: string }>(
          `select secret_id from workflow_secret_values where environment_id = $1`,
          [environmentId],
        )
      ).rows.map((row) => row.secret_id);

    await query(`delete from workflow_secrets where id = $1`, [deleted]);
    expect(await held()).toEqual([kept]);

    await query(`delete from environments where id = $1`, [environmentId]);
    expect(await held()).toEqual([]);
    const { rows } = await query(`select 1 from workflow_secrets where id = $1`, [kept]);
    expect(rows).toHaveLength(1);
  });

  it.each(['workflow_secrets', 'workflow_secret_values'])(
    'bumps updated_at on %s through the shared trigger',
    async (table) => {
      const { rows } = await query(
        `select 1 from pg_trigger where tgname = $1 and not tgisinternal`,
        [`${table}_set_updated_at`],
      );

      expect(rows).toHaveLength(1);
    },
  );
});
