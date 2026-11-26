import { EventEmitter } from 'node:events';
import { setDefaultKeyring } from '@openverify/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import type { ContainerOverrides } from './container.js';
import { createProviderBindings } from './providers/index.js';
import {
  closeOnSignals,
  main,
  startServer,
  startupWarnings,
  type RunningServer,
} from './server.js';
import { createRecordingQueue } from './test-support/fakes.js';
import { syntheticEnv } from './test-support/env.js';

const servers: RunningServer[] = [];

function fakeQueues(): ContainerOverrides {
  return {
    verificationQueue: { ...createRecordingQueue(), close: () => Promise.resolve() },
    webhookDeliveries: {
      scheduleDelivery: () => Promise.resolve(),
      close: () => Promise.resolve(),
    },
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  setDefaultKeyring(undefined);
});

/** A stand-in for `process`: signals, exit code and stderr. */
function fakeProcess() {
  const emitter = new EventEmitter();
  const stderr: string[] = [];
  return Object.assign(emitter, {
    exitCode: undefined as number | undefined,
    stderr: {
      write: (chunk: string) => {
        stderr.push(chunk);
        return true;
      },
    },
    written: stderr,
  });
}

describe('startServer', () => {
  it('listens on the configured address and serves the API', async () => {
    const server = await startServer({ env: syntheticEnv(), overrides: fakeQueues() });
    servers.push(server);

    const response = await fetch(`${server.url}/health`);

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('stops listening and closes the container on close, once', async () => {
    const server = await startServer({ env: syntheticEnv(), overrides: fakeQueues() });

    await Promise.all([server.close(), server.close()]);

    expect(server.container.pool.ended).toBe(true);
    await expect(fetch(`${server.url}/health`)).rejects.toThrow();
  });

  it('closes the container when it cannot listen', async () => {
    const first = await startServer({ env: syntheticEnv(), overrides: fakeQueues() });
    servers.push(first);
    const port = new URL(first.url).port;

    await expect(
      startServer({ env: syntheticEnv({ OPENVERIFY_API_PORT: port }), overrides: fakeQueues() }),
    ).rejects.toThrow(/EADDRINUSE/);
  });
});

describe('closeOnSignals', () => {
  it.each(['SIGTERM', 'SIGINT'])('closes the server once on %s', async (signal) => {
    const process = fakeProcess();
    const close = vi.fn(() => Promise.resolve());

    closeOnSignals({ close }, process);
    process.emit(signal);
    process.emit(signal);
    await vi.waitFor(() => {
      expect(process.exitCode).toBe(0);
    });

    expect(close).toHaveBeenCalledOnce();
  });

  it('sets a failing exit code when closing fails', async () => {
    const process = fakeProcess();

    closeOnSignals({ close: () => Promise.reject(new Error('stuck')) }, process);
    process.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(process.exitCode).toBe(1);
    });

    expect(process.written.join('')).toContain('shutdown failed');
  });

  it('can be detached', () => {
    const process = fakeProcess();

    const detach = closeOnSignals({ close: () => Promise.resolve() }, process);
    detach();

    expect(process.listenerCount('SIGTERM')).toBe(0);
    expect(process.listenerCount('SIGINT')).toBe(0);
  });
});

describe('main', () => {
  it('reports an invalid configuration and exits with 1 without starting', async () => {
    const process = fakeProcess();

    const server = await main({ env: { DATABASE_URL: 'nope' }, process });

    expect(server).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(process.written.join('')).toContain('Invalid OpenVerify API configuration');
    expect(process.written.join('')).not.toContain('nope');
  });

  it('starts the server and closes it on SIGTERM', async () => {
    const process = fakeProcess();

    const server = await main({ env: syntheticEnv(), process, overrides: fakeQueues() });
    expect(server).toBeDefined();
    process.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(process.exitCode).toBe(0);
    });

    expect(server?.container.pool.ended).toBe(true);
  });

  it('reports any other startup failure with its cause', async () => {
    const process = fakeProcess();
    const env = syntheticEnv();
    const server = await startServer({ env, overrides: fakeQueues() });
    servers.push(server);

    const second = await main({
      env: { ...env, OPENVERIFY_API_PORT: new URL(server.url).port },
      process,
      overrides: fakeQueues(),
    });

    expect(second).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(process.written.join('')).toContain('OpenVerify API failed to start');
    expect(process.written.join('')).toContain('EADDRINUSE');
  });
});

describe('startupWarnings (C55.7)', () => {
  const config = (env: NodeJS.ProcessEnv) => loadConfig(syntheticEnv(env));
  const bindings = (sms: boolean) =>
    createProviderBindings({ sandbox: sms ? { sms: 'sandbox' } : {}, production: {} });

  it('warns once that per-IP OTP limits key on the proxy address with an SMS sender and no proxy trust', () => {
    expect(startupWarnings(config({}), bindings(true))).toEqual([
      'An SMS sender is bound while OPENVERIFY_TRUST_PROXY is false: the per-IP OTP limits ' +
        '(otp-ip-hour) key on the address of the proxy in front of the API, if any.',
    ]);
  });

  it('says nothing without an SMS sender or with proxy trust set', () => {
    expect(startupWarnings(config({}), bindings(false))).toEqual([]);
    expect(startupWarnings(config({ OPENVERIFY_TRUST_PROXY: '1' }), bindings(true))).toEqual([]);
  });
});
