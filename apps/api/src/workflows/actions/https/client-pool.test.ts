/**
 * C124.2: one client per (environment id, network-policy hash), built lazily, so a kept-alive socket
 * is never shared across environments or policies. Two local connections prove the first, and a
 * settings change closing the old client the second. No test here leaves loopback.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOutboundHttp, type OutboundHttp } from '../../../http/index.js';
import { createHttpsClientPool, type HttpsNetworkPolicy } from './client-pool.js';

let server: Server;
let port = 0;
const sockets = new Set<Socket>();
const servedOn: Socket[] = [];
let http: OutboundHttp;

beforeAll(async () => {
  server = createServer((request, response) => {
    servedOn.push(request.socket);
    response.end();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  http = createOutboundHttp();
});

beforeEach(() => {
  servedOn.length = 0;
});

afterAll(async () => {
  await http.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const policy = (more: Partial<HttpsNetworkPolicy> = {}): HttpsNetworkPolicy => ({
  ports: [port],
  allowLoopback: true,
  allowCidrs: [],
  nat64Prefixes: [],
  ...more,
});

const pool = () => createHttpsClientPool(http, { allowPlainHttp: true });
const url = () => `http://127.0.0.1:${String(port)}/x`;

describe('the HTTPS client pool (C124.2)', () => {
  it('keeps one client for one environment and policy', async () => {
    const clients = pool();

    expect(clients.clientFor('env_a', policy())).toBe(clients.clientFor('env_a', policy()));
    await clients.close();
  });

  it('never reuses a connection pooled under environment A for environment B', async () => {
    const clients = pool();

    await clients.clientFor('env_a', policy()).request({ method: 'GET', url: url() });
    await clients.clientFor('env_b', policy()).request({ method: 'GET', url: url() });

    expect(servedOn).toHaveLength(2);
    expect(servedOn[0]).not.toBe(servedOn[1]);
    await clients.close();
  });

  it('closes the old client when the environment’s policy changes, and its socket with it', async () => {
    const clients = pool();
    await clients.clientFor('env_a', policy()).request({ method: 'GET', url: url() });
    const [first] = servedOn;
    const closed = new Promise<void>((resolve) =>
      first?.once('close', () => {
        resolve();
      }),
    );

    await clients
      .clientFor('env_a', policy({ allowCidrs: ['10.0.0.0/8'] }))
      .request({ method: 'GET', url: url() });
    await closed;

    expect(servedOn[1]).not.toBe(first);
    expect(first?.destroyed).toBe(true);
    await clients.close();
  });

  it('keeps a client when the list is the same in another order', () => {
    const clients = pool();

    const first = clients.clientFor('env_a', policy({ allowCidrs: ['10.0.0.0/8', '10.1.0.0/16'] }));
    const second = clients.clientFor(
      'env_a',
      policy({ allowCidrs: ['10.1.0.0/16', '10.0.0.0/8'] }),
    );

    expect(second).toBe(first);
    return clients.close();
  });

  it('enforces the policy of the environment it was built for', async () => {
    const clients = pool();

    await expect(
      clients
        .clientFor('env_a', policy({ allowLoopback: false }))
        .request({ method: 'GET', url: url() }),
    ).rejects.toMatchObject({ code: 'blocked' });
    await clients.close();
  });
});
