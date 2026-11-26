/**
 * C146.2: the HTTPS guard against a local resolver returning private and mixed answers, through the
 * pool the action reads. A local server stands behind the names: only `allowPlainHttp`, which no
 * production path sets, reaches it, so a refusal here is the guard's. No container is needed, and
 * nothing leaves loopback.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOutboundHttp, type OutboundHttp } from '../../../http/index.js';
import { createHttpsClientPool, type HttpsNetworkPolicy } from './client-pool.js';

let server: Server;
let port = 0;
let hits = 0;
let answers: { address: string; family: number }[] = [];
let http: OutboundHttp;

beforeAll(async () => {
  server = createServer((_request, response) => {
    hits += 1;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  http = createOutboundHttp({ resolve: () => Promise.resolve(answers) });
});

beforeEach(() => {
  hits = 0;
});

afterAll(async () => {
  await http.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const policy = (more: Partial<HttpsNetworkPolicy> = {}): HttpsNetworkPolicy => ({
  ports: [port],
  allowLoopback: false,
  allowCidrs: [],
  nat64Prefixes: [],
  ...more,
});

const call = (networkPolicy: HttpsNetworkPolicy) => {
  const pool = createHttpsClientPool(http, { allowPlainHttp: true });
  return pool
    .clientFor('env_a', networkPolicy)
    .request({ method: 'GET', url: `http://hook.example.test:${String(port)}/x` });
};

const IPV4 = 4;
const IPV6 = 6;

describe('the guard behind a resolver (C124.2, C146.2)', () => {
  it.each([
    ['private', [{ address: '10.0.0.1', family: IPV4 }]],
    ['loopback', [{ address: '127.0.0.1', family: IPV4 }]],
    ['link-local', [{ address: '169.254.0.1', family: IPV4 }]],
    ['metadata', [{ address: '169.254.169.254', family: IPV4 }]],
    ['EKS Pod Identity', [{ address: '169.254.170.23', family: IPV4 }]],
    ['mapped private', [{ address: '::ffff:10.0.0.1', family: IPV6 }]],
    ['well-known NAT64', [{ address: '64:ff9b::a00:1', family: IPV6 }]],
    [
      'a mixed answer',
      [
        { address: '203.0.113.9', family: IPV4 },
        { address: '10.0.0.1', family: IPV4 },
      ],
    ],
  ])('refuses %s, connecting nowhere', async (_name, resolved) => {
    answers = resolved;

    await expect(call(policy())).rejects.toMatchObject({ code: 'blocked' });
    expect(hits).toBe(0);
  });

  it('refuses a NAT64 network-specific prefix holding a private address', async () => {
    answers = [{ address: '2a00:db8:64::a00:1', family: IPV6 }];

    await expect(call(policy({ nat64Prefixes: ['2a00:db8:64::/96'] }))).rejects.toMatchObject({
      code: 'blocked',
    });
  });

  it('reaches a test receiver only through the policy that lifts loopback', async () => {
    answers = [{ address: '127.0.0.1', family: IPV4 }];

    await expect(call(policy({ allowLoopback: true }))).resolves.toMatchObject({ status: 200 });
    expect(hits).toBe(1);
  });

  it('answers dns for a name with no address', async () => {
    answers = [];

    await expect(call(policy())).rejects.toMatchObject({ code: 'dns' });
  });
});
