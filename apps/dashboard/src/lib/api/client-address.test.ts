// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeRequest } from '../../testing/fake-request';
import { clientAddressOf, normalizeAddress, requestClientAddress } from './client-address';
import { markPeerAddressHeaderTrusted } from './peer-address';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const MARK = Symbol.for('openverify.dashboard.peer-address-header');

const headers = (values: Record<string, string>) => new Headers(values);
const peerOnly = { trustedProxyHops: 0, peerHeaderTrusted: true } as const;
const hops = (trustedProxyHops: number) => ({ trustedProxyHops, peerHeaderTrusted: true });

describe('normalizeAddress', () => {
  it.each([
    ['198.51.100.7', '198.51.100.7'],
    [' 198.51.100.7 ', '198.51.100.7'],
    ['2001:db8::7', '2001:db8::7'],
    ['::1', '::1'],
    // A dual-stack socket reports IPv4 clients as IPv4-mapped IPv6.
    ['::ffff:198.51.100.7', '198.51.100.7'],
    ['::FFFF:127.0.0.1', '127.0.0.1'],
  ])('keeps the IP literal %j as %j', (value, address) => {
    expect(normalizeAddress(value)).toBe(address);
  });

  it.each([
    null,
    undefined,
    '',
    'unknown',
    'dashboard.example.test',
    '198.51.100.7:4711',
    '[2001:db8::7]',
    '[2001:db8::7]:443',
    '198.51.100.256',
    '198.51.100.7, 203.0.113.9',
  ])('refuses %j, which is not one IP literal', (value) => {
    expect(normalizeAddress(value)).toBeNull();
  });
});

describe('clientAddressOf with no trusted proxy (OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS=0)', () => {
  it('is the socket peer the custom server recorded', () => {
    expect(clientAddressOf(headers({ 'x-openverify-peer-ip': '198.51.100.7' }), peerOnly)).toBe(
      '198.51.100.7',
    );
    expect(clientAddressOf(headers({ 'x-openverify-peer-ip': '2001:db8::7' }), peerOnly)).toBe(
      '2001:db8::7',
    );
  });

  it('never takes a client-chosen X-Forwarded-For (spoofing)', () => {
    const spoofed = headers({
      'x-forwarded-for': '203.0.113.66',
      'x-openverify-peer-ip': '198.51.100.7',
    });

    expect(clientAddressOf(spoofed, peerOnly)).toBe('198.51.100.7');
    expect(clientAddressOf(headers({ 'x-forwarded-for': '203.0.113.66' }), peerOnly)).toBeNull();
  });

  it('is unknown when the server was not started through server.ts, even if a client sent the header', () => {
    const forged = headers({ 'x-openverify-peer-ip': '203.0.113.66' });

    expect(clientAddressOf(forged, { trustedProxyHops: 0, peerHeaderTrusted: false })).toBeNull();
  });

  it('is unknown for a malformed peer value', () => {
    expect(clientAddressOf(headers({ 'x-openverify-peer-ip': 'garbage' }), peerOnly)).toBeNull();
  });
});

describe('clientAddressOf behind N trusted proxies', () => {
  it('is the Nth X-Forwarded-For entry from the right', () => {
    // client -> proxy A (appends the client) -> proxy B (appends A) -> dashboard
    const chain = headers({
      'x-forwarded-for': '198.51.100.7, 10.0.0.2',
      'x-openverify-peer-ip': '10.0.0.3',
    });

    expect(clientAddressOf(chain, hops(1))).toBe('10.0.0.2');
    expect(clientAddressOf(chain, hops(2))).toBe('198.51.100.7');
  });

  it('ignores whatever a client prepended: only the trusted hops count (spoofing)', () => {
    const spoofed = headers({ 'x-forwarded-for': '203.0.113.66, 203.0.113.67, 198.51.100.7' });

    expect(clientAddressOf(spoofed, hops(1))).toBe('198.51.100.7');
  });

  it('reads IPv6 entries', () => {
    expect(
      clientAddressOf(headers({ 'x-forwarded-for': '2001:db8::7,2001:db8::1' }), hops(2)),
    ).toBe('2001:db8::7');
  });

  it.each([
    ['a chain shorter than the hop count', '198.51.100.7', 2],
    ['no chain at all', undefined, 1],
    ['an empty chain', '', 1],
    ['an empty entry at the hop', '198.51.100.7, , 10.0.0.2', 2],
    ['an entry that is not an IP', '198.51.100.7, proxy.internal', 1],
    ['an entry with a port', '198.51.100.7:4711, 10.0.0.2', 2],
  ])('is unknown for %s', (_case, chain, count) => {
    const values: Record<string, string> = { 'x-openverify-peer-ip': '10.0.0.3' };
    if (chain !== undefined) {
      values['x-forwarded-for'] = chain;
    }

    expect(clientAddressOf(headers(values), hops(count))).toBeNull();
  });
});

describe('requestClientAddress', () => {
  beforeEach(() => {
    fakeRequest.reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Reflect.deleteProperty(globalThis, MARK);
  });

  it("derives the address from this request's headers and the deployment's hop count", async () => {
    markPeerAddressHeaderTrusted();
    fakeRequest.headers.set('x-openverify-peer-ip', '::ffff:198.51.100.7');
    fakeRequest.headers.set('x-forwarded-for', '203.0.113.66');

    await expect(requestClientAddress()).resolves.toBe('198.51.100.7');

    vi.stubEnv('OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS', '1');
    await expect(requestClientAddress()).resolves.toBe('203.0.113.66');
  });

  it('is unknown outside the custom server', async () => {
    fakeRequest.headers.set('x-openverify-peer-ip', '198.51.100.7');

    await expect(requestClientAddress()).resolves.toBeNull();
  });
});
