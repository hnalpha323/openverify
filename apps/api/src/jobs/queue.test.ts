import { describe, expect, it } from 'vitest';
import { createVerificationQueue } from './index.js';
import { createBullQueue } from './queue.js';

/** Never connects: `lazyConnect` defers the connection until the first command. */
const connection = { host: '127.0.0.1', port: 1, lazyConnect: true };

describe('createBullQueue', () => {
  it('builds a BullMQ queue with the prefix, without connecting until used', async () => {
    const queue = createBullQueue<{ id: string }>('unit-test', { connection, prefix: 'unit' });
    expect(queue).toMatchObject({
      name: 'unit-test',
      opts: expect.objectContaining({ prefix: 'unit' }) as unknown,
    });
    await queue.close();
  });

  it('passes no prefix when none is given, so BullMQ applies its default', async () => {
    const queue = createBullQueue('unit-test', { connection });
    expect((queue as unknown as { opts: object }).opts).not.toHaveProperty('prefix');
    await queue.close();
  });

  it('backs createVerificationQueue when given a connection', async () => {
    const queue = createVerificationQueue({ connection, prefix: 'unit' });
    await queue.close();
  });
});
