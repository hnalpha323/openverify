// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  PEER_ADDRESS_HEADER,
  isPeerAddressHeaderTrusted,
  markPeerAddressHeaderTrusted,
  setPeerAddressHeader,
} from './peer-address';

const MARK = Symbol.for('openverify.dashboard.peer-address-header');

afterEach(() => {
  Reflect.deleteProperty(globalThis, MARK);
});

describe('PEER_ADDRESS_HEADER', () => {
  it('is the header the custom server sets from the socket', () => {
    expect(PEER_ADDRESS_HEADER).toBe('x-openverify-peer-ip');
  });
});

describe('setPeerAddressHeader', () => {
  it('sets the header from the socket address', () => {
    const headers: Record<string, string | string[] | undefined> = { host: 'dashboard.test' };

    setPeerAddressHeader(headers, '198.51.100.7');

    expect(headers).toEqual({ host: 'dashboard.test', 'x-openverify-peer-ip': '198.51.100.7' });
  });

  it.each([
    ['one value', '203.0.113.66'],
    ['several values', ['203.0.113.66', '203.0.113.67']],
  ])('overwrites a client-sent header (%s)', (_case, sent) => {
    const headers: Record<string, string | string[] | undefined> = {
      'x-openverify-peer-ip': sent,
    };

    setPeerAddressHeader(headers, '2001:db8::7');

    expect(headers['x-openverify-peer-ip']).toBe('2001:db8::7');
  });

  it('drops a client-sent header when the socket address is unknown', () => {
    const headers: Record<string, string | string[] | undefined> = {
      'x-openverify-peer-ip': '203.0.113.66',
    };

    setPeerAddressHeader(headers, undefined);

    expect(headers).not.toHaveProperty('x-openverify-peer-ip');
  });
});

describe('the trust mark', () => {
  it('is off until the custom server sets it, so a bare `next start` never believes the header', () => {
    expect(isPeerAddressHeaderTrusted()).toBe(false);

    markPeerAddressHeaderTrusted();

    expect(isPeerAddressHeaderTrusted()).toBe(true);
  });

  it('lives on a process-wide symbol, which only code in this process can set', () => {
    (globalThis as Record<symbol, unknown>)[MARK] = 'true';

    expect(isPeerAddressHeaderTrusted()).toBe(false);
  });
});
