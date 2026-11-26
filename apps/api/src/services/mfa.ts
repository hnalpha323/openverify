/**
 * Operator MFA (contract C15): TOTP factors (enrolled pending, active after a confirming code),
 * WebAuthn factors (active once registered), recovery codes (10, Argon2id, single use,
 * regenerated as a set), factor removal, and the self-hoster's reset.
 */
import { newRecoveryCodes, normalizeRecoveryCode } from '@openverify/contracts';
import {
  confirmMfaFactor,
  consumeWebauthnRegistrationChallenge,
  createTotpFactor,
  createWebauthnFactor,
  createWebauthnRegistrationChallenge,
  deleteMfaFactor,
  findWebauthnFactor,
  getTotpSecret,
  listMfaFactors,
  listUnusedRecoveryCodes,
  pgErrorCode,
  recordTotpUse,
  recordWebauthnUse,
  replaceRecoveryCodes,
  revokeUserSessionsForUser,
  useRecoveryCode as markRecoveryCodeUsed,
  type Db,
  type MfaFactor,
  type User,
} from '@openverify/db';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { ConflictError, NotFoundError, UnprocessableContentError } from '../errors.js';
import type { PasswordHasher } from '../operator-auth/password-hasher.js';
import type { WebauthnSettings } from '../operator-auth/settings.js';
import { newTotpSecret, otpauthUri, verifyTotp } from '../operator-auth/totp.js';
import {
  DEFAULT_WEBAUTHN_FACTOR_NAME,
  WEBAUTHN_CHALLENGE_TTL_SECONDS,
  WEBAUTHN_TIMEOUT_MS,
  WebauthnNotConfiguredError,
  challengeHash,
  clientDataChallenge,
} from '../operator-auth/webauthn.js';
import { systemClock, ulidIdGenerator, type Clock, type IdGenerator } from '../ports.js';

/** The issuer authenticator apps show next to the account. */
export const TOTP_ISSUER = 'OpenVerify';
export const DEFAULT_TOTP_FACTOR_NAME = 'Authenticator app';

export interface MfaServiceOptions {
  db: Db;
  /** Argon2id, for recovery codes. */
  hasher: PasswordHasher;
  clock?: Clock;
  ids?: IdGenerator;
  /** The WebAuthn relying party; without it the WebAuthn methods answer 503. */
  webauthn?: WebauthnSettings | undefined;
}

export interface TotpEnrolment {
  /** The pending factor. */
  factor: MfaFactor;
  /** The base32 secret and its key URI, returned once. */
  secret: string;
  otpauthUri: string;
}

export interface TotpConfirmation {
  factor: MfaFactor;
  /** A new set of recovery codes when the user had none, shown once; otherwise `null`. */
  recoveryCodes: string[] | null;
}

/** A newly active factor, with recovery codes when the user had none. */
export type FactorActivation = TotpConfirmation;

export interface WebauthnLoginOptions {
  options: PublicKeyCredentialRequestOptionsJSON;
  /** What to store with the login challenge: the hash of `options.challenge`. */
  challengeHash: string;
}

export interface MfaReset {
  factorsRemoved: number;
  sessionsRevoked: number;
}

export interface MfaService {
  /** The user's factors, active and pending, oldest first. */
  listFactors(organizationId: string, userId: string): Promise<MfaFactor[]>;
  /** The user's active factors (what login asks for). */
  activeFactors(organizationId: string, userId: string): Promise<MfaFactor[]>;
  enrollTotp(organizationId: string, user: User, name?: string): Promise<TotpEnrolment>;
  /**
   * Activates a pending TOTP factor with a valid code, recording its step.
   * @throws {NotFoundError} when the factor is not the user's.
   * @throws {ConflictError} when it is already active.
   * @throws {UnprocessableContentError} for a wrong code.
   */
  confirmTotp(
    organizationId: string,
    userId: string,
    factorId: string,
    code: string,
  ): Promise<TotpConfirmation>;
  /**
   * The active TOTP factor `code` belongs to, after recording its time step so the code
   * cannot be used again; `null` for a wrong or replayed code.
   */
  verifyTotp(organizationId: string, userId: string, code: string): Promise<MfaFactor | null>;
  /** Uses one recovery code once; `false` for a wrong or spent code. */
  useRecoveryCode(organizationId: string, userId: string, input: string): Promise<boolean>;
  /**
   * A new set of recovery codes, replacing the previous ones; returned once.
   * @throws {ConflictError} when the user has no active factor.
   */
  regenerateRecoveryCodes(organizationId: string, userId: string): Promise<string[]>;
  /**
   * Removes one of the user's factors; with the last active one, the recovery codes go too.
   * @throws {NotFoundError} when the factor is not the user's.
   */
  deleteFactor(organizationId: string, userId: string, factorId: string): Promise<void>;
  /** Removes every factor and recovery code and revokes every session (`user:reset-mfa`). */
  resetUserMfa(organizationId: string, userId: string): Promise<MfaReset>;
  /**
   * Stores a new set of recovery codes when the user has none left; returns it, or `null`.
   * Called when a first factor becomes active.
   */
  issueRecoveryCodesIfNone(organizationId: string, userId: string): Promise<string[] | null>;
  /**
   * Options for `navigator.credentials.create()`, excluding the user's registered
   * credentials; the challenge is stored hashed for 5 minutes.
   * @throws {WebauthnNotConfiguredError} without a relying party.
   */
  webauthnRegistrationOptions(
    organizationId: string,
    user: User,
  ): Promise<PublicKeyCredentialCreationOptionsJSON>;
  /**
   * Verifies a registration against the user's stored challenge (used once) and stores the
   * active factor.
   * @throws {UnprocessableContentError} for an unknown or expired challenge or a credential
   *   that does not verify.
   * @throws {ConflictError} when the credential is already registered.
   */
  verifyWebauthnRegistration(
    organizationId: string,
    userId: string,
    credential: RegistrationResponseJSON,
    name?: string,
  ): Promise<FactorActivation>;
  /**
   * Options for `navigator.credentials.get()` with the user's WebAuthn credentials.
   * @throws {ConflictError} when the user has no WebAuthn factor.
   */
  webauthnAuthenticationOptions(organizationId: string, userId: string): Promise<WebauthnLoginOptions>;
  /**
   * The factor a signed assertion for `expectedChallenge` proves, after recording its
   * counter; `null` for an unknown credential, a bad signature, origin or challenge, or a
   * counter that did not move forward (a possibly cloned authenticator).
   */
  verifyWebauthnAuthentication(
    organizationId: string,
    userId: string,
    credential: AuthenticationResponseJSON,
    expectedChallenge: string,
  ): Promise<MfaFactor | null>;
}

const invalidRegistration = (detail: string) =>
  new UnprocessableContentError(detail, [
    { location: 'body', pointer: '/credential', detail: 'was not accepted' },
  ]);

export function createMfaService(options: MfaServiceOptions): MfaService {
  const { db, hasher } = options;
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? ulidIdGenerator;

  const activeFactors = (organizationId: string, userId: string) =>
    listMfaFactors(db, organizationId, userId, { confirmedOnly: true });

  async function storeNewRecoveryCodes(organizationId: string, userId: string) {
    const codes = newRecoveryCodes();
    const hashes = await Promise.all(codes.map((code) => hasher.hash(code)));
    await replaceRecoveryCodes(db, organizationId, userId, hashes);
    return codes;
  }

  async function issueRecoveryCodesIfNone(organizationId: string, userId: string) {
    const unused = await listUnusedRecoveryCodes(db, organizationId, userId);
    return unused.length > 0 ? null : storeNewRecoveryCodes(organizationId, userId);
  }

  function relyingParty(): WebauthnSettings {
    if (options.webauthn === undefined) {
      throw new WebauthnNotConfiguredError();
    }
    return options.webauthn;
  }

  async function webauthnFactors(organizationId: string, userId: string, confirmedOnly: boolean) {
    const factors = await listMfaFactors(db, organizationId, userId, { confirmedOnly });
    return factors.flatMap((factor) =>
      factor.type === 'webauthn' && factor.webauthnCredentialId !== null
        ? [
            {
              id: factor.webauthnCredentialId,
              ...(factor.webauthnTransports === null
                ? {}
                : { transports: factor.webauthnTransports }),
            },
          ]
        : [],
    );
  }

  async function ownFactor(organizationId: string, userId: string, factorId: string) {
    const factor = (await listMfaFactors(db, organizationId, userId)).find(
      ({ id }) => id === factorId,
    );
    if (factor === undefined) {
      throw new NotFoundError('No MFA factor with this id exists.');
    }
    return factor;
  }

  return {
    listFactors: (organizationId, userId) => listMfaFactors(db, organizationId, userId),
    activeFactors,

    async enrollTotp(organizationId, user, name = DEFAULT_TOTP_FACTOR_NAME) {
      const secret = newTotpSecret();
      const factor = await createTotpFactor(db, organizationId, {
        id: ids.newId('mfa'),
        userId: user.id,
        name,
        secret,
      });
      return {
        factor,
        secret,
        otpauthUri: otpauthUri({ secret, accountName: user.email, issuer: TOTP_ISSUER }),
      };
    },

    async confirmTotp(organizationId, userId, factorId, code) {
      const factor = await ownFactor(organizationId, userId, factorId);
      if (factor.type !== 'totp') {
        throw new NotFoundError('No TOTP factor with this id exists.');
      }
      if (factor.confirmedAt !== null) {
        throw new ConflictError('This factor is already active.');
      }
      const stored = await getTotpSecret(db, organizationId, factorId);
      const now = clock.now();
      const step = stored === null ? null : verifyTotp(stored.secret, code, now);
      if (step === null) {
        throw new UnprocessableContentError('The code is not valid for this factor.', [
          { location: 'body', pointer: '/totp-code', detail: 'is not the current code' },
        ]);
      }
      const confirmed = await confirmMfaFactor(db, organizationId, factorId, { at: now, step });
      if (confirmed === null) {
        throw new ConflictError('This factor is already active.');
      }
      return {
        factor: confirmed,
        recoveryCodes: await issueRecoveryCodesIfNone(organizationId, userId),
      };
    },

    async verifyTotp(organizationId, userId, code) {
      const now = clock.now();
      for (const factor of await activeFactors(organizationId, userId)) {
        if (factor.type !== 'totp') continue;
        const stored = await getTotpSecret(db, organizationId, factor.id);
        const step =
          stored === null
            ? null
            : verifyTotp(stored.secret, code, now, { lastUsedStep: stored.lastUsedStep });
        // The step is recorded atomically, so two requests cannot both use it.
        if (step !== null && (await recordTotpUse(db, organizationId, factor.id, step, now))) {
          return factor;
        }
      }
      return null;
    },

    async useRecoveryCode(organizationId, userId, input) {
      const code = normalizeRecoveryCode(input);
      if (code === null) {
        return false;
      }
      for (const candidate of await listUnusedRecoveryCodes(db, organizationId, userId)) {
        if (await hasher.verify(candidate.codeHash, code)) {
          return markRecoveryCodeUsed(db, organizationId, userId, candidate.id, clock.now());
        }
      }
      return false;
    },

    async regenerateRecoveryCodes(organizationId, userId) {
      if ((await activeFactors(organizationId, userId)).length === 0) {
        throw new ConflictError('Recovery codes need an active MFA factor first.');
      }
      return storeNewRecoveryCodes(organizationId, userId);
    },

    async deleteFactor(organizationId, userId, factorId) {
      await ownFactor(organizationId, userId, factorId);
      await deleteMfaFactor(db, organizationId, userId, factorId);
      if ((await activeFactors(organizationId, userId)).length === 0) {
        await replaceRecoveryCodes(db, organizationId, userId, []);
      }
    },

    async resetUserMfa(organizationId, userId) {
      return db.transaction(async (tx) => {
        const factors = await listMfaFactors(tx, organizationId, userId);
        for (const factor of factors) {
          await deleteMfaFactor(tx, organizationId, userId, factor.id);
        }
        await replaceRecoveryCodes(tx, organizationId, userId, []);
        const sessionsRevoked = await revokeUserSessionsForUser(
          tx,
          organizationId,
          userId,
          clock.now(),
        );
        return { factorsRemoved: factors.length, sessionsRevoked };
      });
    },

    issueRecoveryCodesIfNone,

    async webauthnRegistrationOptions(organizationId, user) {
      const rp = relyingParty();
      const registration = await generateRegistrationOptions({
        rpName: rp.rpName,
        rpID: rp.rpId,
        userName: user.email,
        userID: new TextEncoder().encode(user.id),
        userDisplayName: user.name ?? user.email,
        timeout: WEBAUTHN_TIMEOUT_MS,
        attestationType: 'none',
        excludeCredentials: await webauthnFactors(organizationId, user.id, false),
        authenticatorSelection: { residentKey: 'discouraged', userVerification: 'preferred' },
      });
      await createWebauthnRegistrationChallenge(db, organizationId, {
        userId: user.id,
        challengeHash: challengeHash(registration.challenge),
        expiresAt: new Date(clock.now().getTime() + WEBAUTHN_CHALLENGE_TTL_SECONDS * 1000),
      });
      return registration;
    },

    async verifyWebauthnRegistration(organizationId, userId, credential, name) {
      const rp = relyingParty();
      const now = clock.now();
      const challenge = clientDataChallenge(credential.response.clientDataJSON);
      // The challenge is spent before verifying, so a failed attempt cannot be retried.
      const issued =
        challenge !== null &&
        (await consumeWebauthnRegistrationChallenge(
          db,
          organizationId,
          userId,
          challengeHash(challenge),
          now,
        ));
      if (!issued) {
        throw invalidRegistration('The registration challenge is not valid or has expired.');
      }
      let verification: VerifiedRegistrationResponse;
      try {
        verification = await verifyRegistrationResponse({
          response: credential,
          expectedChallenge: challenge,
          expectedOrigin: rp.origin,
          expectedRPID: rp.rpId,
          requireUserVerification: false,
        });
      } catch {
        throw invalidRegistration('The credential could not be verified.');
      }
      if (!verification.verified) {
        throw invalidRegistration('The credential could not be verified.');
      }
      const registered = verification.registrationInfo.credential;
      let factor: MfaFactor;
      try {
        factor = await createWebauthnFactor(db, organizationId, {
          id: ids.newId('mfa'),
          userId,
          name: name ?? DEFAULT_WEBAUTHN_FACTOR_NAME,
          credentialId: registered.id,
          publicKey: Buffer.from(registered.publicKey).toString('base64url'),
          counter: registered.counter,
          transports: registered.transports ?? credential.response.transports ?? [],
          confirmedAt: now,
        });
      } catch (error) {
        if (pgErrorCode(error) === '23505') {
          throw new ConflictError('This credential is already registered.');
        }
        throw error;
      }
      return { factor, recoveryCodes: await issueRecoveryCodesIfNone(organizationId, userId) };
    },

    async webauthnAuthenticationOptions(organizationId, userId) {
      const rp = relyingParty();
      const allowCredentials = await webauthnFactors(organizationId, userId, true);
      if (allowCredentials.length === 0) {
        throw new ConflictError('This user has no WebAuthn factor.');
      }
      const authentication = await generateAuthenticationOptions({
        rpID: rp.rpId,
        allowCredentials,
        userVerification: 'preferred',
        timeout: WEBAUTHN_TIMEOUT_MS,
      });
      return { options: authentication, challengeHash: challengeHash(authentication.challenge) };
    },

    async verifyWebauthnAuthentication(organizationId, userId, credential, expectedChallenge) {
      const rp = relyingParty();
      const factor = await findWebauthnFactor(db, organizationId, userId, credential.id);
      if (factor?.webauthnCredentialId == null || factor.webauthnPublicKey === null) {
        return null;
      }
      let newCounter: number;
      try {
        const result = await verifyAuthenticationResponse({
          response: credential,
          expectedChallenge,
          expectedOrigin: rp.origin,
          expectedRPID: rp.rpId,
          credential: {
            id: factor.webauthnCredentialId,
            publicKey: new Uint8Array(Buffer.from(factor.webauthnPublicKey, 'base64url')),
            counter: factor.webauthnCounter ?? 0,
            ...(factor.webauthnTransports === null
              ? {}
              : { transports: factor.webauthnTransports }),
          },
          requireUserVerification: false,
        });
        if (!result.verified) {
          return null;
        }
        newCounter = result.authenticationInfo.newCounter;
      } catch {
        return null;
      }
      const recorded = await recordWebauthnUse(
        db,
        organizationId,
        factor.id,
        newCounter,
        clock.now(),
      );
      return recorded ? factor : null;
    },
  };
}
