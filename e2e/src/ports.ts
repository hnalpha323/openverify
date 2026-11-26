import { createServer, type Server } from 'node:net';

function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address !== null && typeof address === 'object') {
        resolve(address.port);
      } else {
        reject(new Error('No port was assigned'));
      }
    });
  });
}

/**
 * `count` distinct free TCP ports on `host`. Every port is held until all are allocated, so
 * none repeats; another process can still take one before it is used, which is unlikely in
 * the short window before the e2e stack binds them.
 */
export async function freePorts(count: number, host = '127.0.0.1'): Promise<number[]> {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('count must be a positive integer');
  }
  const servers: Server[] = [];
  try {
    const ports: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const server = createServer();
      servers.push(server);
      ports.push(await listen(server, host));
    }
    return ports;
  } finally {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve) => {
            server.close(() => {
              resolve(undefined);
            });
          }),
      ),
    );
  }
}
