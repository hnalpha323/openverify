import { describe, expect, it } from 'vitest';
import { ARGON2ID_OPTIONS, createArgon2idHasher, hashPassword } from './password-hasher.js';

// Synthetic credentials only.
const PASSWORD = 'correct horse battery staple';

/** `$argon2id$v=19$m=19456,t=2,p=1$<16-byte salt>$<32-byte hash>` in unpadded base64. */
const OWASP_PHC = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/;

describe('ARGON2ID_OPTIONS', () => {
  it('follows the OWASP Password Storage Cheat Sheet minimum for Argon2id', () => {
    expect(ARGON2ID_OPTIONS).toEqual({
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
    expect(Object.isFrozen(ARGON2ID_OPTIONS)).toBe(true);
  });
});

describe('createArgon2idHasher', () => {
  const hasher = createArgon2idHasher();

  it('hashes to an Argon2id PHC string with the OWASP parameters', async () => {
    await expect(hasher.hash(PASSWORD)).resolves.toMatch(OWASP_PHC);
  });

  it('salts every hash, so the same password never hashes the same twice', async () => {
    const [first, second] = await Promise.all([hasher.hash(PASSWORD), hasher.hash(PASSWORD)]);

    expect(first).not.toBe(second);
  });

  it('verifies the right password and rejects any other', async () => {
    const stored = await hasher.hash(PASSWORD);

    await expect(hasher.verify(stored, PASSWORD)).resolves.toBe(true);
    await expect(hasher.verify(stored, `${PASSWORD} `)).resolves.toBe(false);
    await expect(hasher.verify(stored, '')).resolves.toBe(false);
  });

  it('treats a malformed stored hash as a mismatch instead of throwing', async () => {
    await expect(hasher.verify('$argon2id$not-a-hash', PASSWORD)).resolves.toBe(false);
    await expect(hasher.verify('', PASSWORD)).resolves.toBe(false);
  });

  it('verifies hashes made with other parameters, as stored hashes carry their own', async () => {
    const cheap = createArgon2idHasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });
    const stored = await cheap.hash(PASSWORD);

    expect(stored).toMatch(/^\$argon2id\$v=19\$m=1024,t=1,p=1\$/);
    await expect(hasher.verify(stored, PASSWORD)).resolves.toBe(true);
  });
});

describe('hashPassword', () => {
  it('hashes with the default OWASP parameters, e.g. for the dev seed', async () => {
    const stored = await hashPassword(PASSWORD);

    expect(stored).toMatch(OWASP_PHC);
    await expect(createArgon2idHasher().verify(stored, PASSWORD)).resolves.toBe(true);
  });
});
