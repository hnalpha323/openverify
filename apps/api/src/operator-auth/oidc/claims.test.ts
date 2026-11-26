import { describe, expect, it } from 'vitest';
import {
  AUTH_TIME_SKEW_SECONDS,
  meetsAuthenticationRequirement,
  reauthenticatedWithin,
  tenantPinHolds,
  verifiedEmailOf,
} from './claims.js';

const DOMAINS = ['example.com', 'example.org'];

describe('ID token claims (C248.3, C248.4, C248.6)', () => {
  it('holds a tenant pin only on its exact value', () => {
    expect(tenantPinHolds({ tid: 't-1' }, null)).toBe(true);
    expect(tenantPinHolds({ tid: 't-1' }, { claim: 'tid', value: 't-1' })).toBe(true);
    expect(tenantPinHolds({ tid: 't-2' }, { claim: 'tid', value: 't-1' })).toBe(false);
    expect(tenantPinHolds({}, { claim: 'hd', value: 'example.com' })).toBe(false);
    expect(tenantPinHolds({ hd: ['example.com'] }, { claim: 'hd', value: 'example.com' })).toBe(
      false,
    );
    expect(tenantPinHolds({ hd: 'example.com' }, { claim: 'hd', value: 'example.com' })).toBe(true);
  });

  it('matches the first link only on a verified email inside the domains', () => {
    expect(verifiedEmailOf({ email: ' Ada@Example.com ', email_verified: true }, DOMAINS)).toEqual({
      ok: true,
      email: 'ada@example.com',
    });
    expect(verifiedEmailOf({ email_verified: true }, DOMAINS)).toEqual({
      ok: false,
      failure: 'email_missing',
    });
    // Absent is false, and only the boolean true counts (C248.4).
    expect(verifiedEmailOf({ email: 'ada@example.com' }, DOMAINS)).toEqual({
      ok: false,
      failure: 'email_unverified',
    });
    for (const value of ['true', 1, false, null]) {
      expect(verifiedEmailOf({ email: 'ada@example.com', email_verified: value }, DOMAINS)).toEqual(
        { ok: false, failure: 'email_unverified' },
      );
    }
    for (const email of [
      'ada@example.net',
      'ada@sub.example.com',
      'ada@example.com.evil.test',
      'ada',
    ]) {
      expect(verifiedEmailOf({ email, email_verified: true }, DOMAINS)).toEqual({
        ok: false,
        failure: email === 'ada' ? 'email_missing' : 'email_domain_not_allowed',
      });
    }
  });

  it('stands in for the local factor only when every named requirement is met', () => {
    expect(meetsAuthenticationRequirement({ amr: ['pwd', 'mfa'] }, [], [])).toBe(false);
    expect(meetsAuthenticationRequirement({ amr: ['pwd', 'mfa'] }, ['mfa'], [])).toBe(true);
    expect(meetsAuthenticationRequirement({ amr: ['pwd'] }, ['mfa'], [])).toBe(false);
    expect(meetsAuthenticationRequirement({ amr: 'mfa' }, ['mfa'], [])).toBe(false);
    expect(meetsAuthenticationRequirement({}, ['mfa'], [])).toBe(false);
    expect(meetsAuthenticationRequirement({ amr: ['hwk', 'pin'] }, ['hwk', 'pin'], [])).toBe(true);
    expect(
      meetsAuthenticationRequirement({ acr: 'urn:loa:2' }, [], ['urn:loa:2', 'urn:loa:3']),
    ).toBe(true);
    expect(meetsAuthenticationRequirement({ acr: 'urn:loa:1' }, [], ['urn:loa:2'])).toBe(false);
    expect(
      meetsAuthenticationRequirement({ amr: ['mfa'], acr: 'urn:loa:1' }, ['mfa'], ['urn:loa:2']),
    ).toBe(false);
    expect(
      meetsAuthenticationRequirement({ amr: ['mfa'], acr: 'urn:loa:2' }, ['mfa'], ['urn:loa:2']),
    ).toBe(true);
  });

  it('takes a step-up as fresh only within the window', () => {
    const now = new Date('2026-11-13T12:00:00Z');
    const at = (secondsAgo: number) => ({ auth_time: now.getTime() / 1000 - secondsAgo });
    expect(reauthenticatedWithin(at(0), now, 600)).toBe(true);
    expect(reauthenticatedWithin(at(600), now, 600)).toBe(true);
    expect(reauthenticatedWithin(at(601), now, 600)).toBe(false);
    expect(reauthenticatedWithin(at(-AUTH_TIME_SKEW_SECONDS), now, 600)).toBe(true);
    expect(reauthenticatedWithin(at(-AUTH_TIME_SKEW_SECONDS - 1), now, 600)).toBe(false);
    expect(reauthenticatedWithin({}, now, 600)).toBe(false);
    expect(reauthenticatedWithin({ auth_time: '1763035200' }, now, 600)).toBe(false);
  });
});
