import { describe, expect, it } from 'vitest';
import { hasErrors, validateLogin } from './login-validation';

describe('validateLogin', () => {
  it('requires both fields', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'required',
      password: 'required',
    });
  });

  it('treats a whitespace-only email as missing', () => {
    expect(validateLogin({ email: '   ', password: 'secret' })).toEqual({ email: 'required' });
  });

  it.each([
    'plainaddress',
    'name@',
    '@example.com',
    'name@example',
    'na me@example.com',
    'a@@b.co',
  ])('rejects the malformed email %j', (email) => {
    expect(validateLogin({ email, password: 'secret' })).toEqual({ email: 'invalid' });
  });

  it.each(['operator@example.com', '  operator@example.com  ', 'first.last+tag@sub.example.org'])(
    'accepts the email %j',
    (email) => {
      expect(validateLogin({ email, password: 'secret' })).toEqual({});
    },
  );

  it('accepts any non-empty password, including surrounding spaces', () => {
    expect(validateLogin({ email: 'operator@example.com', password: '  pass phrase  ' })).toEqual(
      {},
    );
  });
});

describe('hasErrors', () => {
  it('is false for an empty result and true otherwise', () => {
    expect(hasErrors({})).toBe(false);
    expect(hasErrors({ password: 'required' })).toBe(true);
  });
});
