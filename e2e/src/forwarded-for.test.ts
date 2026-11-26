import { describe, expect, it } from 'vitest';
import { FORWARDED_FOR_HEADER, withForwardedFor } from './forwarded-for.js';

describe('withForwardedFor (C93.6, F34)', () => {
  it('adds X-Forwarded-For and changes no other header', () => {
    const headers = { accept: 'application/json', 'x-openverify-session': 'ovs_synthetic' };

    expect(withForwardedFor(headers, '192.0.2.10')).toEqual({
      ...headers,
      'x-forwarded-for': '192.0.2.10',
    });
    expect(FORWARDED_FOR_HEADER).toBe('x-forwarded-for');
  });

  it('replaces a header the page sent under any case, so one address reaches the API', () => {
    expect(withForwardedFor({ 'X-Forwarded-For': '198.51.100.9' }, '203.0.113.7')).toEqual({
      'x-forwarded-for': '203.0.113.7',
    });
  });

  it('takes only the documentation ranges the sandbox network answers for (C111.1)', () => {
    for (const address of ['192.0.2.20', '198.51.100.1', '203.0.113.200', '2001:db8::1']) {
      expect(withForwardedFor({}, address)[FORWARDED_FOR_HEADER], address).toBe(address);
    }
    for (const address of ['8.8.8.8', '10.0.0.1', '127.0.0.1', '2001:4860::1', 'not an address']) {
      expect(() => withForwardedFor({}, address), address).toThrow(
        'a spec presents only documentation addresses',
      );
    }
  });
});
