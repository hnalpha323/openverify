/**
 * C247.1 (Workflow 11B, auth-sessions) against Postgres 17: two requests carrying the same token,
 * made under an earlier pepper, race to re-hash it. Each runs on its own pooled connection, both
 * authenticate the key, the compare-and-set lets one move it, and the row ends under the current
 * pepper; the keys are then counted per pepper. Every pepper and token is synthetic.
 */
import { newId } from '@openverify/contracts';
import {
  apiKeyPepperId,
  countApiKeysByPepper,
  createApiKey,
  createDatabase,
  generateApiKey,
  getApiKey,
  hashApiKeySecret,
  runMigrations,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbApiKeyAuthenticator } from './api-key-lookup.js';

const CURRENT = new TextEncoder().encode('synthetic-current-pepper-0123456789abcdef');
const EARLIER = new TextEncoder().encode('synthetic-earlier-pepper-0123456789abcdef');

let postgres: StartedPostgreSqlContainer;
let pool: Pool;
let db: Database;

beforeAll(async () => {
  postgres = await startIntegrationPostgres();
  pool = createIntegrationPool(postgres.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  await runMigrations(db);
});

afterAll(async () => {
  await pool.end();
  await ifSet(postgres)?.stop();
});

describe('a rotated pepper under concurrent requests (C247.1)', () => {
  it('lets two requests with one token both authenticate while the compare-and-set re-hashes it once', async () => {
    const { environment } = await createTestTenant(db);
    const keys = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const generated = generateApiKey('sandbox', EARLIER);
        const row = await createApiKey(db, environment.id, {
          id: newId('key'),
          name: `Synthetic race ${String(index)}`,
          prefix: generated.prefix,
          tokenPrefix: generated.tokenPrefix,
          secretHash: generated.secretHash,
          scopes: ['inquiries:read'],
        });
        return { token: generated.token, row };
      }),
    );
    const options = { db, pepper: CURRENT, previousPeppers: [EARLIER] };
    const first = createDbApiKeyAuthenticator(options);
    const second = createDbApiKeyAuthenticator(options);

    const answers = await Promise.all(
      keys.flatMap(({ token }) => [first.lookup(token), second.lookup(token)]),
    );

    expect(answers.map((answer) => answer?.id)).toEqual(
      keys.flatMap(({ row }) => [row.id, row.id]),
    );
    for (const { token, row } of keys) {
      const stored = await getApiKey(db, environment.id, row.id);
      expect(stored?.secretHash).toBe(hashApiKeySecret(token, CURRENT));
      expect(stored?.pepperKeyId).toBe(apiKeyPepperId(CURRENT));
      expect(stored?.tokenPrefix).toBe(row.tokenPrefix);
    }
    const counts = await countApiKeysByPepper(db);
    expect(counts.find(({ pepperKeyId }) => pepperKeyId === apiKeyPepperId(CURRENT))?.count).toBe(
      20,
    );
    expect(
      counts.find(({ pepperKeyId }) => pepperKeyId === apiKeyPepperId(EARLIER)),
    ).toBeUndefined();
  });

  it('keeps finding a moved key under the current pepper alone, and nothing under the earlier one', async () => {
    const { environment } = await createTestTenant(db);
    const generated = generateApiKey('sandbox', EARLIER);
    const row = await createApiKey(db, environment.id, {
      id: newId('key'),
      name: 'Synthetic moved',
      prefix: generated.prefix,
      secretHash: generated.secretHash,
    });
    await createDbApiKeyAuthenticator({ db, pepper: CURRENT, previousPeppers: [EARLIER] }).lookup(
      generated.token,
    );

    await expect(
      createDbApiKeyAuthenticator({ db, pepper: CURRENT }).lookup(generated.token),
    ).resolves.toMatchObject({ id: row.id });
    await expect(
      createDbApiKeyAuthenticator({ db, pepper: EARLIER }).lookup(generated.token),
    ).resolves.toBeNull();
  });
});
