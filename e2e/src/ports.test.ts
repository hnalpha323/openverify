import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { freePorts } from './ports.js';

function listenOn(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve();
      });
    });
  });
}

describe('freePorts', () => {
  it('returns distinct loopback ports that can be listened on', async () => {
    const ports = await freePorts(6);

    expect(new Set(ports).size).toBe(6);
    for (const port of ports) {
      expect(port).toBeGreaterThan(1024);
      await expect(listenOn(port)).resolves.toBeUndefined();
    }
  });

  it('refuses a count below one', async () => {
    await expect(freePorts(0)).rejects.toThrow('count must be a positive integer');
  });
});
