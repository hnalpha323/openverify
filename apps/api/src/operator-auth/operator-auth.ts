import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  MFA_TOKEN_TTL_SECONDS,
  mfaTokenSchema,
  newMfaToken,
  newUserSessionToken,
  type MfaFactorKind,
  type MfaSignInProblemCode,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import {
  consumeMfaChallenge,
  createMfaChallenge,
  createUserSession,
  findActiveMfaChallenge,
  findStepUpChallenge,
  getUser,
  hashSessionToken,
  listEnvironments,
  listUserRoleAssignments,
  listUsersByEmail,
  markUserSessionMfaVerified,
  reserveMfaChallengeAttempt,
  revokeExhaustedMfaChallenge,
  revokeUserSession,
  setMfaChallengeWebauthnChallenge,
  type Db,
  type Environment,
  type EnvironmentKind,
  type MfaChallenge,
  type User,
  type UserSession,
} from '@openverify/db';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import type { FastifyRequest } from 'fastify';
import { AppError, UnauthorizedError } from '../errors.js';
import { systemClock, ulidIdGenerator, type Clock, type IdGenerator } from '../ports.js';
import { environmentsEntered } from '../services/access/permissions.js';
import { noEnvironmentRole } from '../services/access/problems.js';
import { createMfaService, type MfaService } from '../services/mfa.js';
import { createClientAddressResolver } from './client-address.js';
import { assertPasswordSignInAllowed, narrowLoginCandidates } from './oidc/password-gate.js';
import { createLoginRateLimiter, type LoginRateLimiter } from './login-rate-limiter.js';
import { createArgon2idHasher, type PasswordHasher } from './password-hasher.js';
import { DEFAULT_SESSION_RESOLUTION, findUserSessionContext } from './session-context.js';
import type { SessionTimeouts } from './session-policy.js';
import type { WebauthnSettings } from './settings.js';
import { challengeHash, clientDataChallenge } from './webauthn.js';

/**
 * The one answer to every failed login (C4): unknown email, wrong password, or an account
 * that cannot work in any environment. It never says which.
 */
export class InvalidCredentialsError extends UnauthorizedError {
  override name = 'InvalidCredentialsError';

  constructor() {
    super('The email or password is incorrect.');
  }
}

/** 429 with `Retry-After`, sent before any password is verified. */
export class TooManyLoginAttemptsError extends AppError {
  override name = 'TooManyLoginAttemptsError';
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super({
      status: 429,
      detail: 'Too many sign-in attempts. Try again later.',
      headers: { 'retry-after': String(retryAfterSeconds) },
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const MFA_TOKEN_INVALID: MfaSignInProblemCode = 'mfa_token_invalid';
const MFA_CODE_INVALID: MfaSignInProblemCode = 'mfa_code_invalid';
const MFA_ATTEMPTS_EXHAUSTED: MfaSignInProblemCode = 'mfa_attempts_exhausted';

/**
 * 401 `mfa_token_invalid` (C25.1) for an `mfa-token` that is malformed, unknown, expired, already
 * used, revoked after five wrong codes, or whose user can no longer sign in (C15). The user signs
 * in again.
 */
export class InvalidMfaTokenError extends UnauthorizedError {
  override name = 'InvalidMfaTokenError';

  constructor() {
    super(
      'The MFA token is not valid or has expired. Sign in again.',
      undefined,
      MFA_TOKEN_INVALID,
    );
  }
}

/**
 * 401 `mfa_code_invalid` (C25.1) for a wrong, replayed or spent second factor; it counts against
 * the `mfa-token`, which can still be used.
 */
export class InvalidMfaCodeError extends UnauthorizedError {
  override name = 'InvalidMfaCodeError';

  constructor(
    detail = 'The second factor is not valid.',
    code: MfaSignInProblemCode = MFA_CODE_INVALID,
  ) {
    super(detail, undefined, code);
  }
}

/**
 * 401 `mfa_attempts_exhausted` (C25.1): the wrong second factor that used the challenge's last
 * attempt (the fifth, C15), which revoked the `mfa-token`. The user signs in again.
 */
export class MfaAttemptsExhaustedError extends InvalidMfaCodeError {
  override name = 'MfaAttemptsExhaustedError';

  constructor() {
    super(
      'The second factor is not valid, and too many attempts were made. Sign in again.',
      MFA_ATTEMPTS_EXHAUSTED,
    );
  }
}

export interface OperatorAuthOptions {
  db: Db;
  /** Defaults to Argon2id with the OWASP parameters. Also hashes recovery codes. */
  hasher?: PasswordHasher;
  /** Defaults to the in-memory per-address and per-email limiter. */
  rateLimiter?: LoginRateLimiter;
  /** C245.1 (Workflow 11B): the console's session limits; C245.1's defaults when left out. */
  sessionTimeouts?: SessionTimeouts;
  clock?: Clock;
  ids?: IdGenerator;
  /**
   * The environment a new session works in: this kind of environment, or the organization's
   * other one when it has only that. Defaults to `sandbox`; sessions switch with
   * `PUT /sessions/current/environment` (C15). C167.2 (Workflow 9B): the first of them where the
   * user holds a role it may use (production with `environments:production` there).
   */
  environmentKind?: EnvironmentKind;
  /**
   * `OPENVERIFY_DASHBOARD_BFF_TOKEN`: with it, {@link OperatorAuth.clientAddress} believes the
   * dashboard BFF's `x-openverify-client-ip` header (C15).
   */
  bffToken?: string | undefined;
  /** The WebAuthn relying party (C15); without it WebAuthn answers 503. */
  webauthn?: WebauthnSettings | undefined;
  /** The MFA factors of users. Defaults to one over the same database, hasher and clock. */
  mfa?: MfaService;
}

export interface LoginInput {
  email: string;
  password: string;
  /** The client address, for the per-address limit. */
  ip: string;
  /**
   * C248.8 (Workflow 11B, sso-oidc's borrowed edit): an organisation's sign-in name, which narrows
   * the accounts checked to that organisation's.
   */
  organization?: string | undefined;
}

/** A new session. */
export interface SessionResult {
  /** The `ovu_...` bearer token. Only its hash is stored; return it to the caller once. */
  token: string;
  expiresAt: Date;
  session: UserSession;
  user: User;
}

/** The Phase 1 name of {@link SessionResult}. */
export type LoginResult = SessionResult;

/** A correct password of a user with MFA: present one active factor with `mfaToken`. */
export interface MfaChallengeResult {
  /** The `ovm_...` token: 5 minutes, single use, revoked after five wrong codes. */
  mfaToken: string;
  expiresAt: Date;
  factors: { id: string; type: MfaFactorKind }[];
  user: User;
}

export type LoginOutcome =
  ({ kind: 'session' } & SessionResult) | ({ kind: 'mfa' } & MfaChallengeResult);

export type MfaMethod = 'totp' | 'recovery-code' | 'webauthn';

export interface MfaSessionResult extends SessionResult {
  /** The second factor that passed. */
  method: MfaMethod;
}

export interface CompleteMfaInput {
  mfaToken: string;
  totpCode?: string | undefined;
  recoveryCode?: string | undefined;
}

export interface CompleteWebauthnMfaInput {
  mfaToken: string;
  /** The `navigator.credentials.get()` result for the options of this `mfa-token`. */
  credential: AuthenticationResponseJSON;
}

/** C168.1 (Workflow 9B; contracts B26): a second factor verified again on a live session. */
export interface StepUpInput {
  sessionId: string;
  user: User;
  /** The client address, for the sign-in limit the guesses count against. */
  ip: string;
  totpCode?: string | undefined;
  /** A `navigator.credentials.get()` result for options of {@link OperatorAuth.stepUpWebauthnOptions}. */
  credential?: AuthenticationResponseJSON | undefined;
}

export interface StepUpResult {
  method: Exclude<MfaMethod, 'recovery-code'>;
  /** When the factor was verified: the session's `mfa_verified_at`. */
  verifiedAt: Date;
}

/** The operator behind a live session; dashboard queries are scoped by `environmentId`. */
export interface AuthenticatedOperator {
  sessionId: string;
  organizationId: string;
  environmentId: string;
  environmentKind: EnvironmentKind;
  user: User;
  /** The union of the user's role permissions (C15). */
  permissions: ReadonlySet<Permission>;
  /** The session passed MFA, or the organization does not require it (C15). */
  mfaSatisfied: boolean;
}

/** A challenge that was found and whose user may still sign in. */
interface ActiveMfaChallenge {
  challenge: MfaChallenge;
  user: User;
}

export interface OperatorAuth {
  /**
   * Verifies the credentials. A user without an active MFA factor gets a 12 hour session;
   * a user with one gets an MFA challenge instead (C15), and no session yet.
   * @throws {TooManyLoginAttemptsError} when the address or the email is over its limit.
   * @throws {InvalidCredentialsError} for any other failure.
   */
  login(input: LoginInput): Promise<LoginOutcome>;
  /**
   * Completes an MFA login with a TOTP code or a recovery code: an MFA-satisfied session.
   * @throws {InvalidMfaTokenError} for an unusable `mfa-token`.
   * @throws {InvalidMfaCodeError} for a wrong code, which counts towards revoking the token;
   *   {@link MfaAttemptsExhaustedError} for the one that revoked it.
   */
  completeMfa(input: CompleteMfaInput): Promise<MfaSessionResult>;
  /**
   * WebAuthn assertion options for an MFA login; their challenge is bound to the `mfa-token`.
   * @throws {InvalidMfaTokenError} for an unusable `mfa-token`.
   * @throws {ConflictError} when the user has no WebAuthn factor.
   */
  webauthnLoginOptions(mfaToken: string): Promise<PublicKeyCredentialRequestOptionsJSON>;
  /**
   * Completes an MFA login with a WebAuthn assertion for the options of this `mfa-token`.
   * @throws {InvalidMfaTokenError} for an unusable `mfa-token`.
   * @throws {InvalidMfaCodeError} for an assertion that does not verify (counted);
   *   {@link MfaAttemptsExhaustedError} for the one that revoked the token.
   */
  completeWebauthnMfa(input: CompleteWebauthnMfaInput): Promise<MfaSessionResult>;
  /**
   * C168.1: verifies a TOTP code or a passkey assertion (never a recovery code) on the live session
   * `sessionId`, setting its `mfa_verified_at`. Each guess counts against the user's sign-in limit.
   * @throws {TooManyLoginAttemptsError} over the limit.
   * @throws {InvalidMfaCodeError} 401 `mfa_code_invalid` for a wrong, replayed or missing factor.
   */
  stepUp(input: StepUpInput): Promise<StepUpResult>;
  /**
   * C168.1: assertion options for a passkey step-up, their challenge stored hashed for 5 minutes.
   * @throws {ConflictError} when the user has no WebAuthn factor.
   */
  stepUpWebauthnOptions(user: User): Promise<PublicKeyCredentialRequestOptionsJSON>;
  /**
   * The operator for a live session token, or `null` (malformed, unknown, expired, revoked). C245.2
   * (Workflow 11B): `activity: false` (a route's background poll) checks the limits without sliding.
   */
  authenticate(
    token: string,
    options?: { readonly activity: boolean },
  ): Promise<AuthenticatedOperator | null>;
  /** Revokes a session. False when it was already revoked or does not exist. */
  logout(sessionId: string): Promise<boolean>;
  /**
   * C248.4-C248.6 (Workflow 11B, sso-oidc's borrowed edit): the session of a user the SSO callback
   * signed in, in the first environment it may enter (C167.2) and under C245's limits;
   * `mfaPassed` when the ID token stood in for the second factor (it starts the step-up window).
   */
  openSsoSession(
    user: User,
    mfaPassed: boolean,
    providerAmr?: readonly string[] | null,
  ): Promise<SessionResult>;
  /** C248.6: the challenge of the user's local factor after an SSO sign-in; `null` without one. */
  startSsoMfaChallenge(user: User): Promise<MfaChallengeResult | null>;
  /** The operator's address: the BFF's `x-openverify-client-ip` when trusted, else `request.ip`. */
  clientAddress(request: FastifyRequest): string;
  /** Hashes and verifies passwords (Argon2id), e.g. when an invitation is accepted. */
  readonly hasher: PasswordHasher;
  /** The users' MFA factors, over the same database, hasher and clock. */
  readonly mfa: MfaService;
  /** The clock sessions are stamped with (C168.4: created, last seen, revoked). */
  readonly clock: Clock;
}

const OTHER_KIND: Record<EnvironmentKind, EnvironmentKind> = {
  sandbox: 'production',
  production: 'sandbox',
};

/** Operator login (C4, with C15 MFA), session lookup and logout for the dashboard API. */
export function createOperatorAuth(options: OperatorAuthOptions): OperatorAuth {
  const { db } = options;
  const hasher = options.hasher ?? createArgon2idHasher();
  const rateLimiter = options.rateLimiter ?? createLoginRateLimiter();
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? ulidIdGenerator;
  const environmentKind = options.environmentKind ?? 'sandbox';
  const mfa =
    options.mfa ?? createMfaService({ db, hasher, clock, ids, webauthn: options.webauthn });
  const clientAddress = createClientAddressResolver(options.bffToken);

  // A hash of a random password with the same parameters as real ones. An unknown email is
  // verified against it, so it costs one Argon2id verification like a known email does.
  const dummyHash = hasher.hash(randomBytes(32).toString('base64url'));
  // Marks the promise handled; a failure still surfaces where it is awaited.
  dummyHash.catch(() => undefined);

  async function verifyCredentials(
    email: string,
    password: string,
    organization: string | undefined,
  ): Promise<User | null> {
    // Emails are unique per organization only; the C4 body may name one (C248.8, sso-oidc).
    const candidates = await narrowLoginCandidates(
      db,
      await listUsersByEmail(db, email),
      organization,
    );
    if (candidates.length === 0) {
      await hasher.verify(await dummyHash, password);
      return null;
    }
    for (const candidate of candidates) {
      if (await hasher.verify(candidate.passwordHash, password)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * The environments of the user's organization in the order a session opens them: the configured
   * kind first, then the other (C15), oldest first within a kind.
   */
  async function candidateEnvironments(organizationId: string): Promise<Environment[]> {
    const all = await listEnvironments(db, organizationId);
    return [
      ...all.filter((environment) => environment.kind === environmentKind),
      ...all.filter((environment) => environment.kind === OTHER_KIND[environmentKind]),
    ];
  }

  /**
   * C167.2 (Workflow 9B; review F29): the first environment the user may enter, in the order of
   * {@link candidateEnvironments}: one where it holds a role, and production only with
   * `environments:production` held there.
   * @throws {AccessProblemError} 403 `no_environment_role` when there is none.
   */
  async function enterableEnvironment(
    user: User,
    environments: readonly Environment[],
  ): Promise<Environment> {
    const assignments = await listUserRoleAssignments(db, user.organizationId, user.id);
    const [first] = environmentsEntered(assignments, environments);
    if (first === undefined) {
      throw noEnvironmentRole('You hold no role in any environment of your organization.');
    }
    return first;
  }

  async function openSession(
    user: User,
    environment: Environment,
    mfaPassed: boolean,
    providerAmr: readonly string[] | null = null,
  ): Promise<SessionResult> {
    const token = newUserSessionToken();
    // C245.1 (Workflow 11B, auth-sessions): the session lasts the configured absolute limit.
    const absoluteSeconds = (options.sessionTimeouts ?? DEFAULT_SESSION_RESOLUTION.timeouts)
      .absoluteTimeoutSeconds;
    const expiresAt = new Date(clock.now().getTime() + absoluteSeconds * 1000);
    const session = await createUserSession(db, {
      id: ids.newId('uss'),
      organizationId: user.organizationId,
      userId: user.id,
      environmentId: environment.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
      mfaSatisfied: mfaPassed,
      // C168.1 (Workflow 9B): a sign-in that checked a factor starts the step-up window.
      mfaVerifiedAt: mfaPassed ? clock.now() : null,
      // C248.6 (KP11-26): an SSO sign-in's provider amr, for the console's display.
      providerAmr,
      // C168.4: created and first seen now, on the injected clock.
      at: clock.now(),
    });
    return { token, expiresAt, session, user };
  }

  /** The live challenge of `mfaToken` and its user, who must still be able to sign in. */
  async function findMfaChallenge(mfaToken: string): Promise<ActiveMfaChallenge> {
    if (!mfaTokenSchema.safeParse(mfaToken).success) {
      throw new InvalidMfaTokenError();
    }
    const challenge = await findActiveMfaChallenge(db, hashSessionToken(mfaToken), clock.now());
    const user =
      challenge === null ? null : await getUser(db, challenge.organizationId, challenge.userId);
    if (challenge === null || user?.status !== 'active') {
      throw new InvalidMfaTokenError();
    }
    return { challenge, user };
  }

  /**
   * Takes one of the challenge's five attempts before the factor is checked, so parallel
   * guesses on one token cannot all be checked (Workflow 2B F004).
   * @throws {InvalidMfaTokenError} when no attempt is left.
   */
  async function takeMfaAttempt(challenge: MfaChallenge): Promise<void> {
    if (!(await reserveMfaChallengeAttempt(db, challenge.id, { now: clock.now() }))) {
      throw new InvalidMfaTokenError();
    }
  }

  /**
   * After a wrong second factor: the challenge is revoked once its attempts are used up. Returns
   * the error to answer (C25.1): `mfa_attempts_exhausted` from the attempt that revoked it,
   * `mfa_token_invalid` when it was used or revoked meanwhile, else `mfa_code_invalid`.
   */
  async function failMfaChallenge(
    challenge: MfaChallenge,
  ): Promise<InvalidMfaCodeError | InvalidMfaTokenError> {
    const failure = await revokeExhaustedMfaChallenge(db, challenge.id, { at: clock.now() });
    if (failure === null) {
      return new InvalidMfaTokenError();
    }
    return failure.revoked ? new MfaAttemptsExhaustedError() : new InvalidMfaCodeError();
  }

  /** Uses the challenge once and opens the MFA-satisfied session. */
  async function finishMfaChallenge(
    { challenge, user }: ActiveMfaChallenge,
    method: MfaMethod,
  ): Promise<MfaSessionResult> {
    const candidates = await candidateEnvironments(user.organizationId);
    if (candidates.length === 0) {
      throw new InvalidMfaTokenError();
    }
    // C167.2: told only once both factors passed.
    const environment = await enterableEnvironment(user, candidates);
    if (!(await consumeMfaChallenge(db, challenge.id, clock.now()))) {
      throw new InvalidMfaTokenError();
    }
    await rateLimiter.reset({ email: user.email });
    return { ...(await openSession(user, environment, true)), method };
  }

  return {
    async login({ email, password, ip, organization }) {
      const decision = await rateLimiter.attempt({ ip, email });
      if (!decision.allowed) {
        throw new TooManyLoginAttemptsError(decision.retryAfterSeconds);
      }
      const user = await verifyCredentials(email, password, organization);
      const candidates = user === null ? [] : await candidateEnvironments(user.organizationId);
      // An organization without any environment cannot work at all: the generic answer (C4).
      if (user === null || candidates.length === 0) {
        throw new InvalidCredentialsError();
      }
      // C248.6 (sso-oidc): only once the password matched, an enforced provider refuses it.
      await assertPasswordSignInAllowed(db, user, clock.now());
      const factors = await mfa.activeFactors(user.organizationId, user.id);
      if (factors.length > 0) {
        // The email keeps counting until the second factor passes, so a stolen password
        // cannot buy unlimited attempts at the second factor.
        const mfaToken = newMfaToken();
        const expiresAt = new Date(clock.now().getTime() + MFA_TOKEN_TTL_SECONDS * 1000);
        await createMfaChallenge(db, user.organizationId, {
          userId: user.id,
          tokenHash: hashSessionToken(mfaToken),
          expiresAt,
        });
        return {
          kind: 'mfa',
          mfaToken,
          expiresAt,
          factors: factors.map(({ id, type }) => ({ id, type })),
          user,
        };
      }
      const environment = await enterableEnvironment(user, candidates);
      await rateLimiter.reset({ email });
      return { kind: 'session', ...(await openSession(user, environment, false)) };
    },

    async completeMfa({ mfaToken, totpCode, recoveryCode }) {
      const active = await findMfaChallenge(mfaToken);
      await takeMfaAttempt(active.challenge);
      const { organizationId, id: userId } = active.user;
      let method: MfaMethod | null = null;
      if (totpCode !== undefined) {
        method = (await mfa.verifyTotp(organizationId, userId, totpCode)) === null ? null : 'totp';
      } else if (recoveryCode !== undefined) {
        const used = await mfa.useRecoveryCode(organizationId, userId, recoveryCode);
        method = used ? 'recovery-code' : null;
      }
      if (method === null) {
        throw await failMfaChallenge(active.challenge);
      }
      return finishMfaChallenge(active, method);
    },

    async webauthnLoginOptions(mfaToken) {
      const { challenge, user } = await findMfaChallenge(mfaToken);
      const login = await mfa.webauthnAuthenticationOptions(user.organizationId, user.id);
      if (!(await setMfaChallengeWebauthnChallenge(db, challenge.id, login.challengeHash))) {
        throw new InvalidMfaTokenError();
      }
      return login.options;
    },

    async completeWebauthnMfa({ mfaToken, credential }) {
      const active = await findMfaChallenge(mfaToken);
      const { challenge, user } = active;
      await takeMfaAttempt(challenge);
      const signed = clientDataChallenge(credential.response.clientDataJSON);
      const issued =
        signed !== null &&
        challenge.webauthnChallengeHash !== null &&
        timingSafeEqual(
          Buffer.from(challengeHash(signed), 'utf8'),
          Buffer.from(challenge.webauthnChallengeHash, 'utf8'),
        );
      const factor = issued
        ? await mfa.verifyWebauthnAuthentication(user.organizationId, user.id, credential, signed)
        : null;
      if (factor === null) {
        throw await failMfaChallenge(challenge);
      }
      return finishMfaChallenge(active, 'webauthn');
    },

    async stepUp({ sessionId, user, ip, totpCode, credential }) {
      const decision = await rateLimiter.attempt({ ip, email: user.email });
      if (!decision.allowed) {
        throw new TooManyLoginAttemptsError(decision.retryAfterSeconds);
      }
      const { organizationId, id: userId } = user;
      let method: StepUpResult['method'] | null = null;
      if (totpCode !== undefined) {
        method = (await mfa.verifyTotp(organizationId, userId, totpCode)) === null ? null : 'totp';
      } else if (credential !== undefined) {
        const signed = clientDataChallenge(credential.response.clientDataJSON);
        const challenge =
          signed === null
            ? null
            : await findStepUpChallenge(
                db,
                organizationId,
                userId,
                challengeHash(signed),
                clock.now(),
              );
        // The challenge is spent before the assertion is checked, so it cannot be replayed.
        const spent =
          challenge !== null && (await consumeMfaChallenge(db, challenge.id, clock.now()));
        const factor =
          spent && signed !== null
            ? await mfa.verifyWebauthnAuthentication(organizationId, userId, credential, signed)
            : null;
        method = factor === null ? null : 'webauthn';
      }
      if (method === null) {
        throw new InvalidMfaCodeError();
      }
      const verifiedAt = clock.now();
      if ((await markUserSessionMfaVerified(db, sessionId, verifiedAt)) === null) {
        throw new InvalidMfaCodeError();
      }
      await rateLimiter.reset({ email: user.email });
      return { method, verifiedAt };
    },

    async stepUpWebauthnOptions(user) {
      const login = await mfa.webauthnAuthenticationOptions(user.organizationId, user.id);
      const challenge = await createMfaChallenge(db, user.organizationId, {
        userId: user.id,
        // Never handed out: the step-up is found by its WebAuthn challenge, on the user's session.
        tokenHash: hashSessionToken(newMfaToken()),
        expiresAt: new Date(clock.now().getTime() + MFA_TOKEN_TTL_SECONDS * 1000),
      });
      await setMfaChallengeWebauthnChallenge(db, challenge.id, login.challengeHash);
      return login.options;
    },

    async authenticate(token, authenticateOptions) {
      // C245.1, C245.2 (Workflow 11B Stage 1b (A)): the limits and whether this request is activity.
      const context = await findUserSessionContext(db, token, clock.now(), {
        activity: authenticateOptions?.activity ?? true,
        timeouts: options.sessionTimeouts ?? DEFAULT_SESSION_RESOLUTION.timeouts,
      });
      if (context === null) {
        return null;
      }
      // C168.4 (Workflow 9B): "last seen" is moved by the session policy (C245.1, auth-sessions:
      // at most once a minute, never for a route marked `activity: false`).
      return {
        sessionId: context.session.id,
        organizationId: context.session.organizationId,
        environmentId: context.session.environmentId,
        environmentKind: context.environmentKind,
        user: context.user,
        permissions: context.permissions,
        mfaSatisfied: context.mfaSatisfied,
      };
    },

    logout: (sessionId) => revokeUserSession(db, sessionId, clock.now()),
    async openSsoSession(user, mfaPassed, providerAmr = null) {
      const environment = await enterableEnvironment(
        user,
        await candidateEnvironments(user.organizationId),
      );
      return openSession(user, environment, mfaPassed, providerAmr);
    },
    async startSsoMfaChallenge(user) {
      const factors = await mfa.activeFactors(user.organizationId, user.id);
      if (factors.length === 0) {
        return null;
      }
      const mfaToken = newMfaToken();
      const expiresAt = new Date(clock.now().getTime() + MFA_TOKEN_TTL_SECONDS * 1000);
      await createMfaChallenge(db, user.organizationId, {
        userId: user.id,
        tokenHash: hashSessionToken(mfaToken),
        expiresAt,
      });
      return { mfaToken, expiresAt, factors: factors.map(({ id, type }) => ({ id, type })), user };
    },
    clientAddress,
    hasher,
    mfa,
    clock,
  };
}
