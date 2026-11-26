import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  BFF_CLIENT_IP_HEADER,
  BFF_TOKEN_HEADER,
  createClientAddressResolver,
} from './client-address.js';

// Synthetic values only.
const BFF_TOKEN = 'synthetic-bff-token-0123456789abcdef-0123';
const SOCKET_PEER = '10.0.0.5';
const OPERATOR = '203.0.113.77';

function request(headers: Record<string, string | string[]>, ip = SOCKET_PEER): FastifyRequest {
  return { ip, headers } as unknown as FastifyRequest;
}

describe('createClientAddressResolver', () => {
  it('names the headers the dashboard BFF sends (C15)', () => {
    expect(BFF_CLIENT_IP_HEADER).toBe('x-openverify-client-ip');
    expect(BFF_TOKEN_HEADER).toBe('x-openverify-bff-token');
  });

  it("uses the BFF's client address when the BFF token matches", () => {
    const clientAddress = createClientAddressResolver(BFF_TOKEN);

    expect(
      clientAddress(request({ [BFF_CLIENT_IP_HEADER]: OPERATOR, [BFF_TOKEN_HEADER]: BFF_TOKEN })),
    ).toBe(OPERATOR);
    expect(
      clientAddress(
        request({ [BFF_CLIENT_IP_HEADER]: '2001:db8::7', [BFF_TOKEN_HEADER]: BFF_TOKEN }),
      ),
    ).toBe('2001:db8::7');
  });

  it('ignores the client address header without the token, with a wrong token, or with a token of another length', () => {
    const clientAddress = createClientAddressResolver(BFF_TOKEN);

    expect(clientAddress(request({ [BFF_CLIENT_IP_HEADER]: OPERATOR }))).toBe(SOCKET_PEER);
    expect(
      clientAddress(
        request({
          [BFF_CLIENT_IP_HEADER]: OPERATOR,
          [BFF_TOKEN_HEADER]: `${BFF_TOKEN.slice(0, -1)}x`,
        }),
      ),
    ).toBe(SOCKET_PEER);
    expect(
      clientAddress(request({ [BFF_CLIENT_IP_HEADER]: OPERATOR, [BFF_TOKEN_HEADER]: 'short' })),
    ).toBe(SOCKET_PEER);
  });

  it('never trusts the header when no BFF token is configured', () => {
    const clientAddress = createClientAddressResolver(undefined);

    expect(
      clientAddress(request({ [BFF_CLIENT_IP_HEADER]: OPERATOR, [BFF_TOKEN_HEADER]: '' })),
    ).toBe(SOCKET_PEER);
    expect(
      clientAddress(request({ [BFF_CLIENT_IP_HEADER]: OPERATOR, [BFF_TOKEN_HEADER]: BFF_TOKEN })),
    ).toBe(SOCKET_PEER);
  });

  it('refuses a client address that is not an IP address, or repeated headers', () => {
    const clientAddress = createClientAddressResolver(BFF_TOKEN);

    for (const value of ['not-an-ip', '203.0.113.1, 198.51.100.2', '', ' 203.0.113.1']) {
      expect(
        clientAddress(request({ [BFF_CLIENT_IP_HEADER]: value, [BFF_TOKEN_HEADER]: BFF_TOKEN })),
        value,
      ).toBe(SOCKET_PEER);
    }
    expect(
      clientAddress(
        request({ [BFF_CLIENT_IP_HEADER]: [OPERATOR, OPERATOR], [BFF_TOKEN_HEADER]: BFF_TOKEN }),
      ),
    ).toBe(SOCKET_PEER);
    expect(
      clientAddress(
        request({ [BFF_CLIENT_IP_HEADER]: OPERATOR, [BFF_TOKEN_HEADER]: [BFF_TOKEN, BFF_TOKEN] }),
      ),
    ).toBe(SOCKET_PEER);
  });
});
