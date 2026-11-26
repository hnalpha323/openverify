/**
 * C247.1 (Phase 11, Workflow 11B, auth-sessions; amendment 9): API keys under a rotated pepper. A
 * token is found by any of its candidate hashes in one query; a key found under an earlier pepper is
 * moved to the current one by a compare-and-set on `(secret_hash, pepper_key_id)`; the keys are
 * counted per pepper id. Every pepper here is random per run.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiKeyHashCandidates,
  apiKeyPepperId,
  countApiKeysByPepper,
  findApiKeyByPepperedHashes,
  generateApiKey,
  hashApiKeySecret,
  moveApiKeyToPepper,
} from './api-keys.js';
import { createApiKey, getApiKey } from './repositories/index.js';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from './testing.js';

let database: TestDatabase;

/** The current pepper's candidate of `token`. */
function currentOf(token: string, pepper: Uint8Array) {
  const [current] = apiKeyHashCandidates(token, pepper, []);
  if (current === undefined) {
    throw new Error('no candidate');
  }
  return current;
}

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

/** A key made under `pepper`, with or without its pepper id (a key from before 11B has none). */
async function keyUnder(pepper: Uint8Array, options: { stamped?: boolean } = {}) {
  const { environment } = await createTestTenant(database.db);
  const generated = generateApiKey('sandbox', pepper);
  const apiKey = await createApiKey(database.db, environment.id, {
    id: testId('key'),
    name: 'Synthetic rotation',
    prefix: generated.prefix,
    tokenPrefix: generated.tokenPrefix,
    secretHash: generated.secretHash,
    scopes: ['inquiries:read'],
  });
  if (options.stamped === true) {
    await moveApiKeyToPepper(database.db, {
      id: apiKey.id,
      from: { secretHash: generated.secretHash, pepperKeyId: null },
      to: { secretHash: generated.secretHash, pepperKeyId: apiKeyPepperId(pepper), current: true },
    });
  }
  return { apiKey, token: generated.token, environment };
}

describe('findApiKeyByPepperedHashes (C247.1)', () => {
  it('finds a key under the current pepper, naming that candidate', async () => {
    const current = randomBytes(32);
    const { apiKey, token, environment } = await keyUnder(current);

    const found = await findApiKeyByPepperedHashes(
      database.db,
      apiKeyHashCandidates(token, current, [randomBytes(32)]),
    );

    expect(found?.apiKey.id).toBe(apiKey.id);
    expect(found?.environment.id).toBe(environment.id);
    expect(found?.candidate).toMatchObject({ pepperKeyId: apiKeyPepperId(current), current: true });
  });

  it('finds a key under an earlier pepper, naming that candidate', async () => {
    const earlier = randomBytes(32);
    const { apiKey, token } = await keyUnder(earlier);

    const found = await findApiKeyByPepperedHashes(
      database.db,
      apiKeyHashCandidates(token, randomBytes(32), [randomBytes(32), earlier]),
    );

    expect(found?.apiKey.id).toBe(apiKey.id);
    expect(found?.candidate).toMatchObject({
      pepperKeyId: apiKeyPepperId(earlier),
      current: false,
    });
  });

  it('answers null for a token under no pepper, and for no candidate', async () => {
    const { token } = await keyUnder(randomBytes(32));

    await expect(
      findApiKeyByPepperedHashes(database.db, apiKeyHashCandidates(token, randomBytes(32), [])),
    ).resolves.toBeNull();
    await expect(findApiKeyByPepperedHashes(database.db, [])).resolves.toBeNull();
  });
});

describe('moveApiKeyToPepper (C247.1)', () => {
  it('re-hashes a key under the current pepper and names it, once', async () => {
    const earlier = randomBytes(32);
    const current = randomBytes(32);
    const { apiKey, token, environment } = await keyUnder(earlier, { stamped: true });
    const to = currentOf(token, current);
    const from = {
      secretHash: hashApiKeySecret(token, earlier),
      pepperKeyId: apiKeyPepperId(earlier),
    };

    await expect(moveApiKeyToPepper(database.db, { id: apiKey.id, from, to: to })).resolves.toBe(
      true,
    );
    await expect(moveApiKeyToPepper(database.db, { id: apiKey.id, from, to: to })).resolves.toBe(
      false,
    );

    const stored = await getApiKey(database.db, environment.id, apiKey.id);
    expect(stored?.secretHash).toBe(hashApiKeySecret(token, current));
    expect(stored?.pepperKeyId).toBe(apiKeyPepperId(current));
    expect(stored?.tokenPrefix).toBe(apiKey.tokenPrefix);
    expect(stored?.prefix).toBe(apiKey.prefix);
  });

  it('stamps a key from before 11B with the pepper a lookup proved, and only from null', async () => {
    const current = randomBytes(32);
    const { apiKey, token, environment } = await keyUnder(current);
    const to = currentOf(token, current);

    await expect(
      moveApiKeyToPepper(database.db, {
        id: apiKey.id,
        from: { secretHash: to.secretHash, pepperKeyId: apiKeyPepperId(randomBytes(32)) },
        to: to,
      }),
    ).resolves.toBe(false);
    await expect(
      moveApiKeyToPepper(database.db, {
        id: apiKey.id,
        from: { secretHash: to.secretHash, pepperKeyId: null },
        to: to,
      }),
    ).resolves.toBe(true);
    expect((await getApiKey(database.db, environment.id, apiKey.id))?.pepperKeyId).toBe(
      apiKeyPepperId(current),
    );
  });
});

describe('countApiKeysByPepper (C247.1)', () => {
  it('counts the keys of each pepper id across environments, and the unproved ones as null', async () => {
    const before = await countApiKeysByPepper(database.db);
    const nullBefore = before.find(({ pepperKeyId }) => pepperKeyId === null)?.count ?? 0;
    const earlier = randomBytes(32);
    await keyUnder(earlier, { stamped: true });
    await keyUnder(earlier, { stamped: true });
    await keyUnder(randomBytes(32));

    const counts = await countApiKeysByPepper(database.db);

    expect(counts.find(({ pepperKeyId }) => pepperKeyId === apiKeyPepperId(earlier))?.count).toBe(
      2,
    );
    expect(counts.find(({ pepperKeyId }) => pepperKeyId === null)?.count).toBe(nullBefore + 1);
    expect(JSON.stringify(counts)).not.toMatch(/[0-9a-f]{64}/);
  });
});
