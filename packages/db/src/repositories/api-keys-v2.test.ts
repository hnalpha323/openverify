/** C12 API-keys API: list, read, rename, IP allowlist, expire, API version, token prefix. */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { generateApiKey } from '../api-keys.js';
import { InvalidCursorError } from '../errors.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import { createApiKey, expireApiKey, getApiKey, listApiKeys, updateApiKey } from './index.js';

let database: TestDatabase;
const pepper = randomBytes(32);

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

async function setup() {
  const env = (await createTestTenant(database.db)).environment.id;
  const create = (name = 'Server') => {
    const generated = generateApiKey('sandbox', pepper);
    return createApiKey(database.db, env, {
      id: testId('key'),
      name,
      prefix: generated.prefix,
      tokenPrefix: generated.tokenPrefix,
      secretHash: generated.secretHash,
      scopes: ['inquiries:read'],
      apiVersion: '2026-10-01',
      createdById: testId('usr'),
    }).then((apiKey) => ({ apiKey, generated }));
  };
  return { env, create };
}

describe('API keys (C12)', () => {
  it('store the token prefix, API version and creator', async () => {
    const { env, create } = await setup();

    const { apiKey, generated } = await create();

    expect(generated.tokenPrefix).toBe(generated.token.slice(0, 'ov_sbx_'.length + 4));
    expect(apiKey).toMatchObject({
      tokenPrefix: generated.tokenPrefix,
      apiVersion: '2026-10-01',
      createdById: expect.stringMatching(/^usr_/) as string,
    });
    expect(await getApiKey(database.db, env, apiKey.id)).toEqual(apiKey);
    expect(await getApiKey(database.db, testId('env'), apiKey.id)).toBeNull();
  });

  it('record whether the key sees PII masked: unmasked unless asked, so older keys keep their access (2B F001)', async () => {
    const { env, create } = await setup();
    const generated = generateApiKey('sandbox', pepper);

    const { apiKey: plain } = await create();
    const masked = await createApiKey(database.db, env, {
      id: testId('key'),
      name: 'Minted without pii:view',
      prefix: generated.prefix,
      secretHash: generated.secretHash,
      scopes: ['inquiries:read'],
      piiMasked: true,
    });

    expect(plain.piiMasked).toBe(false);
    expect(masked.piiMasked).toBe(true);
    expect((await getApiKey(database.db, env, masked.id))?.piiMasked).toBe(true);
  });

  it('list newest first with the C1 cursor', async () => {
    onTestFinished(wallClockStepsBack());
    const { env, create } = await setup();
    const clock = createdAtClock(database.db);
    const { apiKey: a } = await create('a');
    await clock.at('api_keys', a.id);
    const { apiKey: b } = await create('b');
    await clock.at('api_keys', b.id);

    const page = await listApiKeys(database.db, env, { size: 1 });

    expect(page).toMatchObject({ items: [{ id: b.id }], next: b.id });
    expect(
      (await listApiKeys(database.db, env, { after: b.id })).items.map((key) => key.id),
    ).toEqual([a.id]);
    await expect(listApiKeys(database.db, env, { after: testId('key') })).rejects.toThrow(
      InvalidCursorError,
    );
  });

  it('rename, change the allowlist and expire', async () => {
    const { env, create } = await setup();
    const { apiKey } = await create();
    const at = new Date('2026-11-01T00:00:00.000Z');

    const renamed = await updateApiKey(database.db, env, apiKey.id, {
      name: 'Renamed',
      allowedIps: ['192.0.2.0/24'],
    });
    const cleared = await updateApiKey(database.db, env, apiKey.id, { allowedIps: null });
    const same = await updateApiKey(database.db, env, apiKey.id, {});
    const expired = await expireApiKey(database.db, env, apiKey.id, at);

    expect(renamed).toMatchObject({ name: 'Renamed', allowedIps: ['192.0.2.0/24'] });
    expect(cleared?.allowedIps).toBeNull();
    expect(same).toEqual(cleared);
    expect(expired?.expiresAt).toEqual(at);
    expect(await updateApiKey(database.db, testId('env'), apiKey.id, { name: 'x' })).toBeNull();
    expect(await expireApiKey(database.db, testId('env'), apiKey.id, at)).toBeNull();
  });
});
