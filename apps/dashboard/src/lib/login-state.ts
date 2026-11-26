/** Why a sign-in attempt failed, as the login server action reports it to the form. */
export type LoginError =
  'invalid_input' | 'invalid_credentials' | 'rate_limited' | 'no_environment_role' | 'unavailable';

/**
 * C167.2's 403 `no_environment_role` in words (K9-9): the account holds no role it may use, and an
 * administrator gives one. Never which roles or environments exist.
 */
export const NO_ENVIRONMENT_ROLE_WORDS = Object.freeze({
  signIn:
    'Your account holds no role in any environment of this organization, so the console cannot open. Ask an administrator of your organization to give you a role.',
  environmentSwitch:
    'Your account holds no role in that environment. Ask an administrator of your organization to give you a role there.',
});

export interface LoginState {
  readonly error: LoginError | null;
}

export const INITIAL_LOGIN_STATE: LoginState = Object.freeze({ error: null });

/** What the form says for each failure. The API's 401 never reveals which part was wrong. */
export const LOGIN_ERROR_MESSAGES: Readonly<Record<LoginError, string>> = Object.freeze({
  invalid_input: 'Enter a valid email address and password.',
  invalid_credentials: 'The email or password is incorrect.',
  rate_limited: 'Too many sign-in attempts. Wait a few minutes, then try again.',
  no_environment_role: NO_ENVIRONMENT_ROLE_WORDS.signIn,
  unavailable: 'Sign-in is unavailable right now. Try again later.',
});
