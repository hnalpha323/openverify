/**
 * C55.10, C55.11: the sandbox SMS sender sends nothing and keeps each code in its environment's
 * sink, under the number's blind index only, newest first, at most 100 for 15 minutes; the search
 * reads one number's codes back. The number never reaches the sink. Every value is synthetic.
 */
import { SANDBOX_SMS_SINK } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { SmsSendError } from '../../ports.js';
import { createInMemoryKeyValueCache, fixedClock } from '../../test-support/fakes.js';
import { createSandboxSmsSender, readSandboxSmsSink, sandboxSmsSinkKey } from './sandbox.js';

const NUMBER = '+12025550100';
const INDEX = 'a'.repeat(64);
const OTHER_INDEX = 'b'.repeat(64);
const message = { to: NUMBER, body: `Synthetic: 123456 is your code.` };

function setup() {
  const clock = fixedClock();
  const cache = createInMemoryKeyValueCache(clock);
  return { clock, cache, sender: createSandboxSmsSender({ cache, clock }) };
}

describe('the sandbox SMS sender (C55.10)', () => {
  it('is the sandbox provider and keeps the code for its environment and destination index', async () => {
    const { clock, cache, sender } = setup();

    const result = await sender.send(message, {
      environmentId: 'env_sink_a',
      destinationIndex: INDEX,
      code: '123456',
    });

    expect({ id: sender.id, sandbox: sender.sandbox }).toEqual({ id: 'sandbox', sandbox: true });
    expect(result).toEqual({});
    expect(await readSandboxSmsSink(cache, 'env_sink_a', INDEX)).toEqual([
      { code: '123456', sentAt: clock.now() },
    ]);
    expect(await readSandboxSmsSink(cache, 'env_sink_a', OTHER_INDEX)).toEqual([]);
    expect(await readSandboxSmsSink(cache, 'env_sink_b', INDEX)).toEqual([]);
  });

  it('answers newest first and never keeps the number', async () => {
    const { clock, cache, sender } = setup();
    const first = clock.now();
    await sender.send(message, {
      environmentId: 'env_sink_c',
      destinationIndex: INDEX,
      code: '111111',
    });
    clock.advance(30_000);
    await sender.send(message, {
      environmentId: 'env_sink_c',
      destinationIndex: INDEX,
      code: '222222',
    });

    expect(await readSandboxSmsSink(cache, 'env_sink_c', INDEX)).toEqual([
      { code: '222222', sentAt: clock.now() },
      { code: '111111', sentAt: first },
    ]);
    expect(cache.keys()).toEqual([sandboxSmsSinkKey('env_sink_c')]);
    const stored = await cache.listRange(sandboxSmsSinkKey('env_sink_c'), 10);
    expect(stored.join('\n')).not.toContain(NUMBER.slice(1));
  });

  it('keeps at most 100 codes, for 15 minutes', async () => {
    const { clock, cache, sender } = setup();
    for (let send = 0; send < SANDBOX_SMS_SINK.maxEntries + 5; send += 1) {
      await sender.send(message, {
        environmentId: 'env_sink_d',
        destinationIndex: INDEX,
        code: String(100_000 + send),
      });
    }

    const kept = await readSandboxSmsSink(cache, 'env_sink_d', INDEX);
    expect(kept).toHaveLength(SANDBOX_SMS_SINK.maxEntries);
    expect(kept[0]?.code).toBe(String(100_000 + SANDBOX_SMS_SINK.maxEntries + 4));
    clock.advance(SANDBOX_SMS_SINK.ttlSeconds * 1000);
    expect(await readSandboxSmsSink(cache, 'env_sink_d', INDEX)).toEqual([]);
  });

  it('skips an entry it cannot read', async () => {
    const { clock, cache } = setup();
    const key = sandboxSmsSinkKey('env_sink_e');
    await cache.pushCapped(key, 'not json', 100, 900);
    await cache.pushCapped(
      key,
      JSON.stringify({ 'destination-index': INDEX, code: 'x' }),
      100,
      900,
    );
    await cache.pushCapped(
      key,
      JSON.stringify({
        'destination-index': INDEX,
        code: '654321',
        'sent-at': clock.now().toISOString(),
      }),
      100,
      900,
    );

    expect(await readSandboxSmsSink(cache, 'env_sink_e', INDEX)).toEqual([
      { code: '654321', sentAt: clock.now() },
    ]);
  });

  it('refuses to claim a send it could not record, without the number or code in the error', async () => {
    const { cache, sender } = setup();
    const unbound = createSandboxSmsSender({});
    cache.failNext(new Error('Valkey is unavailable (reconnecting)'));

    const down = await sender
      .send(message, { environmentId: 'env_sink_f', destinationIndex: INDEX, code: '123456' })
      .catch((error: unknown) => error);
    const missing = await unbound
      .send(message, { environmentId: 'env_sink_f', destinationIndex: INDEX, code: '123456' })
      .catch((error: unknown) => error);

    expect(down).toBeInstanceOf(SmsSendError);
    expect(down).toMatchObject({ code: 'sandbox_sink_unavailable', retryable: true });
    expect(missing).toMatchObject({ code: 'sandbox_sink_unavailable', retryable: false });
    expect((down as Error).message).not.toMatch(/123456|2025550100/u);
  });
});
