/**
 * Workflow 11F (fix-records' Validation): `readiness.integration.test.ts`'s afterAll met its 180 s
 * hook guard in API integration shard 2 of 3 at a load of 16.8, after the test had stopped its
 * Postgres container. A pg client waiting on a peer that never answers (a connect the port forwarder
 * accepted, or a socket whose close never arrived) keeps `pool.end()` waiting for ever, because a
 * plain pool has no connection or query timeout. Here the peer is a loopback server that accepts
 * and never answers, so the case is deterministic and needs no Docker.
 */
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { storePool } from './store-pool.js';

let silent: Server | undefined;
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  const server = silent;
  silent = undefined;
  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
});

async function silentPeer(): Promise<number> {
  const server = createServer((socket) => {
    sockets.push(socket);
  });
  silent = server;
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

const within = <T>(promise: Promise<T>, ms: number): Promise<T | 'still waiting'> =>
  Promise.race([
    promise,
    new Promise<'still waiting'>((resolve) => {
      setTimeout(() => {
        resolve('still waiting');
      }, ms);
    }),
  ]);

describe('storePool (the readiness integration test, C250.1)', () => {
  it('ends within 5 s while a query waits on a peer that never answers', async () => {
    const port = await silentPeer();
    const pool = storePool(`postgres://synthetic:synthetic@127.0.0.1:${String(port)}/synthetic`);
    const query = pool.query('select 1').then(
      () => 'answered',
      () => 'refused',
    );
    await within(query, 500);

    expect(
      await within(
        pool.end().then(() => 'ended'),
        5_000,
      ),
    ).toBe('ended');
    expect(await within(query, 1_000)).toBe('refused');
  });
});
