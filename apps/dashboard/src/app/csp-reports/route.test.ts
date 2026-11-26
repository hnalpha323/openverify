// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markPeerAddressHeaderTrusted, PEER_ADDRESS_HEADER } from '../../lib/api/peer-address';
import { fakeRequest } from '../../testing/fake-request';
import { POST } from './route';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

beforeEach(() => {
  fakeRequest.reset();
  markPeerAddressHeaderTrusted();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function report(directive: string): Request {
  return new Request('http://dashboard.test/csp-reports', {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report' },
    body: JSON.stringify({
      'csp-report': {
        'document-uri': 'http://dashboard.test/users?filter[email]=someone@example.com',
        'effective-directive': directive,
        'blocked-uri': 'https://evil.example.org/x.js?q=1',
      },
    }),
  });
}

describe('POST /csp-reports', () => {
  it('writes one warn line per violation with the directive and the blocked origin only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fakeRequest.headers.set(PEER_ADDRESS_HEADER, '192.0.2.10');

    const response = await POST(report('script-src-elem'));

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const line: unknown = warn.mock.calls[0]?.[0];
    expect(JSON.parse(String(line))).toEqual({
      level: 'warn',
      msg: 'csp-violation',
      'effective-directive': 'script-src-elem',
      'blocked-origin': 'https://evil.example.org',
    });
    expect(String(line)).not.toContain('someone@example.com');
  });

  it("limits each client address taken through the console's own helpers, never X-Forwarded-For", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fakeRequest.headers.set(PEER_ADDRESS_HEADER, '192.0.2.11');
    for (let index = 0; index < 60; index += 1) {
      fakeRequest.headers.set('x-forwarded-for', `198.51.100.${String(index)}`);
      expect((await POST(report('img-src'))).status).toBe(204);
    }

    expect((await POST(report('img-src'))).status).toBe(429);
    fakeRequest.headers.set(PEER_ADDRESS_HEADER, '192.0.2.12');
    expect((await POST(report('img-src'))).status).toBe(204);
  });
});
