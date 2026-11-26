/**
 * C250.3 (Phase 9 C175.2, V13; Phase 11, Workflow 11B, platform-ops): with
 * `OPENVERIFY_INTERNAL_LISTEN` set, the `/api/v1/internal/*` routes answer only on a second
 * listener at that address, which answers nothing else, and the public listener answers them with
 * its generic 404; unset, they stay on the public listener (behind the flow server's token) with a
 * production warning. The OpenAPI document never lists them. Every value is synthetic.
 */
import { createServer } from 'node:net';
import { setDefaultKeyring } from '@openverify/db';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../config.js';
import type { Container } from '../container.js';
import { startServer, type RunningServer } from '../server.js';
import { createRecordingQueue } from '../test-support/fakes.js';
import { syntheticEnv } from '../test-support/env.js';
import { registerInternalRoutes, startInternalListener } from './internal-listener.js';

const INQUIRY = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const servers: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  setDefaultKeyring(undefined);
});

/** A loopback port free a moment ago. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function serverWith(env: Record<string, string>): Promise<RunningServer> {
  const server = await startServer({
    env: syntheticEnv(env),
    overrides: {
      verificationQueue: { ...createRecordingQueue(), close: () => Promise.resolve() },
      webhookDeliveries: {
        scheduleDelivery: () => Promise.resolve(),
        close: () => Promise.resolve(),
      },
    },
  });
  servers.push(server);
  return server;
}

const problemOf = async (response: Response) => {
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, type: body.type, title: body.title, detail: body.detail };
};

describe('OPENVERIFY_INTERNAL_LISTEN set (C250.3)', () => {
  it('serves the internal routes only on the internal listener, and the public one answers its generic 404', async () => {
    const port = await freePort();
    const server = await serverWith({ OPENVERIFY_INTERNAL_LISTEN: `127.0.0.1:${String(port)}` });
    const internal = `http://127.0.0.1:${String(port)}`;
    const path = `/api/v1/internal/embed-policies/${INQUIRY}`;

    const onPublic = await fetch(`${server.url}${path}`);
    const unknown = await fetch(`${server.url}/api/v1/internals/${INQUIRY}`);
    // The route is there: without the flow server's token it refuses before any lookup.
    const onInternal = await fetch(`${internal}${path}`);

    expect(await problemOf(onPublic)).toEqual({
      status: 404,
      type: 'about:blank',
      title: 'Not Found',
      detail: `No route matches GET ${path}.`,
    });
    expect((await problemOf(unknown)).status).toBe(404);
    expect(onInternal.status).toBe(401);
  });

  it('answers nothing but the internal routes on the internal listener', async () => {
    const port = await freePort();
    await serverWith({ OPENVERIFY_INTERNAL_LISTEN: `127.0.0.1:${String(port)}` });

    for (const path of ['/health', '/openapi.json', '/api/v1/inquiries']) {
      const response = await fetch(`http://127.0.0.1:${String(port)}${path}`);
      expect(response.status, path).toBe(404);
    }
  });

  it('closes the internal listener with the server', async () => {
    const port = await freePort();
    const server = await serverWith({ OPENVERIFY_INTERNAL_LISTEN: `127.0.0.1:${String(port)}` });

    await server.close();

    await expect(fetch(`http://127.0.0.1:${String(port)}/api/v1/internal/x`)).rejects.toThrow();
  });

  it('keeps the internal routes out of the OpenAPI document, set or unset', async () => {
    const port = await freePort();
    for (const env of [{ OPENVERIFY_INTERNAL_LISTEN: `127.0.0.1:${String(port)}` }, {}]) {
      const server = await serverWith(env);
      const document = (await (await fetch(`${server.url}/openapi.json`)).json()) as {
        paths: Record<string, unknown>;
      };
      expect(Object.keys(document.paths).filter((path) => path.includes('/internal'))).toEqual([]);
      await server.close();
    }
  });
});

describe('OPENVERIFY_INTERNAL_LISTEN unset (C250.3)', () => {
  it('keeps the internal routes on the public listener, as before', async () => {
    const server = await serverWith({});

    const response = await fetch(`${server.url}/api/v1/internal/embed-policies/${INQUIRY}`);

    expect(response.status).toBe(401);
  });

  it('registers them on the app it is given', async () => {
    const app = Fastify();
    registerInternalRoutes(app, {
      internalListen: null,
      register: (scope) => {
        scope.get('/api/v1/internal/ping', () => ({ ok: true }));
      },
    });

    expect((await app.inject({ method: 'GET', url: '/api/v1/internal/ping' })).statusCode).toBe(
      200,
    );
    await app.close();
  });

  it('starts no listener, and warns in production mode only', async () => {
    const buildApp = vi.fn();
    const container = { buildApp } as unknown as Container;
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn, error: vi.fn() };

    for (const mode of ['production', 'development'] as const) {
      await expect(
        startInternalListener({
          config: { internalListen: null, mode } as ApiConfig,
          container,
          logger,
        }),
      ).resolves.toBeNull();
    }

    expect(warn.mock.calls).toEqual([
      [
        { event: 'internal_listen_unset' },
        'the /api/v1/internal routes answer on the public listener, behind the flow server token ' +
          'only; set OPENVERIFY_INTERNAL_LISTEN to serve them on a listener of their own',
      ],
    ]);
    expect(buildApp).not.toHaveBeenCalled();
  });
});
