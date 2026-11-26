/**
 * C55.8: the email destination rule. Addresses are synthetic, at RFC 2606 names, except the three
 * nodemailer address-parser advisory payloads of 2026-10-19, which are quoted exactly as published
 * (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w and GHSA-85x2-q946-cp5h).
 */
import { describe, expect, it } from 'vitest';
import { cpuMilliseconds } from '../document/testing.js';
import {
  EMAIL_ADDRESS_LIMITS,
  maskEmailDestination,
  validateEmailDestination,
} from './email-destination.js';

const refused = (refusal: string) => ({ ok: false, problem: 'otp_destination_invalid', refusal });

describe('validateEmailDestination (C55.8)', () => {
  it('accepts a WHATWG-valid address and lower-cases only its domain and normalized form', () => {
    expect(validateEmailDestination('Ada.Lovelace+otp@Mail.Example.COM')).toEqual({
      ok: true,
      address: 'Ada.Lovelace+otp@mail.example.com',
      domain: 'mail.example.com',
      normalized: 'ada.lovelace+otp@mail.example.com',
    });
  });

  it.each([
    "o'brien@example.org",
    'a!#$%&*+/=?^_`{|}~-z@example.org',
    'x@a-b.example',
    '1@2.example',
  ])('accepts every atext character of a dot-string local part: %s', (value) => {
    expect(validateEmailDestination(value)).toMatchObject({ ok: true, address: value });
  });

  it('ignores leading and trailing ASCII whitespace, as the WHATWG email input does', () => {
    expect(validateEmailDestination(' \t user@example.org \r\n')).toMatchObject({
      ok: true,
      address: 'user@example.org',
    });
  });

  it('converts an internationalised domain to its ASCII form', () => {
    expect(validateEmailDestination('user@bücher.example')).toEqual({
      ok: true,
      address: 'user@xn--bcher-kva.example',
      domain: 'xn--bcher-kva.example',
      normalized: 'user@xn--bcher-kva.example',
    });
    expect(validateEmailDestination('user@Ｅｘａｍｐｌｅ.org')).toMatchObject({
      domain: 'example.org',
    });
  });

  describe('the 2026-10-19 nodemailer advisory payloads never reach the mailer', () => {
    it.each([
      // GHSA-8c8m-p3m8-cjg8: a nested comment ends early.
      'Victim (x(y) <evil@evil.com>) <v@victim.com>',
      // GHSA-m943-m63m-w62w: a ";" inside a comment or a quoted string ends a group early.
      'G: (a; <evil@evil.com>) <v@victim.com>;',
      'G: "a;" "<evil@evil.com>" <v@victim.com>;',
      // GHSA-85x2-q946-cp5h: a ">" inside a quoted local part ends an angle-addr early.
      '<"a@evil.com>"@good.com>',
      '"a@evil.com>"@good.com',
    ])('refuses %j', (payload) => {
      expect(validateEmailDestination(payload)).toEqual(refused('syntax'));
    });
  });

  it.each([
    ['plainaddress', 'no @'],
    ['a@b@example.org', 'two @'],
    ['@example.org', 'an empty local part'],
    ['user@', 'an empty domain'],
    ['"quoted"@example.org', 'a quoted local part'],
    ['user name@example.org', 'a space'],
    ['user\n@example.org', 'a line break'],
    ['<user@example.org>', 'angle brackets'],
    ['user@example.org (comment)', 'a comment'],
    ['user,other@example.org', 'a comma'],
    ['.user@example.org', 'a leading dot'],
    ['user.@example.org', 'a trailing dot'],
    ['us..er@example.org', 'two dots'],
    ['user@exa_mple.org', 'an underscore in the domain'],
    ['user@exa%2emple.org', 'a percent-encoded dot, which the URL host parser decodes'],
    ['user@ex ample.org', 'a space in the domain'],
  ])('refuses %j (%s) as syntax', (value) => {
    expect(validateEmailDestination(value)).toEqual(refused('syntax'));
  });

  it('refuses an internationalised (SMTPUTF8) local part', () => {
    expect(validateEmailDestination('jürgen@example.org')).toEqual(refused('local_part_not_ascii'));
    expect(validateEmailDestination('用户@example.org')).toEqual(refused('local_part_not_ascii'));
  });

  it.each([
    ['user@-bad.example', 'a label starting with a hyphen'],
    ['user@bad-.example', 'a label ending with a hyphen'],
    ['user@a..example', 'an empty label'],
    ['user@example.org.', 'a trailing dot'],
    [`user@${'a'.repeat(64)}.example`, 'a label of 64 characters'],
    ['user@xn--zz.example', 'an invalid punycode label'],
  ])('refuses %j (%s) as domain_invalid', (value) => {
    expect(validateEmailDestination(value)).toEqual(refused('domain_invalid'));
  });

  it('refuses a single-label domain', () => {
    expect(validateEmailDestination('user@localhost')).toEqual(refused('domain_without_dot'));
  });

  it.each([
    'user@[192.0.2.1]',
    'user@[IPv6:2001:db8::1]',
    'user@192.0.2.1',
    'user@0x7f.1',
    'user@203.0.113.04',
  ])('refuses the IP literal or IPv4-looking host %j', (value) => {
    expect(validateEmailDestination(value)).toEqual(refused('domain_ip_literal'));
  });

  it('applies the RFC 5321 §4.5.3.1 lengths', () => {
    expect(EMAIL_ADDRESS_LIMITS).toEqual({
      localPartMaxOctets: 64,
      domainMaxOctets: 255,
      addressMaxOctets: 254,
    });
    expect(validateEmailDestination(`${'a'.repeat(64)}@example.org`)).toMatchObject({ ok: true });
    expect(validateEmailDestination(`${'a'.repeat(65)}@example.org`)).toEqual(
      refused('local_part_too_long'),
    );
    const label = 'b'.repeat(63);
    const domain253 = `${label}.${label}.${label}.${'b'.repeat(53)}.example`;
    expect(domain253).toHaveLength(253);
    expect(validateEmailDestination(`a@${domain253}`)).toEqual(refused('address_too_long'));
    const domain263 = `${label}.${label}.${label}.${label}.example`;
    expect(validateEmailDestination(`a@${domain263}`)).toEqual(refused('domain_too_long'));
  });

  it('stays fast on a long hostile value', () => {
    expect(
      cpuMilliseconds(() => {
        validateEmailDestination(`${'a.'.repeat(50_000)}@${'b.'.repeat(50_000)}`);
        validateEmailDestination(`${'!'.repeat(100_000)}@example.org`);
      }),
    ).toBeLessThan(500);
  });
});

describe('maskEmailDestination (C52.2)', () => {
  it('shows the first character of the local part and the domain', () => {
    expect(maskEmailDestination('ada.lovelace@mail.example.com')).toBe('a•••@mail.example.com');
    expect(maskEmailDestination('x@example.org')).toBe('x•••@example.org');
  });

  it('shortens a long domain from the left to fit 64 characters', () => {
    const domain = `${'c'.repeat(60)}.${'d'.repeat(60)}.example`;
    const masked = maskEmailDestination(`user@${domain}`);
    expect(masked).toHaveLength(64);
    expect(masked.startsWith('u•••@…')).toBe(true);
    expect(masked.endsWith('d.example')).toBe(true);
  });
});
