/** C61.3, C61.4: the website's host, public addresses, and the sandbox reserved-name rule. */
import { describe, expect, it } from 'vitest';
import { isPublicIpAddress, sandboxWebsiteHostRule, websiteHostOf } from './website.js';

describe('websiteHostOf', () => {
  it.each([
    ['https://Shop.Old.Example/path?x=1#y', 'shop.old.example'],
    ['http://old.example:80', 'old.example'],
    ['https://old.example./', 'old.example'],
    ['https://bücher.example/', 'xn--bcher-kva.example'],
  ])('reads %s as %s', (url, host) => {
    expect(websiteHostOf(url)).toBe(host);
  });

  it.each(['ftp://old.example', 'not a url', 'https://192.0.2.1/', 'https://[2001:db8::1]/', ''])(
    'reads no host from %j',
    (url) => {
      expect(websiteHostOf(url)).toBeNull();
    },
  );
});

describe('isPublicIpAddress', () => {
  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    '%s is public',
    (address) => {
      expect(isPublicIpAddress(address)).toBe(true);
    },
  );

  it.each([
    '10.0.0.1',
    '172.16.5.4',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.1.1',
    '100.64.0.1',
    '0.0.0.0',
    '192.0.0.8',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '64:ff9b::1',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ])('%s is not public', (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });
});

describe('sandboxWebsiteHostRule', () => {
  it.each([
    ['old.example', 'resolves'],
    ['shop.old.example', 'resolves'],
    ['nordap.test', 'resolves'],
    ['gone.invalid', 'does_not_resolve'],
    ['old.example.org', null],
    ['utopia.org', null],
  ] as const)('in a sandbox environment, %s: %s', (host, outcome) => {
    expect(sandboxWebsiteHostRule(host, 'sandbox')).toBe(outcome);
  });

  it('asks DNS for every host in production', () => {
    expect(sandboxWebsiteHostRule('old.example', 'production')).toBeNull();
    expect(sandboxWebsiteHostRule('gone.invalid', 'production')).toBeNull();
  });
});
