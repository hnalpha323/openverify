/**
 * Dashboard operator authentication: Argon2id passwords, `ovu_` user sessions stored as SHA-256
 * hashes with a 12 hour TTL and login rate limits per address and email (C4), plus the C15
 * additions: MFA login with `ovm_` challenges, the session context (environment, role
 * permissions, MFA), the server API's user-session principal resolver, the trusted BFF client
 * address and the operator settings.
 */
export {
  BFF_CLIENT_IP_HEADER,
  BFF_TOKEN_HEADER,
  createClientAddressResolver,
  type ClientAddressResolver,
} from './client-address.js';
export {
  DEFAULT_LOGIN_RATE_LIMITS,
  createLoginRateLimiter,
  type LoginRateLimitOptions,
  type LoginRateLimiter,
  type RateLimitDecision,
  type RateLimitRule,
} from './login-rate-limiter.js';
export {
  InvalidCredentialsError,
  InvalidMfaCodeError,
  InvalidMfaTokenError,
  MfaAttemptsExhaustedError,
  TooManyLoginAttemptsError,
  createOperatorAuth,
  type AuthenticatedOperator,
  type CompleteMfaInput,
  type CompleteWebauthnMfaInput,
  type LoginInput,
  type LoginOutcome,
  type LoginResult,
  type MfaChallengeResult,
  type MfaMethod,
  type MfaSessionResult,
  type OperatorAuth,
  type OperatorAuthOptions,
  type SessionResult,
} from './operator-auth.js';
export {
  ARGON2ID_OPTIONS,
  createArgon2idHasher,
  hashPassword,
  type Argon2idOptions,
  type PasswordHasher,
} from './password-hasher.js';
export {
  createUserSessionPrincipalResolver,
  type UserSessionPrincipalResolverOptions,
} from './principal-resolver.js';
export {
  findUserSessionContext,
  userPrincipalOf,
  type UserSessionContext,
} from './session-context.js';
export {
  fastifyTrustProxy,
  resolveOperatorSettings,
  trustProxySchema,
  type OperatorSettings,
  type TrustProxySetting,
  type WebauthnSettings,
} from './settings.js';
