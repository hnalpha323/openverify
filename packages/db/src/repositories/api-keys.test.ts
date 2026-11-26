import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateApiKey } from '../api-keys.js';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '../testing.js';
import {
  createApiKey,
  findApiKeyBySecretHash,
  revokeApiKey,
  touchApiKeyLastUsed,
} from './api-keys.js';

// Synthetic per-run pepper.
const pepper = randomBytes(32);
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

async function newKey(overrides: { expiresAt?: Date } = {}) {
  const { environment } = await createTestTenant(database.db);
  const generated = generateApiKey('sandbox', pepper);
  const apiKey = await createApiKey(database.db, environment.id, {
    id: testId('key'),
    name: 'Server key',
    prefix: generated.prefix,
    secretHash: generated.secretHash,
    scopes: ['inquiries:read', 'inquiries:write'],
    allowedIps: ['10.0.0.0/8'],
    ...overrides,
  });
  return { environment, generated, apiKey };
}

describe('API keys', () => {
  it('creates a key in an environment with its scopes and allowlist', async () => {
    const { environment, apiKey } = await newKey();

    expect(apiKey).toMatchObject({
      environmentId: environment.id,
      name: 'Server key',
      prefix: 'ov_sbx_',
      scopes: ['inquiries:read', 'inquiries:write'],
      allowedIps: ['10.0.0.0/8'],
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    });
  });

  it('defaults scopes to none and the allowlist to any address', async () => {
    const { environment } = await createTestTenant(database.db);
    const generated = generateApiKey('sandbox', pepper);

    const apiKey = await createApiKey(database.db, environment.id, {
      id: testId('key'),
      name: 'Bare',
      prefix: generated.prefix,
      secretHash: generated.secretHash,
    });

    expect(apiKey.scopes).toEqual([]);
    expect(apiKey.allowedIps).toBeNull();
  });

  it('finds a key and its environment by secret hash, for the auth plugin', async () => {
    const { environment, generated, apiKey } = await newKey();

    const found = await findApiKeyBySecretHash(database.db, generated.secretHash);

    expect(found?.apiKey).toEqual(apiKey);
    expect(found?.environment).toEqual(environment);
    expect(await findApiKeyBySecretHash(database.db, 'f'.repeat(64))).toBeNull();
  });

  it('still finds revoked and expired keys, so the caller can say why they fail', async () => {
    const { environment, generated, apiKey } = await newKey({
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    await revokeApiKey(database.db, environment.id, apiKey.id);

    const found = await findApiKeyBySecretHash(database.db, generated.secretHash);

    expect(found?.apiKey.revokedAt).toBeInstanceOf(Date);
    expect(found?.apiKey.expiresAt).toEqual(new Date('2020-01-01T00:00:00.000Z'));
  });

  it('records last use at most once per interval', async () => {
    const { environment, apiKey } = await newKey();
    const first = new Date('2026-10-20T10:00:00.000Z');

    expect(await touchApiKeyLastUsed(database.db, environment.id, apiKey.id, { at: first })).toBe(
      true,
    );
    expect(
      await touchApiKeyLastUsed(database.db, environment.id, apiKey.id, {
        at: new Date(first.getTime() + 30_000),
      }),
    ).toBe(false);
    expect(
      await touchApiKeyLastUsed(database.db, environment.id, apiKey.id, {
        at: new Date(first.getTime() + 61_000),
        minIntervalMs: 60_000,
      }),
    ).toBe(true);
    const found = await findApiKeyBySecretHash(database.db, apiKey.secretHash);
    expect(found?.apiKey.lastUsedAt).toEqual(new Date(first.getTime() + 61_000));
  });

  it('touches with the current time by default', async () => {
    const { environment, apiKey } = await newKey();

    expect(await touchApiKeyLastUsed(database.db, environment.id, apiKey.id)).toBe(true);
    const found = await findApiKeyBySecretHash(database.db, apiKey.secretHash);
    expect(Math.abs((found?.apiKey.lastUsedAt?.getTime() ?? 0) - Date.now())).toBeLessThan(10_000);
  });

  it('only touches and revokes keys in the given environment', async () => {
    const { apiKey } = await newKey();
    const other = await createTestTenant(database.db);

    expect(await touchApiKeyLastUsed(database.db, other.environment.id, apiKey.id)).toBe(false);
    expect(await revokeApiKey(database.db, other.environment.id, apiKey.id)).toBeNull();
  });

  it('revokes a key once', async () => {
    const { environment, apiKey } = await newKey();
    const at = new Date('2026-10-20T12:00:00.000Z');

    const revoked = await revokeApiKey(database.db, environment.id, apiKey.id, at);

    expect(revoked?.revokedAt).toEqual(at);
    expect(await revokeApiKey(database.db, environment.id, apiKey.id)).toBeNull();
  });
});
