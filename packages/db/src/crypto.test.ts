import { randomBytes } from 'node:crypto';
import { pgTable } from 'drizzle-orm/pg-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DecryptionError,
  KeyringError,
  createKeyring,
  decrypt,
  decryptBytes,
  encrypt,
  encryptBytes,
  encrypted,
  encryptedJson,
  getDefaultKeyring,
  keyringFromEnv,
  needsRewrap,
  OTP_KEY_HKDF_INFO,
  otpKey,
  rewrap,
  rewrapDek,
  setDefaultKeyring,
  type Keyring,
} from './crypto.js';

// Synthetic, throwaway key-encryption keys generated per test run.
const kekA = randomBytes(32);
const kekB = randomBytes(32);
const kekC = randomBytes(32);
const b64 = (key: Uint8Array): string => Buffer.from(key).toString('base64');

const ENVELOPE = /^ov1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{80}\.[A-Za-z0-9_-]+$/;

function segments(envelope: string): [string, string, string, string] {
  const parts = envelope.split('.');
  expect(parts).toHaveLength(4);
  return parts as [string, string, string, string];
}

function thrownMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the function to throw');
}

function flipByteInSegment(envelope: string, segmentIndex: number, byteIndex: number): string {
  const parts = segments(envelope);
  const bytes = Buffer.from(parts[segmentIndex] ?? '', 'base64url');
  bytes[byteIndex] = (bytes[byteIndex] ?? 0) ^ 0x01;
  parts[segmentIndex] = bytes.toString('base64url');
  return parts.join('.');
}

describe('encrypt / decrypt', () => {
  let keyring: Keyring;
  beforeAll(() => {
    keyring = createKeyring(kekA);
  });

  it.each([
    ['ascii', 'Jane Q. Example'],
    ['empty string', ''],
    ['multi-byte UTF-8', 'Zoë Ñúñez 李小龍 🛂'],
    ['long text', 'x'.repeat(10_000)],
  ])('round-trips %s', (_label, plaintext) => {
    expect(decrypt(encrypt(plaintext, keyring), keyring)).toBe(plaintext);
  });

  it('produces a versioned compact envelope that names the KEK id', () => {
    const envelope = encrypt('synthetic-value', keyring);

    expect(envelope).toMatch(ENVELOPE);
    expect(segments(envelope)[1]).toBe(keyring.currentKeyId);
    expect(envelope).not.toContain('synthetic-value');
  });

  it('uses a fresh 12-byte IV and a wrapped 32-byte DEK for every value', () => {
    const plaintext = 'same plaintext';
    const [, , wrappedA, payloadA] = segments(encrypt(plaintext, keyring));
    const [, , wrappedB, payloadB] = segments(encrypt(plaintext, keyring));
    const wrapped = Buffer.from(wrappedA, 'base64url');
    const payload = Buffer.from(payloadA, 'base64url');

    // wrapped DEK = IV(12) || AES-GCM(KEK, DEK(32)) || tag(16)
    expect(wrapped).toHaveLength(12 + 32 + 16);
    // payload = IV(12) || AES-GCM(DEK, plaintext) || tag(16)
    expect(payload).toHaveLength(12 + Buffer.byteLength(plaintext) + 16);
    expect(wrappedA).not.toBe(wrappedB);
    expect(payload.subarray(0, 12)).not.toEqual(Buffer.from(payloadB, 'base64url').subarray(0, 12));
  });

  it('never produces the same ciphertext twice for the same plaintext', () => {
    const envelopes = new Set(Array.from({ length: 50 }, () => encrypt('repeat', keyring)));

    expect(envelopes.size).toBe(50);
  });

  it('throws when a ciphertext byte is flipped', () => {
    const envelope = encrypt('tamper me', keyring);

    expect(() => decrypt(flipByteInSegment(envelope, 3, 14), keyring)).toThrow(DecryptionError);
  });

  it('throws when a byte of the wrapped DEK is flipped', () => {
    const envelope = encrypt('tamper me', keyring);

    expect(() => decrypt(flipByteInSegment(envelope, 2, 20), keyring)).toThrow(DecryptionError);
  });

  it('throws when the authentication tag is flipped', () => {
    const envelope = encrypt('tamper me', keyring);
    const payloadLength = Buffer.from(segments(envelope)[3], 'base64url').length;

    expect(() => decrypt(flipByteInSegment(envelope, 3, payloadLength - 1), keyring)).toThrow(
      DecryptionError,
    );
  });

  it('detects a change to any single character of the envelope', () => {
    const envelope = encrypt('every position', keyring);

    for (let index = 0; index < envelope.length; index += 1) {
      const replacement = envelope[index] === 'A' ? 'B' : 'A';
      const tampered = envelope.slice(0, index) + replacement + envelope.slice(index + 1);

      expect(() => decrypt(tampered, keyring), `position ${String(index)}`).toThrow(
        DecryptionError,
      );
    }
  });

  it('throws when decrypting with the wrong KEK', () => {
    const envelope = encrypt('secret', keyring);

    expect(() => decrypt(envelope, createKeyring(kekB))).toThrow(DecryptionError);
  });

  it('throws when the key id is forged to point at another KEK', () => {
    const envelope = encrypt('secret', keyring);
    const other = createKeyring(kekB);
    const parts = segments(envelope);
    parts[1] = other.currentKeyId;

    expect(() => decrypt(parts.join('.'), other)).toThrow(/authentication failed/);
  });

  it('binds optional associated data (context) to the ciphertext', () => {
    const envelope = encrypt('bound', keyring, { context: 'accounts.email' });

    expect(decrypt(envelope, keyring, { context: 'accounts.email' })).toBe('bound');
    expect(() => decrypt(envelope, keyring, { context: 'accounts.phone' })).toThrow(
      DecryptionError,
    );
    expect(() => decrypt(envelope, keyring)).toThrow(DecryptionError);
  });

  it.each([
    ['empty', ''],
    ['too few segments', 'ov1.abc'],
    ['too many segments', () => `${encrypt('x', keyring)}.extra`],
    ['unknown version', () => encrypt('x', keyring).replace(/^ov1/, 'ov9')],
    ['non-base64url characters', 'ov1.AAAAAAAAAAA.!!!!.????'],
    ['truncated wrapped DEK', () => `ov1.${keyring.currentKeyId}.AAAA.${'A'.repeat(40)}`],
    ['truncated payload', () => encrypt('x', keyring).replace(/\.[^.]+$/, '.AAAA')],
  ])('rejects a malformed envelope (%s)', (_label, input: string | (() => string)) => {
    const envelope = typeof input === 'string' ? input : input();

    expect(() => decrypt(envelope, keyring)).toThrow(DecryptionError);
  });

  it('rejects a non-canonical base64url encoding of the payload', () => {
    // 1 + 28 = 29 payload bytes, so the last base64url character carries two unused bits.
    const odd = encrypt('a', keyring);
    const parts = segments(odd);
    const last = parts[3].at(-1) ?? '';
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const sibling = alphabet[alphabet.indexOf(last) ^ 0x01] ?? '';
    parts[3] = parts[3].slice(0, -1) + sibling;

    expect(Buffer.from(parts[3], 'base64url')).toEqual(Buffer.from(segments(odd)[3], 'base64url'));
    expect(() => decrypt(parts.join('.'), keyring)).toThrow(DecryptionError);
  });

  it('names an unknown key id without revealing key material', () => {
    const envelope = encrypt('secret', createKeyring(kekC));

    const message = thrownMessage(() => decrypt(envelope, keyring));

    expect(message).toMatch(/unknown key id/);
    expect(message).not.toContain(b64(kekA));
    expect(message).not.toContain(b64(kekC));
  });
});

describe('createKeyring', () => {
  it('derives a stable, non-secret 11-character id per KEK', () => {
    const first = createKeyring(kekA);
    const again = createKeyring(Buffer.from(kekA));
    const other = createKeyring(kekB);

    expect(first.currentKeyId).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(again.currentKeyId).toBe(first.currentKeyId);
    expect(other.currentKeyId).not.toBe(first.currentKeyId);
    expect(b64(kekA)).not.toContain(first.currentKeyId);
  });

  it('lists the current and previous key ids, current first, without duplicates', () => {
    const keyring = createKeyring(kekA, [kekB, kekA, kekB]);

    expect(keyring.keyIds).toEqual([
      createKeyring(kekA).currentKeyId,
      createKeyring(kekB).currentKeyId,
    ]);
  });

  it('does not expose key material when serialized', () => {
    const keyring = createKeyring(kekA, [kekB]);
    const serialized = JSON.stringify(keyring);

    expect(serialized).not.toContain(b64(kekA));
    expect(serialized).not.toContain(b64(kekB));
    expect(serialized).not.toContain(kekA.toString('hex'));
  });

  it.each([16, 31, 33, 64])('rejects a %i-byte KEK', (length) => {
    expect(() => createKeyring(randomBytes(length))).toThrow(KeyringError);
    expect(() => createKeyring(kekA, [randomBytes(length)])).toThrow(KeyringError);
  });
});

describe('keyringFromEnv', () => {
  it('reads the current KEK from OPENVERIFY_KEK', () => {
    const keyring = keyringFromEnv({ OPENVERIFY_KEK: b64(kekA) });

    expect(keyring.currentKeyId).toBe(createKeyring(kekA).currentKeyId);
    expect(decrypt(encrypt('env', keyring), createKeyring(kekA))).toBe('env');
  });

  it('reads comma-separated previous KEKs, ignoring blanks and whitespace', () => {
    const keyring = keyringFromEnv({
      OPENVERIFY_KEK: ` ${b64(kekA)} `,
      OPENVERIFY_KEK_PREVIOUS: ` ${b64(kekB)} ,, ${b64(kekC)},`,
    });

    expect(keyring.keyIds).toEqual(createKeyring(kekA, [kekB, kekC]).keyIds);
  });

  it.each([
    ['missing', {}],
    ['blank', { OPENVERIFY_KEK: '   ' }],
  ])('throws when OPENVERIFY_KEK is %s', (_label, env) => {
    expect(() => keyringFromEnv(env)).toThrow(/OPENVERIFY_KEK is not set/);
  });

  it.each([
    ['not base64', 'not base64 at all!'],
    ['base64url instead of base64', Buffer.alloc(32, 0xfb).toString('base64url')],
    ['missing padding', b64(kekA).replace(/=+$/, '')],
  ])('rejects a KEK that is %s', (_label, value) => {
    expect(() => keyringFromEnv({ OPENVERIFY_KEK: value })).toThrow(KeyringError);
  });

  it('rejects a KEK of the wrong length without echoing it', () => {
    const short = randomBytes(16).toString('base64');

    const message = thrownMessage(() => keyringFromEnv({ OPENVERIFY_KEK: short }));

    expect(message).toMatch(/32 bytes/);
    expect(message).not.toContain(short);
  });

  it('names the offending previous KEK by position', () => {
    expect(() =>
      keyringFromEnv({ OPENVERIFY_KEK: b64(kekA), OPENVERIFY_KEK_PREVIOUS: `${b64(kekB)},bad` }),
    ).toThrow(/OPENVERIFY_KEK_PREVIOUS\[1\]/);
  });
});

describe('KEK rotation', () => {
  let oldKeyring: Keyring;
  let rotated: Keyring;
  beforeAll(() => {
    oldKeyring = createKeyring(kekA);
    rotated = keyringFromEnv({ OPENVERIFY_KEK: b64(kekB), OPENVERIFY_KEK_PREVIOUS: b64(kekA) });
  });

  it('decrypts values written under a KEK listed in OPENVERIFY_KEK_PREVIOUS', () => {
    const legacy = encrypt('written before rotation', oldKeyring);

    expect(decrypt(legacy, rotated)).toBe('written before rotation');
  });

  it('encrypts new values under the new current KEK only', () => {
    const fresh = encrypt('written after rotation', rotated);

    expect(segments(fresh)[1]).toBe(createKeyring(kekB).currentKeyId);
    expect(decrypt(fresh, createKeyring(kekB))).toBe('written after rotation');
    expect(() => decrypt(fresh, oldKeyring)).toThrow(DecryptionError);
  });

  it('flags values that are not wrapped by the current KEK', () => {
    expect(needsRewrap(encrypt('old', oldKeyring), rotated)).toBe(true);
    expect(needsRewrap(encrypt('new', rotated), rotated)).toBe(false);
    expect(() => needsRewrap('garbage', rotated)).toThrow(DecryptionError);
  });

  it('re-wraps the DEK under the current KEK without re-encrypting the payload', () => {
    const legacy = encrypt('rewrap me', oldKeyring, { context: 'ctx' });
    const rewrapped = rewrap(legacy, rotated);

    expect(segments(rewrapped)[1]).toBe(rotated.currentKeyId);
    expect(segments(rewrapped)[3]).toBe(segments(legacy)[3]);
    expect(decrypt(rewrapped, createKeyring(kekB), { context: 'ctx' })).toBe('rewrap me');
  });

  it('cannot re-wrap a value whose KEK is no longer in the keyring', () => {
    expect(() => rewrap(encrypt('lost', createKeyring(kekC)), rotated)).toThrow(/unknown key id/);
  });

  it('cannot decrypt old values once the previous KEK is removed', () => {
    const legacy = encrypt('retired', oldKeyring);

    expect(() => decrypt(legacy, keyringFromEnv({ OPENVERIFY_KEK: b64(kekB) }))).toThrow(
      DecryptionError,
    );
  });
});

describe('encrypted column helper', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const probeTable = (keyring: Keyring) =>
    pgTable('encrypted_probe', {
      secret: encrypted('secret', { keyring, context: 'probe.secret' }),
      other: encrypted('other', { keyring, context: 'probe.other' }),
    });
  let probe: ReturnType<typeof probeTable>;
  beforeAll(() => {
    probe = probeTable(createKeyring(kekA));
  });

  it('is a text column', () => {
    expect(probe.secret.getSQLType()).toBe('text');
    expect(probe.secret.name).toBe('secret');
  });

  it('encrypts on the way to the driver and decrypts on the way back', () => {
    const stored = probe.secret.mapToDriverValue('Jane Example');

    expect(stored).toMatch(ENVELOPE);
    expect(stored).not.toContain('Jane Example');
    expect(probe.secret.mapFromDriverValue(stored)).toBe('Jane Example');
  });

  it('binds the column context so values cannot be swapped between columns', () => {
    const stored = probe.secret.mapToDriverValue('swap me');

    expect(() => probe.other.mapFromDriverValue(stored)).toThrow(DecryptionError);
  });

  it('falls back to the process keyring from OPENVERIFY_KEK at use time', () => {
    const lazy = pgTable('lazy_probe', { value: encrypted('value') });

    vi.stubEnv('OPENVERIFY_KEK', '');
    expect(() => lazy.value.mapToDriverValue('x')).toThrow(KeyringError);

    vi.stubEnv('OPENVERIFY_KEK', b64(kekB));
    const stored = String(lazy.value.mapToDriverValue('from env'));
    expect(decrypt(stored, createKeyring(kekB))).toBe('from env');

    vi.stubEnv('OPENVERIFY_KEK', b64(kekC));
    vi.stubEnv('OPENVERIFY_KEK_PREVIOUS', b64(kekB));
    expect(lazy.value.mapFromDriverValue(stored)).toBe('from env');
    expect(segments(String(lazy.value.mapToDriverValue('rotated')))[1]).toBe(
      createKeyring(kekC).currentKeyId,
    );
  });
});

const WRAPPED_DEK = /^ov1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{80}$/;

describe('encryptBytes / decryptBytes (file payloads)', () => {
  let keyring: Keyring;
  beforeAll(() => {
    keyring = createKeyring(kekA);
  });

  it.each([
    ['empty', new Uint8Array(0)],
    ['small', new TextEncoder().encode('synthetic image bytes')],
    ['1 MiB of random bytes', randomBytes(1024 * 1024)],
  ])('round-trips %s', (_label, plaintext) => {
    const sealed = encryptBytes(plaintext, keyring, { context: 'files:file_TEST' });
    const opened = decryptBytes(sealed, keyring, { context: 'files:file_TEST' });

    // Buffer#equals: a deep toEqual over a 1 MiB buffer is too slow under coverage.
    expect(opened).toHaveLength(plaintext.length);
    expect(opened.equals(plaintext)).toBe(true);
  });

  it('returns a wrapped DEK for the database and IV || ciphertext || tag for object storage', () => {
    const plaintext = Buffer.from('JPEG-LIKE-PAYLOAD'.repeat(64));
    const sealed = encryptBytes(plaintext, keyring);

    expect(sealed.wrappedDek).toMatch(WRAPPED_DEK);
    expect(sealed.wrappedDek.split('.')[1]).toBe(keyring.currentKeyId);
    expect(sealed.ciphertext).toHaveLength(12 + plaintext.length + 16);
    expect(Buffer.from(sealed.ciphertext).includes(Buffer.from('JPEG-LIKE-PAYLOAD'))).toBe(false);
  });

  it('uses a fresh DEK and IV for every payload', () => {
    const plaintext = Buffer.from('same bytes');
    const first = encryptBytes(plaintext, keyring);
    const second = encryptBytes(plaintext, keyring);

    expect(first.wrappedDek).not.toBe(second.wrappedDek);
    expect(Buffer.from(first.ciphertext)).not.toEqual(Buffer.from(second.ciphertext));
  });

  it('binds the context (AAD), so an object cannot be moved to another file record', () => {
    const sealed = encryptBytes(Buffer.from('bound'), keyring, { context: 'files:file_A' });

    expect(() => decryptBytes(sealed, keyring, { context: 'files:file_B' })).toThrow(
      DecryptionError,
    );
    expect(() => decryptBytes(sealed, keyring)).toThrow(DecryptionError);
  });

  it('detects a flipped ciphertext or tag byte', () => {
    const sealed = encryptBytes(Buffer.from('tamper me'), keyring);
    for (const index of [0, 14, sealed.ciphertext.length - 1]) {
      const tampered = Buffer.from(sealed.ciphertext);
      tampered[index] = (tampered[index] ?? 0) ^ 0x01;

      expect(() => decryptBytes({ ...sealed, ciphertext: tampered }, keyring)).toThrow(
        DecryptionError,
      );
    }
  });

  it('rejects a ciphertext shorter than IV plus tag', () => {
    const sealed = encryptBytes(Buffer.from('x'), keyring);

    expect(() =>
      decryptBytes({ ...sealed, ciphertext: sealed.ciphertext.subarray(0, 27) }, keyring),
    ).toThrow(/unexpected segment length/);
  });

  it('cannot pair an object with another object’s wrapped DEK', () => {
    const first = encryptBytes(Buffer.from('first'), keyring);
    const second = encryptBytes(Buffer.from('second'), keyring);

    expect(() =>
      decryptBytes({ wrappedDek: second.wrappedDek, ciphertext: first.ciphertext }, keyring),
    ).toThrow(DecryptionError);
  });

  it('is domain-separated from text envelopes that use the same context', () => {
    const [version, keyId, wrapped, payload] = segments(
      encrypt('text', keyring, { context: 'shared' }),
    );
    const asBytes = {
      wrappedDek: `${version}.${keyId}.${wrapped}`,
      ciphertext: Buffer.from(payload, 'base64url'),
    };

    expect(() => decryptBytes(asBytes, keyring, { context: 'shared' })).toThrow(DecryptionError);
  });

  it.each([
    ['a text envelope', () => encrypt('x', keyring)],
    [
      'an unknown version',
      () => encryptBytes(Buffer.from('x'), keyring).wrappedDek.replace(/^ov1/, 'ov2'),
    ],
    ['invalid base64url', () => `ov1.${keyring.currentKeyId}.${'!'.repeat(80)}`],
    ['a truncated wrapped DEK', () => `ov1.${keyring.currentKeyId}.AAAA`],
  ])('rejects a malformed wrapped DEK (%s)', (_label, make) => {
    const sealed = encryptBytes(Buffer.from('x'), keyring);

    expect(() => decryptBytes({ ...sealed, wrappedDek: make() }, keyring)).toThrow(DecryptionError);
  });

  it('throws for an unknown or wrong KEK', () => {
    const sealed = encryptBytes(Buffer.from('secret'), keyring);

    expect(() => decryptBytes(sealed, createKeyring(kekB))).toThrow(/unknown key id/);
  });

  it('re-wraps a file DEK under the current KEK without touching the object', () => {
    const sealed = encryptBytes(Buffer.from('rotate me'), createKeyring(kekA), { context: 'f' });
    const rotated = keyringFromEnv({
      OPENVERIFY_KEK: b64(kekB),
      OPENVERIFY_KEK_PREVIOUS: b64(kekA),
    });

    const wrappedDek = rewrapDek(sealed.wrappedDek, rotated);

    expect(wrappedDek).toMatch(WRAPPED_DEK);
    expect(wrappedDek.split('.')[1]).toBe(createKeyring(kekB).currentKeyId);
    expect(
      Buffer.from(
        decryptBytes({ wrappedDek, ciphertext: sealed.ciphertext }, createKeyring(kekB), {
          context: 'f',
        }),
      ).toString(),
    ).toBe('rotate me');
    expect(() => rewrapDek(sealed.wrappedDek, createKeyring(kekC))).toThrow(/unknown key id/);
  });
});

describe('default keyring override', () => {
  afterEach(() => {
    setDefaultKeyring(undefined);
    vi.unstubAllEnvs();
  });

  it('takes precedence over OPENVERIFY_KEK for encrypted columns', () => {
    vi.stubEnv('OPENVERIFY_KEK', b64(kekA));
    setDefaultKeyring(createKeyring(kekC));
    const column = pgTable('override_probe', { value: encrypted('value') }).value;

    const stored = String(column.mapToDriverValue('override'));

    expect(getDefaultKeyring().currentKeyId).toBe(createKeyring(kekC).currentKeyId);
    expect(decrypt(stored, createKeyring(kekC))).toBe('override');
  });

  it('falls back to the environment once cleared', () => {
    vi.stubEnv('OPENVERIFY_KEK', b64(kekB));
    setDefaultKeyring(createKeyring(kekC));
    setDefaultKeyring(undefined);

    expect(getDefaultKeyring().currentKeyId).toBe(createKeyring(kekB).currentKeyId);
  });
});

describe('encryptedJson column helper', () => {
  const jsonProbe = (keyring: Keyring) =>
    pgTable('json_probe', {
      fields: encryptedJson('fields', {
        keyring,
        context: 'json_probe.fields',
      }).$type<Record<string, unknown>>(),
      other: encryptedJson('other', {
        keyring,
        context: 'json_probe.other',
      }).$type<Record<string, unknown>>(),
    });

  it('is a text column that stores an envelope and reads back the parsed value', () => {
    const probe = jsonProbe(createKeyring(kekA));
    const value = { 'name-first': 'Jane', nested: { list: [1, 'two', null] } };

    const stored = probe.fields.mapToDriverValue(value);

    expect(probe.fields.getSQLType()).toBe('text');
    expect(stored).toMatch(ENVELOPE);
    expect(stored).not.toContain('Jane');
    expect(probe.fields.mapFromDriverValue(stored)).toEqual(value);
  });

  it('binds the column context', () => {
    const probe = jsonProbe(createKeyring(kekA));

    expect(() => probe.other.mapFromDriverValue(probe.fields.mapToDriverValue({ a: 1 }))).toThrow(
      DecryptionError,
    );
  });

  it('uses the default keyring when none is given', () => {
    setDefaultKeyring(createKeyring(kekB));
    try {
      const column = pgTable('lazy_json', { data: encryptedJson('data').$type<number[]>() }).data;
      const stored = String(column.mapToDriverValue([1, 2, 3]));

      expect(JSON.parse(decrypt(stored, createKeyring(kekB)))).toEqual([1, 2, 3]);
    } finally {
      setDefaultKeyring(undefined);
    }
  });
});

/**
 * C55.3: the OTP code key, HKDF-SHA-256 of a KEK with an empty salt and the info
 * `openverify/otp/v1`. The vector was computed with OpenSSL 3.0.13:
 *   openssl kdf -keylen 32 -kdfopt digest:SHA256 -kdfopt hexkey:2021...3f -kdfopt salt: \
 *     -kdfopt info:openverify/otp/v1 HKDF
 */
describe('otpKey (C55.3)', () => {
  const fixedKek = Buffer.from(Array.from({ length: 32 }, (_, index) => 32 + index));

  it('derives K_otp from the KEK the key id names', () => {
    const keyring = createKeyring(fixedKek);

    expect(OTP_KEY_HKDF_INFO).toBe('openverify/otp/v1');
    expect(Buffer.from(otpKey(keyring, keyring.currentKeyId) ?? []).toString('hex')).toBe(
      '7d9d4fbbd4ed9cb7d1ff3c1c1ccf9b48815a5c4f92418626690a37776b9d2380',
    );
  });

  it('derives it for a previous KEK too, and differently for each KEK', () => {
    const rotated = createKeyring(kekB, [fixedKek]);
    const previousId = createKeyring(fixedKek).currentKeyId;

    expect(otpKey(rotated, previousId)).toEqual(otpKey(createKeyring(fixedKek), previousId));
    expect(otpKey(rotated, rotated.currentKeyId)).not.toEqual(otpKey(rotated, previousId));
    expect(otpKey(rotated, rotated.currentKeyId)?.byteLength).toBe(32);
  });

  it('has no key once its KEK left the keyring (the code then reads as expired)', () => {
    const previousId = createKeyring(fixedKek).currentKeyId;

    expect(otpKey(createKeyring(kekB), previousId)).toBeNull();
    expect(otpKey(createKeyring(kekB), 'not-a-key-id')).toBeNull();
  });
});
