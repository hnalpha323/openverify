import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { pgTable, serial } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKeySecret } from './api-keys.js';
import { createDatabase, type Database } from './client.js';
import { createKeyring, encrypted } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import { apiKeys, environments, organizations } from './schema.js';
import { createIntegrationPool, testId, startIntegrationPostgres } from './testing.js';

// Synthetic secrets generated per run.
const pepper = randomBytes(32);
const keyring = createKeyring(randomBytes(32));

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri());
  db = createDatabase(pool);
  await runMigrations(db);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

async function createOrganizationWithSandbox(name: string) {
  const [organization] = await db
    .insert(organizations)
    .values({ id: testId('org'), name })
    .returning();
  if (!organization) throw new Error('organization insert returned no row');
  const [environment] = await db
    .insert(environments)
    .values({ id: testId('env'), organizationId: organization.id, kind: 'sandbox' })
    .returning();
  if (!environment) throw new Error('environment insert returned no row');
  return { organization, environment };
}

/** Drizzle wraps driver errors; the Postgres SQLSTATE is on the cause. */
async function sqlStateOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

describe('migrations against Postgres 17 + pgvector', () => {
  it('apply cleanly and are idempotent', async () => {
    await runMigrations(db);

    const applied = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
    );
    expect(applied.rows[0]?.count).toBe(String(migrationTags().length));
  });

  it('store and read back an organization, environment and API key', async () => {
    const { organization, environment } = await createOrganizationWithSandbox('Example Org');
    const key = generateApiKey('sandbox', pepper);
    await db.insert(apiKeys).values({
      id: testId('key'),
      environmentId: environment.id,
      name: 'CI key',
      prefix: key.prefix,
      secretHash: key.secretHash,
      scopes: ['inquiry.read', 'inquiry.write'],
      allowedIps: ['10.0.0.0/8', '2001:db8::/32'],
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    });

    const rows = await db
      .select({ key: apiKeys, environment: environments, organization: organizations })
      .from(apiKeys)
      .innerJoin(environments, eq(apiKeys.environmentId, environments.id))
      .innerJoin(organizations, eq(environments.organizationId, organizations.id))
      .where(eq(apiKeys.secretHash, hashApiKeySecret(key.token, pepper)));

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.organization).toMatchObject({ id: organization.id, name: 'Example Org' });
    expect(row?.environment).toMatchObject({ id: environment.id, kind: 'sandbox' });
    expect(row?.key).toMatchObject({
      name: 'CI key',
      prefix: 'ov_sbx_',
      secretHash: key.secretHash,
      scopes: ['inquiry.read', 'inquiry.write'],
      allowedIps: ['10.0.0.0/8', '2001:db8::/32'],
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(row?.key.id).toMatch(/^key_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(row?.key.createdAt).toBeInstanceOf(Date);
    expect(JSON.stringify(row)).not.toContain(key.token);
  });

  it('defaults scopes to an empty array and allowed_ips to NULL', async () => {
    const { environment } = await createOrganizationWithSandbox('Defaults Org');
    const key = generateApiKey('sandbox', pepper);
    const [stored] = await db
      .insert(apiKeys)
      .values({
        id: testId('key'),
        environmentId: environment.id,
        name: 'bare',
        prefix: key.prefix,
        secretHash: key.secretHash,
      })
      .returning();

    expect(stored?.scopes).toEqual([]);
    expect(stored?.allowedIps).toBeNull();
  });

  it('allows one sandbox and one production environment per organization', async () => {
    const { organization } = await createOrganizationWithSandbox('Unique Org');
    await db
      .insert(environments)
      .values({ id: testId('env'), organizationId: organization.id, kind: 'production' });

    const duplicate = db
      .insert(environments)
      .values({ id: testId('env'), organizationId: organization.id, kind: 'sandbox' });
    expect(await sqlStateOf(duplicate)).toBe('23505'); // unique_violation
  });

  it('rejects a secret_hash that is not a SHA-256 hex digest', async () => {
    const { environment } = await createOrganizationWithSandbox('Check Org');
    const plaintext = generateApiKey('sandbox', pepper).token;

    const insert = db.insert(apiKeys).values({
      id: testId('key'),
      environmentId: environment.id,
      name: 'raw token',
      prefix: 'ov_sbx_',
      secretHash: plaintext,
    });
    expect(await sqlStateOf(insert)).toBe('23514'); // check_violation
  });

  it('rejects duplicate secret hashes', async () => {
    const { environment } = await createOrganizationWithSandbox('Dup Hash Org');
    const key = generateApiKey('sandbox', pepper);
    const values = {
      id: testId('key'),
      environmentId: environment.id,
      name: 'twin',
      prefix: key.prefix,
      secretHash: key.secretHash,
    };
    await db.insert(apiKeys).values(values);

    expect(await sqlStateOf(db.insert(apiKeys).values({ ...values, id: testId('key') }))).toBe(
      '23505',
    );
  });

  it('rejects an allowed_ips entry that is not a network address', async () => {
    const { environment } = await createOrganizationWithSandbox('Cidr Org');
    const key = generateApiKey('sandbox', pepper);

    const insert = db.insert(apiKeys).values({
      id: testId('key'),
      environmentId: environment.id,
      name: 'host bits set',
      prefix: key.prefix,
      secretHash: key.secretHash,
      allowedIps: ['192.168.1.1/24'],
    });
    expect(await sqlStateOf(insert)).toBe('22P02'); // invalid_text_representation
  });

  it('cascades deletes from an organization to its environments and keys', async () => {
    const { organization, environment } = await createOrganizationWithSandbox('Cascade Org');
    const key = generateApiKey('sandbox', pepper);
    await db.insert(apiKeys).values({
      id: testId('key'),
      environmentId: environment.id,
      name: 'doomed',
      prefix: key.prefix,
      secretHash: key.secretHash,
    });

    await db.delete(organizations).where(eq(organizations.id, organization.id));

    expect(await db.select().from(environments).where(eq(environments.id, environment.id))).toEqual(
      [],
    );
    expect(await db.select().from(apiKeys).where(eq(apiKeys.secretHash, key.secretHash))).toEqual(
      [],
    );
  });

  it('can create and use the pgvector extension', async () => {
    await db.execute(sql`create extension if not exists vector`);

    const installed = await db.execute<{ extname: string }>(
      sql`select extname from pg_extension where extname = 'vector'`,
    );
    const distance = await db.execute<{ distance: number }>(
      sql`select '[1,2,3]'::vector <-> '[1,2,5]'::vector as distance`,
    );
    expect(installed.rows).toEqual([{ extname: 'vector' }]);
    expect(distance.rows[0]?.distance).toBe(2);
  });

  it('stores encrypted columns as ciphertext and decrypts them on read', async () => {
    await db.execute(
      sql`create table encrypted_probe (id serial primary key, secret text not null)`,
    );
    const probe = pgTable('encrypted_probe', {
      id: serial('id').primaryKey(),
      secret: encrypted('secret', { keyring, context: 'encrypted_probe.secret' }),
    });

    const [inserted] = await db.insert(probe).values({ secret: 'Jane Example' }).returning();
    const raw = await db.execute<{ secret: string }>(sql`select secret from encrypted_probe`);
    const [read] = await db.select().from(probe);

    expect(inserted?.secret).toBe('Jane Example');
    expect(raw.rows[0]?.secret).toMatch(/^ov1\./);
    expect(raw.rows[0]?.secret).not.toContain('Jane');
    expect(read?.secret).toBe('Jane Example');
  });
});
