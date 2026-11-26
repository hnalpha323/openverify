/**
 * C55.10, C63: the factory binds the sender a name says: `twilio` (with its credentials) or
 * `sandbox` (with the sink). Neither ever claims a send it did not make.
 */
import { describe, expect, it } from 'vitest';
import { SmsSendError } from '../../ports.js';
import { createInMemoryKeyValueCache, fixedClock } from '../../test-support/fakes.js';
import { createSmsSender } from './index.js';
import { readSandboxSmsSink } from './sandbox.js';

const MESSAGE = { to: '+12025550100', body: 'Synthetic body' };
const CONTEXT = { environmentId: 'env_factory', destinationIndex: 'c'.repeat(64), code: '000000' };

describe('createSmsSender (C55.10)', () => {
  it('binds the sandbox sender to the sink', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    const sender = createSmsSender('sandbox', { cache, clock });

    expect(sender.sandbox).toBe(true);
    if (!sender.sandbox) {
      throw new Error('expected the sandbox sender');
    }
    await sender.send(MESSAGE, CONTEXT);
    expect(
      await readSandboxSmsSink(cache, CONTEXT.environmentId, CONTEXT.destinationIndex),
    ).toEqual([{ code: '000000', sentAt: clock.now() }]);
  });

  it('binds the Twilio sender, which never sends without its outbound client', async () => {
    const sender = createSmsSender('twilio', {
      twilio: {
        accountSid: `AC${'0'.repeat(32)}`,
        apiKeySid: `SK${'1'.repeat(32)}`,
        apiKeySecret: 'change-me-synthetic-twilio-secret-0123456789',
        messagingServiceSid: `MG${'2'.repeat(32)}`,
        from: null,
      },
    });

    expect({ id: sender.id, sandbox: sender.sandbox }).toEqual({ id: 'twilio', sandbox: false });
    await expect(sender.send(MESSAGE, CONTEXT)).rejects.toBeInstanceOf(SmsSendError);
  });

  it('refuses to build the Twilio sender without its credentials', () => {
    expect(() => createSmsSender('twilio')).toThrow('twilio needs its credentials');
  });
});
