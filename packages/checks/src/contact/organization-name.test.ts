/** C55.9, C57.2: the organization name a code message or a wallet challenge carries. */
import { describe, expect, it } from 'vitest';
import { cpuMilliseconds } from '../document/testing.js';
import { ORGANIZATION_NAME_MAX_LENGTH, sanitizeOrganizationName } from './organization-name.js';

describe('sanitizeOrganizationName (C55.9)', () => {
  it('keeps an ordinary name as it is', () => {
    expect(sanitizeOrganizationName('Utopia Water Board')).toBe('Utopia Water Board');
    expect(sanitizeOrganizationName('Café Zürich & Söhne')).toBe('Café Zürich & Söhne');
    expect(sanitizeOrganizationName('J.P. Example Co.')).toBe('J.P. Example Co.');
    expect(sanitizeOrganizationName('Route 66 Diner')).toBe('Route 66 Diner');
  });

  it('drops every word that is a URL or a host name, so the message carries no link', () => {
    expect(sanitizeOrganizationName('Acme https://evil.example/login now')).toBe('Acme now');
    expect(sanitizeOrganizationName('Acme ftp://files.example')).toBe('Acme');
    expect(sanitizeOrganizationName('Acme www.evil.example')).toBe('Acme');
    expect(sanitizeOrganizationName('Visit acme.example, today')).toBe('Visit today');
    expect(sanitizeOrganizationName('Pay at PAY.EXAMPLE.COM.')).toBe('Pay at');
  });

  it('removes @ and # so no mention or origin-bound code line can be forged', () => {
    expect(sanitizeOrganizationName('@acme #123 Bank')).toBe('acme 123 Bank');
    expect(sanitizeOrganizationName('Acme\n\n@verify.example #654321')).toBe('Acme');
  });

  it('removes runs of four or more digits, in any script, so no second code appears', () => {
    expect(sanitizeOrganizationName('Acme 123456 Bank')).toBe('Acme Bank');
    expect(sanitizeOrganizationName('Room1234B')).toBe('RoomB');
    expect(sanitizeOrganizationName('Acme ١٢٣٤٥٦')).toBe('Acme');
    expect(sanitizeOrganizationName('Acme １２３４')).toBe('Acme');
    expect(sanitizeOrganizationName('Year 2026')).toBe('Year');
    expect(sanitizeOrganizationName('Gate 123')).toBe('Gate 123');
  });

  it('turns control characters into spaces and removes format characters', () => {
    expect(sanitizeOrganizationName('Acme\u0000\u0007Bank')).toBe('Acme Bank');
    expect(sanitizeOrganizationName('Acme\u2028Bank\u2029')).toBe('Acme Bank');
    // A right-to-left override and zero-width characters would hide or reorder text.
    expect(sanitizeOrganizationName('Ac\u202Eme\u200B Ba\u200Dnk\uFEFF')).toBe('Acme Bank');
    expect(sanitizeOrganizationName('Acme\uE000 Bank')).toBe('Acme Bank');
  });

  it('collapses whitespace and cuts the result to 40 characters, never inside a character', () => {
    expect(ORGANIZATION_NAME_MAX_LENGTH).toBe(40);
    expect(sanitizeOrganizationName('  Acme \t  Bank  ')).toBe('Acme Bank');
    const long = sanitizeOrganizationName(
      'The Very Long Name of a Regional Water Board Cooperative',
    );
    expect(long).toBe('The Very Long Name of a Regional Water B');
    expect(Array.from(sanitizeOrganizationName('😀'.repeat(45)))).toHaveLength(40);
    expect(sanitizeOrganizationName(`${'a'.repeat(39)} bcd`)).toBe('a'.repeat(39));
  });

  it('may return an empty name', () => {
    expect(sanitizeOrganizationName('')).toBe('');
    expect(sanitizeOrganizationName('https://evil.example 123456 @#')).toBe('');
  });

  it('stays fast on a long hostile value', () => {
    expect(
      cpuMilliseconds(() => {
        sanitizeOrganizationName(`${'a'.repeat(100_000)}://`);
        sanitizeOrganizationName(`${'1a.'.repeat(30_000)}com`);
        sanitizeOrganizationName('www.'.repeat(25_000));
      }),
    ).toBeLessThan(500);
  });
});
