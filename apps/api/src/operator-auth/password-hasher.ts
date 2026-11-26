import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * Argon2id parameters from the OWASP Password Storage Cheat Sheet (minimum configuration):
 * 19 MiB of memory, 2 iterations, 1 degree of parallelism. The salt is 16 random bytes and
 * the output 32 bytes. `@node-rs/argon2` defaults to Argon2id, version 0x13; tests pin the
 * PHC prefix (`$argon2id$v=19$m=19456,t=2,p=1$`) so a library default change cannot slip by.
 */
export const ARGON2ID_OPTIONS = Object.freeze({
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} satisfies Options);

export type Argon2idOptions = Pick<
  Options,
  'memoryCost' | 'timeCost' | 'parallelism' | 'outputLen'
>;

/** Hashes and verifies operator passwords. Implementations must be Argon2id (C4). */
export interface PasswordHasher {
  /** An Argon2id PHC string (`$argon2id$v=19$m=...`) with a fresh random salt. */
  hash(password: string): Promise<string>;
  /**
   * Whether `password` matches `passwordHash`. The parameters come from the stored PHC
   * string, so hashes made under older settings keep verifying. A malformed hash is a
   * mismatch, never an exception.
   */
  verify(passwordHash: string, password: string): Promise<boolean>;
}

/** The production hasher: Argon2id on the libuv thread pool, so it never blocks the event loop. */
export function createArgon2idHasher(options: Argon2idOptions = ARGON2ID_OPTIONS): PasswordHasher {
  const hashOptions: Options = { ...options };
  return {
    hash: (password) => hash(password, hashOptions),
    verify: async (passwordHash, password) => {
      try {
        return await verify(passwordHash, password);
      } catch {
        return false;
      }
    },
  };
}

const defaultHasher = createArgon2idHasher();

/** Hashes a password with {@link ARGON2ID_OPTIONS}, for example to seed an operator. */
export function hashPassword(password: string): Promise<string> {
  return defaultHasher.hash(password);
}
