/**
 * C55.9: the SMS and email texts in English and Spanish, with the organization name sanitized,
 * the origin-bound last line from the flow's configured host, and no link in the email.
 */
import { describe, expect, it } from 'vitest';
import { flowHostOf, otpEmailMessage, otpMessageLocale, otpSmsBody } from './messages.js';

const HOST = 'flow.example.test';

describe('otpMessageLocale', () => {
  it.each([
    ['es', 'es'],
    ['es-MX', 'es'],
    ['ES', 'es'],
    ['en', 'en'],
    ['en-GB', 'en'],
    ['fr', 'en'],
    [null, 'en'],
    [undefined, 'en'],
  ] as const)('reads %s as %s', (locale, language) => {
    expect(otpMessageLocale(locale)).toBe(language);
  });
});

describe('flowHostOf', () => {
  it('is the host of the configured flow URL, port included', () => {
    expect(flowHostOf('https://flow.example.test')).toBe('flow.example.test');
    expect(flowHostOf('https://flow.example.test/start?x=1')).toBe('flow.example.test');
    expect(flowHostOf('http://127.0.0.1:4173')).toBe('127.0.0.1:4173');
  });
});

describe('the SMS (C55.9)', () => {
  it('names the organization, the code and the origin-bound line, in English', () => {
    expect(
      otpSmsBody({ organizationName: 'Acme Synthetic', code: '123456', locale: 'en', flowHost: HOST }),
    ).toBe(
      'Acme Synthetic: 123456 is your verification code. Do not share it.\n\n@flow.example.test #123456',
    );
  });

  it('and in Spanish', () => {
    expect(
      otpSmsBody({ organizationName: 'Acme Synthetic', code: '654321', locale: 'es', flowHost: HOST }),
    ).toBe(
      'Acme Synthetic: 654321 es tu código de verificación. No lo compartas.\n\n@flow.example.test #654321',
    );
  });

  it('strips links, @, #, long digit runs and control characters from the name', () => {
    const body = otpSmsBody({
      organizationName: 'Acme\u0007 https://phish.example @evil #win 12345678 Ltd',
      code: '123456',
      locale: 'en',
      flowHost: HOST,
    });

    const [name] = body.split(': 123456');
    expect(name).not.toMatch(/https|phish|[@#]|12345678/u);
    expect(name?.includes('\u0007')).toBe(false);
    expect(name).toContain('Acme');
    expect(body.endsWith('\n\n@flow.example.test #123456')).toBe(true);
  });

  it('leaves the name out when nothing of it is left', () => {
    expect(
      otpSmsBody({ organizationName: 'https://x.example', code: '123456', locale: 'en', flowHost: HOST }),
    ).toBe('123456 is your verification code. Do not share it.\n\n@flow.example.test #123456');
  });
});

describe('the email (C55.9)', () => {
  it('has the organization in the subject and the code in plain text with no link', () => {
    const message = otpEmailMessage({
      organizationName: 'Acme Synthetic',
      code: '123456',
      locale: 'en',
    });

    expect(message.subject).toBe('Acme Synthetic verification code');
    expect(message.text).toContain('123456');
    expect(message.text).toContain('10 minutes');
    expect(message.text).not.toMatch(/https?:|www\.|@/u);
  });

  it('is written in Spanish for a Spanish consent', () => {
    const message = otpEmailMessage({
      organizationName: 'Acme Synthetic',
      code: '123456',
      locale: 'es',
    });

    expect(message.subject).toBe('Código de verificación de Acme Synthetic');
    expect(message.text).toContain('123456');
    expect(message.text).toContain('10 minutos');
  });

  it('has a plain subject without a name', () => {
    expect(otpEmailMessage({ organizationName: '', code: '123456', locale: 'en' }).subject).toBe(
      'Verification code',
    );
    expect(otpEmailMessage({ organizationName: '', code: '123456', locale: 'es' }).subject).toBe(
      'Código de verificación',
    );
  });
});
