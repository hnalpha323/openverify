/**
 * C82.1: `email-spf-policy` from the domain's own SPF record (RFC 7208), never following
 * `include:` or `redirect=`; informational only.
 */
import { describe, expect, it } from 'vitest';
import { readSpfPolicy, type TxtRecords } from './spf.js';

const one = (...strings: string[]): TxtRecords => [strings];

describe('readSpfPolicy', () => {
  it('reads no record from an empty answer or one without v=spf1', () => {
    expect(readSpfPolicy([])).toEqual({ policy: 'no_record', redirect: false });
    expect(readSpfPolicy([['site-verification=abc'], ['v=DMARC1; p=none']])).toEqual({
      policy: 'no_record',
      redirect: false,
    });
    // The version section ends at a space or the end of the record (RFC 7208 §4.5).
    expect(readSpfPolicy(one('v=spf1all'))).toEqual({ policy: 'no_record', redirect: false });
  });

  it.each([
    ['v=spf1 include:_spf.example.net -all', 'fail'],
    ['v=spf1 mx ~all', 'softfail'],
    ['v=spf1 ?all', 'neutral'],
    ['v=spf1 +all', 'pass'],
    ['v=spf1 all', 'pass'],
    ['V=SPF1 -ALL', 'fail'],
    ['v=spf1  ip4:192.0.2.0/24   -all', 'fail'],
  ] as const)('reads %j as %s', (text, policy) => {
    expect(readSpfPolicy(one(text))).toEqual({ policy, redirect: false });
  });

  it('concatenates the strings of one record (RFC 7208 §3.3)', () => {
    expect(readSpfPolicy(one('v=spf1 ip4:192.0.2.0/24 ', '-all'))).toEqual({
      policy: 'fail',
      redirect: false,
    });
  });

  it('takes the first all: mechanisms after it are never reached', () => {
    expect(readSpfPolicy(one('v=spf1 a mx -all ~all')).policy).toBe('fail');
  });

  it('reads no all, saying whether a redirect decides; a redirect beside an all is ignored', () => {
    expect(readSpfPolicy(one('v=spf1 redirect=_spf.example.net'))).toEqual({
      policy: 'no_all',
      redirect: true,
    });
    expect(readSpfPolicy(one('v=spf1 mx'))).toEqual({ policy: 'no_all', redirect: false });
    expect(readSpfPolicy(one('v=spf1'))).toEqual({ policy: 'no_all', redirect: false });
    expect(readSpfPolicy(one('v=spf1 a -all redirect=_spf.example.net'))).toEqual({
      policy: 'fail',
      redirect: false,
    });
  });

  it('accepts every mechanism form RFC 7208 defines, and ignores unknown modifiers', () => {
    expect(
      readSpfPolicy(
        one(
          'v=spf1 a a:mail.example.org a/24 a:mail.example.org/24//64 mx mx//64 ptr ptr:example.org',
          'ip4:192.0.2.1 ip6:2001:db8::/32 ip6:2001:db8::1 exists:%{i}.example.org',
          'include:_spf.example.net foo=bar exp=explain.example.org -all',
        ),
      ).policy,
    ).toBe('fail');
  });

  it.each([
    ['two SPF records', [['v=spf1 -all'], ['v=spf1 ~all']]],
    ['an unknown mechanism', [['v=spf1 foo -all']]],
    ['a mechanism named like an object member', [['v=spf1 constructor tostring -all']]],
    ['an include without a domain', [['v=spf1 include -all']]],
    ['an exists without a domain', [['v=spf1 exists: -all']]],
    ['all with an argument', [['v=spf1 all:example.org']]],
    ['an IPv4 network out of range', [['v=spf1 ip4:300.1.1.1 -all']]],
    ['an IPv4 prefix over 32', [['v=spf1 ip4:192.0.2.1/33 -all']]],
    ['an IPv6 network that is not one', [['v=spf1 ip6:2001:db8::zz -all']]],
    ['an IPv6 prefix over 128', [['v=spf1 ip6:2001:db8::/129 -all']]],
    ['two redirects', [['v=spf1 redirect=a.example redirect=b.example']]],
    ['two explanations', [['v=spf1 exp=a.example exp=b.example -all']]],
    ['an empty redirect', [['v=spf1 redirect=']]],
    ['two qualifiers', [['v=spf1 --all']]],
    ['a character outside visible ASCII', [['v=spf1 a:é.example -all']]],
    ['a record over 4 KiB', [[`v=spf1 ${'a '.repeat(2100)}-all`]]],
  ] as const)('reads %s as invalid (a permerror)', (_case, records) => {
    expect(readSpfPolicy(records).policy).toBe('invalid');
  });
});
