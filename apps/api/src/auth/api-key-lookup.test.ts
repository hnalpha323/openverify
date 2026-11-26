import { newId } from '@openverify/contracts';
import {
  apiKeyPepperId,
  createApiKey,
  generateApiKey,
  getApiKey,
  hashApiKeySecret,
  revokeApiKey,
  type Db,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../test-support/fakes.js';
import { createDbApiKeyAuthenticator } from './api-key-lookup.js';

const PEPPER = new TextEncoder().encode('synthetic-pepper-for-tests-0123456789abcdef');
const OTHER_PEPPER = new TextEncoder().encode('another-synthetic-pepper-0123456789abcdef');

let database: TestDatabase;
let db: Db;
let organizationId: string;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  ({
    organization: { id: organizationId },
    environment: { id: environmentId },
  } = await createTestTenant(db));
}, 60_000);

afterAll(async () => {
  await database.close();
});

async function insertKey(
  options: { scopes?: string[]; expiresAt?: Date | null; pepper?: Uint8Array } = {},
) {
  const generated = generateApiKey('sandbox', options.pepper ?? PEPPER);
  const row = await createApiKey(db, environmentId, {
    id: newId('key'),
    name: 'Test key',
    prefix: generated.prefix,
    secretHash: generated.secretHash,
    scopes: options.scopes ?? ['inquiries:read'],
    allowedIps: ['10.0.0.0/8'],
    expiresAt: options.expiresAt ?? null,
  });
  return { token: generated.token, row };
}

async function lastUsedAt(id: string): Promise<Date | null> {
  const result = await database.client.query<{ last_used_at: Date | string | null }>(
    'select last_used_at from api_keys where id = $1',
    [id],
  );
  const value = result.rows[0]?.last_used_at ?? null;
  return value === null ? null : new Date(value);
}

describe('createDbApiKeyAuthenticator', () => {
  it('finds a key by the peppered hash of its token', async () => {
    const { token, row } = await insertKey({ scopes: ['inquiries:read', 'webhooks:write'] });
    const { lookup } = createDbApiKeyAuthenticator({ db, pepper: PEPPER });

    expect(await lookup(token)).toEqual({
      id: row.id,
      organizationId,
      environmentId,
      environmentKind: 'sandbox',
      scopes: ['inquiries:read', 'webhooks:write'],
      expiresAt: null,
      revokedAt: null,
      allowedIps: ['10.0.0.0/8'],
      piiMasked: false,
    });
  });

  it('reports the kind of the environment the key belongs to (C12 principals)', async () => {
    const { organization, environment } = await createTestTenant(db, { kind: 'production' });
    const generated = generateApiKey('production', PEPPER);
    await createApiKey(db, environment.id, {
      id: newId('key'),
      name: 'Production test key',
      prefix: generated.prefix,
      secretHash: generated.secretHash,
    });
    const { lookup } = createDbApiKeyAuthenticator({ db, pepper: PEPPER });

    expect(await lookup(generated.token)).toMatchObject({
      organizationId: organization.id,
      environmentId: environment.id,
      environmentKind: 'production',
    });
  });

  it('returns revoked and expired keys, so the auth plugin can say why it refuses them', async () => {
    const expiresAt = new Date('2026-01-01T00:00:00.000Z');
    const { token, row } = await insertKey({ expiresAt });
    await revokeApiKey(db, environmentId, row.id, new Date('2026-02-01T00:00:00.000Z'));
    const { lookup } = createDbApiKeyAuthenticator({ db, pepper: PEPPER });

    expect(await lookup(token)).toMatchObject({
      expiresAt,
      revokedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
  });

  it('does not find an unknown token', async () => {
    const { lookup } = createDbApiKeyAuthenticator({ db, pepper: PEPPER });

    expect(await lookup('ov_sbx_SyntheticUnknownTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
  });

  it('does not find a key when the server pepper differs', async () => {
    const { token } = await insertKey();
    const { lookup } = createDbApiKeyAuthenticator({ db, pepper: OTHER_PEPPER });

    expect(await lookup(token)).toBeNull();
  });

  it('records when a key was last used, at most once per interval', async () => {
    const { row } = await insertKey();
    const clock = fixedClock();
    const { touch } = createDbApiKeyAuthenticator({
      db,
      pepper: PEPPER,
      clock,
      touchIntervalMs: 60_000,
    });
    const key = { id: row.id, environmentId, scopes: row.scopes };

    await touch(key);
    const first = clock.now();
    expect(await lastUsedAt(row.id)).toEqual(first);

    clock.advance(30_000);
    await touch(key);
    expect(await lastUsedAt(row.id)).toEqual(first);

    clock.advance(31_000);
    await touch(key);
    expect(await lastUsedAt(row.id)).toEqual(clock.now());
  });

  it('only touches the key in its own environment', async () => {
    const { row } = await insertKey();
    const { environment: other } = await createTestTenant(db);
    const { touch } = createDbApiKeyAuthenticator({ db, pepper: PEPPER });

    await touch({ id: row.id, environmentId: other.id, scopes: [] });

    expect(await lastUsedAt(row.id)).toBeNull();
  });

  it('defaults to the system clock', async () => {
    const { row } = await insertKey();
    const { touch } = createDbApiKeyAuthenticator({ db, pepper: PEPPER });
    const before = Date.now();

    await touch({ id: row.id, environmentId, scopes: [] });

    expect((await lastUsedAt(row.id))?.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('createDbApiKeyAuthenticator under a rotated pepper (C247.1, Workflow 11B)', () => {
  const EARLIER = new TextEncoder().encode('synthetic-earlier-pepper-0123456789abcdef');
  const EARLIEST = new TextEncoder().encode('synthetic-earliest-pepper-0123456789abcde');

  const stored = async (id: string) => getApiKey(db, environmentId, id);

  it('finds a key made under an earlier pepper and moves it to the current one in the same request', async () => {
    const { token, row } = await insertKey({ pepper: EARLIER });
    const { lookup } = createDbApiKeyAuthenticator({
      db,
      pepper: PEPPER,
      previousPeppers: [EARLIEST, EARLIER],
    });

    await expect(lookup(token)).resolves.toMatchObject({ id: row.id, environmentId });

    const after = await stored(row.id);
    expect(after?.secretHash).toBe(hashApiKeySecret(token, PEPPER));
    expect(after?.pepperKeyId).toBe(apiKeyPepperId(PEPPER));
    expect(after?.prefix).toBe(row.prefix);
    // Found again under the current pepper alone, so the earlier one can go.
    const current = createDbApiKeyAuthenticator({ db, pepper: PEPPER });
    await expect(current.lookup(token)).resolves.toMatchObject({ id: row.id });
  });

  it('names the pepper of a key from before 11B the first time a lookup proves it', async () => {
    const { token, row } = await insertKey();
    expect((await stored(row.id))?.pepperKeyId).toBeNull();
    const { lookup } = createDbApiKeyAuthenticator({
      db,
      pepper: PEPPER,
      previousPeppers: [EARLIER],
    });

    await lookup(token);

    const after = await stored(row.id);
    expect(after?.pepperKeyId).toBe(apiKeyPepperId(PEPPER));
    expect(after?.secretHash).toBe(row.secretHash);
  });

  it('never finds a key under a pepper it was not given', async () => {
    const { token } = await insertKey({ pepper: EARLIEST });
    const { lookup } = createDbApiKeyAuthenticator({
      db,
      pepper: PEPPER,
      previousPeppers: [EARLIER],
    });

    await expect(lookup(token)).resolves.toBeNull();
  });

  it('still answers a key found under an earlier pepper when another request moved it first', async () => {
    const { token, row } = await insertKey({ pepper: EARLIER });
    const options = { db, pepper: PEPPER, previousPeppers: [EARLIER] };

    const [first, second] = await Promise.all([
      createDbApiKeyAuthenticator(options).lookup(token),
      createDbApiKeyAuthenticator(options).lookup(token),
    ]);

    expect(first?.id).toBe(row.id);
    expect(second?.id).toBe(row.id);
    expect((await stored(row.id))?.pepperKeyId).toBe(apiKeyPepperId(PEPPER));
  });
});
