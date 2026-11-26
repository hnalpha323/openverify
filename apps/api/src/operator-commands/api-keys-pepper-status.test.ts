/**
 * C247.1 (Workflow 11B, auth-sessions): `api-keys:pepper-status` counts the keys under the current
 * pepper, under each earlier one, not yet proved since 11B, and under a pepper no longer configured;
 * it never prints a key, a token or a hash. Every pepper is random per run.
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import {
  apiKeyPepperId,
  createApiKey,
  generateApiKey,
  moveApiKeyToPepper,
  type Db,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PEPPER_STATUS_USAGE, runPepperStatus } from './api-keys-pepper-status.js';

let database: TestDatabase;
let db: Db;
const current = randomBytes(32);
const earlier = randomBytes(32);
const removed = randomBytes(32);
const tokens: string[] = [];

/** A key under `pepper`, named with its pepper id unless it is from before 11B. */
async function keyUnder(pepper: Uint8Array, proved = true) {
  const { environment } = await createTestTenant(db);
  const generated = generateApiKey('sandbox', pepper);
  tokens.push(generated.token);
  const row = await createApiKey(db, environment.id, {
    id: newId('key'),
    name: 'Synthetic status',
    prefix: generated.prefix,
    secretHash: generated.secretHash,
  });
  if (proved) {
    await moveApiKeyToPepper(db, {
      id: row.id,
      from: { secretHash: generated.secretHash, pepperKeyId: null },
      to: { secretHash: generated.secretHash, pepperKeyId: apiKeyPepperId(pepper), current: true },
    });
  }
  return generated.secretHash;
}

const hashes: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  hashes.push(
    await keyUnder(current),
    await keyUnder(current),
    await keyUnder(current),
    await keyUnder(earlier),
    await keyUnder(earlier),
    await keyUnder(current, false),
    await keyUnder(removed),
  );
});

afterAll(async () => {
  await database.close();
});

function run(argv: readonly string[], previous: readonly Uint8Array[] = [earlier]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runPepperStatus({
    db,
    current,
    previous,
    argv,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => err.push(chunk) },
  });
  return code.then((exit) => ({ exit, out: out.join(''), err: err.join('') }));
}

describe('api-keys:pepper-status (C247.1)', () => {
  it('counts the keys per pepper in words, naming peppers by their ids only', async () => {
    const { exit, out, err } = await run([]);

    expect(exit).toBe(0);
    expect(err).toBe('');
    expect(out).toContain(`Current pepper (id ${apiKeyPepperId(current)}): 3 keys`);
    expect(out).toContain(`Earlier pepper 1 (id ${apiKeyPepperId(earlier)}): 2 keys`);
    expect(out).toContain(
      'Not yet proved (made before pepper ids were kept, not used since): 1 key',
    );
    expect(out).toContain(
      `Under a pepper no longer configured (id ${apiKeyPepperId(removed)}): 1 key`,
    );
    expect(out).toContain(
      'Remove an earlier pepper from OPENVERIFY_API_KEY_PEPPER_PREVIOUS only when its count is 0',
    );
  });

  it('answers the same counts as JSON with --json', async () => {
    const { exit, out } = await run(['--json']);

    expect(exit).toBe(0);
    expect(JSON.parse(out)).toEqual({
      current: { 'pepper-id': apiKeyPepperId(current), keys: 3 },
      earlier: [{ 'pepper-id': apiKeyPepperId(earlier), keys: 2 }],
      'not-proved': 1,
      'not-configured': [{ 'pepper-id': apiKeyPepperId(removed), keys: 1 }],
    });
  });

  it('lists an earlier pepper holding no key with 0, so it can be removed', async () => {
    const { out } = await run([], [earlier, randomBytes(32)]);

    expect(out).toMatch(/Earlier pepper 2 \(id [0-9a-f]{16}\): 0 keys/);
  });

  it('never prints a key, a token or a hash', async () => {
    for (const argv of [[], ['--json']]) {
      const { out, err } = await run(argv);
      for (const value of [...tokens, ...hashes]) {
        expect(out + err).not.toContain(value);
      }
      expect(out + err).not.toMatch(/[0-9a-f]{64}/);
    }
  });

  it('prints the usage and answers 2 for an argument it does not know', async () => {
    const { exit, out, err } = await run(['--hashes']);

    expect(exit).toBe(2);
    expect(out).toBe('');
    expect(err).toBe(PEPPER_STATUS_USAGE);
  });
});
