export interface LoginCredentials {
  readonly email: string;
  readonly password: string;
}

/** One error code per field; the form maps codes to messages. */
export interface LoginErrors {
  readonly email?: 'required' | 'invalid';
  readonly password?: 'required';
}

// Deliberately loose (something@something.tld, no spaces): it catches typos, while the
// server stays the authority on which accounts exist.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Client-side checks for the sign-in form. The email is trimmed before checking; the
 * password is only required to be non-empty, because any character may be part of it.
 */
export function validateLogin({ email, password }: LoginCredentials): LoginErrors {
  const address = email.trim();
  const errors: { -readonly [K in keyof LoginErrors]: LoginErrors[K] } = {};
  if (address === '') {
    errors.email = 'required';
  } else if (!EMAIL_PATTERN.test(address)) {
    errors.email = 'invalid';
  }
  // eslint-disable-next-line security/detect-possible-timing-attacks -- an emptiness check, not a comparison of two secrets
  if (password === '') {
    errors.password = 'required';
  }
  return errors;
}

export function hasErrors(errors: LoginErrors): boolean {
  return Object.keys(errors).length > 0;
}
