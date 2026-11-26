import { RECOVERY_CODE_COUNT, newId } from '@openverify/contracts';
import { createUser, listMfaFactors } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError, UnprocessableContentError } from '../errors.js';
import type { PasswordHasher } from '../operator-auth/password-hasher.js';
import type { WebauthnSettings } from '../operator-auth/settings.js';
import { createSoftwareAuthenticator } from '../operator-auth/testing/software-authenticator.js';
import { WebauthnNotConfiguredError, challengeHash } from '../operator-auth/webauthn.js';
import { fixedClock } from '../test-support/fakes.js';
import { createMfaService } from './mfa.js';

// Synthetic operators and keys only.
const WEBAUTHN: WebauthnSettings = {
  rpId: 'localhost',
  rpName: 'OpenVerify',
  origin: 'http://localhost:3001',
};

let database: TestDatabase;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const hasher: PasswordHasher = {
  hash: (value) => Promise.resolve(`$argon2id$fake$${Buffer.from(value).toString('base64url')}`),
  verify: (stored, value) =>
    Promise.resolve(stored === `$argon2id$fake$${Buffer.from(value).toString('base64url')}`),
};

/** `null` sets up a deployment without a WebAuthn relying party. */
async function setup(webauthn: WebauthnSettings | null = WEBAUTHN) {
  const clock = fixedClock();
  const { organization } = await createTestTenant(database.db);
  counter += 1;
  const user = await createUser(database.db, {
    id: newId('usr'),
    organizationId: organization.id,
    email: `webauthn-${String(counter)}@example.test`,
    passwordHash: '$argon2id$fake$unused',
    name: 'Synthetic Operator',
  });
  const mfa = createMfaService({ db: database.db, hasher, clock, webauthn: webauthn ?? undefined });
  const authenticator = createSoftwareAuthenticator({ origin: WEBAUTHN.origin });
  return { clock, organization, user, mfa, authenticator };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function register({ mfa, organization, user, authenticator }: Setup, name?: string) {
  const options = await mfa.webauthnRegistrationOptions(organization.id, user);
  return mfa.verifyWebauthnRegistration(
    organization.id,
    user.id,
    authenticator.register(options),
    name,
  );
}

describe('webauthnRegistrationOptions', () => {
  it('offers ES256 for this RP and user, preferring user verification, and stores the challenge hashed', async () => {
    const { mfa, organization, user } = await setup();

    const options = await mfa.webauthnRegistrationOptions(organization.id, user);

    expect(options.rp).toEqual({ name: 'OpenVerify', id: 'localhost' });
    expect(options.user.name).toBe(user.email);
    expect(options.user.displayName).toBe('Synthetic Operator');
    expect(options.pubKeyCredParams.map(({ alg }) => alg)).toContain(-7);
    expect(options.authenticatorSelection?.userVerification).toBe('preferred');
    expect(options.attestation).toBe('none');
    const stored = await database.client.query<{ challenge_hash: string }>(
      'select challenge_hash from webauthn_registration_challenges where user_id = $1',
      [user.id],
    );
    expect(stored.rows.map((row) => row.challenge_hash)).toEqual([challengeHash(options.challenge)]);
  });

  it('excludes the credentials the user already registered', async () => {
    const context = await setup();
    await register(context);

    const options = await context.mfa.webauthnRegistrationOptions(context.organization.id, context.user);

    expect(options.excludeCredentials).toEqual([
      { id: context.authenticator.credentialId, type: 'public-key', transports: ['internal'] },
    ]);
  });

  it('answers 503 when no relying party is configured', async () => {
    const { mfa, organization, user } = await setup(null);

    await expect(mfa.webauthnRegistrationOptions(organization.id, user)).rejects.toBeInstanceOf(
      WebauthnNotConfiguredError,
    );
  });
});

describe('verifyWebauthnRegistration', () => {
  it('stores an active factor with the credential, and the first factor brings recovery codes', async () => {
    const context = await setup();

    const { factor, recoveryCodes } = await register(context, 'Laptop');

    expect(factor).toMatchObject({
      type: 'webauthn',
      name: 'Laptop',
      webauthnCredentialId: context.authenticator.credentialId,
      webauthnCounter: 0,
      webauthnTransports: ['internal'],
      confirmedAt: context.clock.now(),
    });
    expect(recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
  });

  it('names the factor "Security key" by default', async () => {
    const context = await setup();

    await expect(register(context)).resolves.toMatchObject({ factor: { name: 'Security key' } });
  });

  it('refuses a response for another origin, an unknown challenge, or a spent one (422)', async () => {
    const context = await setup();
    const { mfa, organization, user, authenticator } = context;
    const options = await mfa.webauthnRegistrationOptions(organization.id, user);

    await expect(
      mfa.verifyWebauthnRegistration(
        organization.id,
        user.id,
        authenticator.register(options, { origin: 'https://evil.example' }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableContentError);
    // The challenge was spent by the failed attempt.
    await expect(
      mfa.verifyWebauthnRegistration(organization.id, user.id, authenticator.register(options)),
    ).rejects.toBeInstanceOf(UnprocessableContentError);
    await expect(
      mfa.verifyWebauthnRegistration(
        organization.id,
        user.id,
        authenticator.register({ ...options, challenge: 'bm90LWlzc3VlZA' }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableContentError);
    expect(await listMfaFactors(database.db, organization.id, user.id)).toEqual([]);
  });

  it('refuses a challenge after 5 minutes', async () => {
    const context = await setup();
    const { mfa, organization, user, authenticator, clock } = context;
    const options = await mfa.webauthnRegistrationOptions(organization.id, user);
    clock.advance(300_000);

    await expect(
      mfa.verifyWebauthnRegistration(organization.id, user.id, authenticator.register(options)),
    ).rejects.toBeInstanceOf(UnprocessableContentError);
  });

  it('answers 409 when the credential is already registered', async () => {
    const context = await setup();
    await register(context);

    await expect(register(context)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('WebAuthn authentication', () => {
  it('offers the user’s credentials and verifies a signed assertion, recording the counter', async () => {
    const context = await setup();
    const { factor } = await register(context);
    const { mfa, organization, user, authenticator } = context;

    const { options, challengeHash: hash } = await mfa.webauthnAuthenticationOptions(
      organization.id,
      user.id,
    );
    expect(options.rpId).toBe('localhost');
    expect(options.userVerification).toBe('preferred');
    expect(options.allowCredentials).toEqual([
      { id: authenticator.credentialId, type: 'public-key', transports: ['internal'] },
    ]);
    expect(hash).toBe(challengeHash(options.challenge));

    const verified = await mfa.verifyWebauthnAuthentication(
      organization.id,
      user.id,
      authenticator.authenticate(options),
      options.challenge,
    );

    expect(verified?.id).toBe(factor.id);
    const [stored] = await listMfaFactors(database.db, organization.id, user.id);
    expect(stored?.webauthnCounter).toBe(1);
  });

  it('answers null for another challenge, another origin, an unknown credential or a counter that did not move', async () => {
    const context = await setup();
    await register(context);
    const { mfa, organization, user, authenticator } = context;
    const { options } = await mfa.webauthnAuthenticationOptions(organization.id, user.id);
    const verify = (response: ReturnType<typeof authenticator.authenticate>) =>
      mfa.verifyWebauthnAuthentication(organization.id, user.id, response, options.challenge);

    await expect(
      verify(authenticator.authenticate(options, { challenge: 'b3RoZXItY2hhbGxlbmdl' })),
    ).resolves.toBeNull();
    await expect(
      verify(authenticator.authenticate(options, { origin: 'https://evil.example' })),
    ).resolves.toBeNull();
    const stranger = createSoftwareAuthenticator({ origin: WEBAUTHN.origin });
    await expect(verify(stranger.authenticate(options))).resolves.toBeNull();

    const good = authenticator.authenticate(options);
    await expect(verify(good)).resolves.not.toBeNull();
    // A replayed assertion carries the same counter: a possibly cloned authenticator.
    await expect(verify(good)).resolves.toBeNull();
  });

  it('answers 409 for options when the user has no WebAuthn factor', async () => {
    const { mfa, organization, user } = await setup();

    await expect(mfa.webauthnAuthenticationOptions(organization.id, user.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
