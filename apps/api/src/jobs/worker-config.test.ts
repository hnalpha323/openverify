import { describe, expect, it } from 'vitest';
import { WebhookNetworkConfigError } from '../webhooks/ssrf.js';
import { WorkerConfigError, workerSettingsFromEnv } from './worker-config.js';

describe('workerSettingsFromEnv', () => {
  it('defaults to four concurrent jobs per queue and private networks blocked', () => {
    expect(workerSettingsFromEnv({}, 'production')).toEqual({
      concurrency: 4,
      sweepIntervalMs: 30_000,
      webhookPolicy: { allowPrivateNetworks: false },
    });
  });

  it('reads the concurrency', () => {
    expect(
      workerSettingsFromEnv({ OPENVERIFY_WORKER_CONCURRENCY: ' 16 ' }, 'production').concurrency,
    ).toBe(16);
  });

  it.each(['0', '65', '2.5', 'many', '-1'])('rejects the concurrency %j', (value) => {
    expect(() =>
      workerSettingsFromEnv({ OPENVERIFY_WORKER_CONCURRENCY: value }, 'development'),
    ).toThrow(WorkerConfigError);
  });

  it('names the variable but never echoes its value', () => {
    try {
      workerSettingsFromEnv({ OPENVERIFY_WORKER_CONCURRENCY: 'secret-looking-value' }, 'test');
    } catch (error) {
      expect((error as Error).message).toContain('OPENVERIFY_WORKER_CONCURRENCY');
      expect((error as Error).message).not.toContain('secret-looking-value');
    }
    expect.assertions(2);
  });

  it('allows private webhook networks outside production only', () => {
    const env = { OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS: 'true' };
    expect(workerSettingsFromEnv(env, 'test').webhookPolicy).toEqual({
      allowPrivateNetworks: true,
    });
    expect(() => workerSettingsFromEnv(env, 'production')).toThrow(WebhookNetworkConfigError);
  });
});
