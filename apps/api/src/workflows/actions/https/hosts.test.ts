/**
 * C124.3: one host normaliser for every allowlist, `allowed_hosts` and Slack comparison, always on
 * the parsed URL, never on text. Every host here is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { hostIsListed, normalizeHost, normalizeHostOf } from './hosts.js';

describe('normalizeHost', () => {
  it.each([
    ['api.example.com', 'api.example.com'],
    ['API.Example.COM', 'api.example.com'],
    ['api.example.com.', 'api.example.com'],
    ['api%2Eexample%2Ecom', 'api.example.com'],
    ['ex%61mple.com', 'example.com'],
    ['bücher.example', 'xn--bcher-kva.example'],
    ['[2001:DB8::1]', '[2001:db8::1]'],
    ['192.0.2.1', '192.0.2.1'],
    ['0xC0.0.2.1', '192.0.2.1'],
  ])('reads %s as %s', (written, host) => {
    expect(normalizeHost(written)).toBe(host);
  });

  it.each(['', 'a b.example', 'user@example.com', 'example.com:8443', 'example.com/path', '/x'])(
    'reads %j as no host',
    (written) => {
      expect(normalizeHost(written)).toBeNull();
    },
  );

  it('reads a URL’s own host, whatever its port and path', () => {
    expect(normalizeHostOf(new URL('https://API.Example.com.:8443/a?b=c'))).toBe('api.example.com');
  });
});

describe('hostIsListed', () => {
  const list = ['hooks.slack.com', 'api.example.com'];

  it.each([
    'hooks.slack.com',
    'HOOKS.SLACK.COM',
    'hooks.slack.com.',
    'hooks%2Eslack%2Ecom',
    'api.example.com',
  ])('finds %s', (host) => {
    expect(hostIsListed(host, list)).toBe(true);
  });

  it.each([
    'hooks.slack.com.evil.example',
    'evilhooks.slack.com',
    'slack.com',
    'hooks.slack.co',
    'hooks.slack.com@evil.example',
    'xn--hoks-qqa.slack.com',
  ])('refuses %s', (host) => {
    expect(hostIsListed(host, list)).toBe(false);
  });

  it('normalises the list too, so a stored entry compares as a host', () => {
    expect(hostIsListed('api.example.com', ['API.EXAMPLE.COM.'])).toBe(true);
  });
});
