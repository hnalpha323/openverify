/**
 * C250.3 (Phase 9 C175.2, V13): with `OPENVERIFY_INTERNAL_LISTEN` (`host:port`) set, the
 * `/api/v1/internal/*` routes (Phase 9's flow-server embed-policy route and any later internal
 * route) are registered only on a second Fastify listener at that address, and the public
 * listener answers the generic 404 for them; unset, today's behaviour stays (the flow-server token
 * of C157.2 protects them) with a production warning. The OpenAPI document never lists them.
 *
 * `buildApp` registers the internal routes through `registerInternalRoutes`, and `startServer`
 * calls `startInternalListener` after the public listener is up and closes what it answers first
 * (foundation-11b's hooks; built by platform-ops, Workflow 11B). The internal app is a second app
 * from the same container: the same error handling, problem answers, logging and rate limits.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type { ApiConfig } from '../config.js';
import type { Container } from '../container.js';
import { createWorkerLogger, type WorkerLogger } from '../jobs/logger.js';

/** `OPENVERIFY_INTERNAL_LISTEN`, parsed. */
export interface InternalListen {
  readonly host: string;
  readonly port: number;
}

export interface RegisterInternalRoutesOptions {
  /** `null` when the variable is unset. */
  readonly internalListen: InternalListen | null;
  /** Registers every internal route on `scope` under `/api/v1/internal`. */
  readonly register: (scope: FastifyInstance) => void;
}

/** The internal routes' prefix; nothing else answers on the internal listener. */
export const INTERNAL_ROUTE_PREFIX = '/api/v1/internal/';

/**
 * Set only while `startInternalListener` builds its own app, which `registerInternalRoutes` then
 * fills: `buildApp` registers synchronously, so the flag covers that one build and no other.
 */
let buildingInternalApp = false;

/**
 * Where the internal routes go: on the app it is given while `internalListen` is unset (today's
 * behaviour, behind the flow server token); on the internal listener's app only, once it is set,
 * so the public app answers them with its generic 404. The internal app answers every other path
 * with that same 404.
 */
export function registerInternalRoutes(
  app: FastifyInstance,
  options: RegisterInternalRoutesOptions,
): void {
  if (options.internalListen === null) {
    options.register(app);
    return;
  }
  if (!buildingInternalApp) {
    return;
  }
  // Every other route of this app moves under a prefix made for this build, which no request can
  // name, so the internal listener answers it with the app's own generic 404 (its plugins load at
  // ready, after this hook, and so pass through it).
  const unreachable = `/${randomUUID()}`;
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith(INTERNAL_ROUTE_PREFIX)) {
      route.url = `${unreachable}${route.url}`;
    }
  });
  options.register(app);
}

/** A second listener serving only the internal routes. */
export interface InternalListener {
  /** Its base URL, e.g. `http://127.0.0.1:3101`. */
  readonly url: string;
  close(): Promise<void>;
}

export interface StartInternalListenerOptions {
  readonly config: ApiConfig;
  readonly container: Container;
  /** Where the production warning goes; the API's process logger by default. */
  readonly logger?: WorkerLogger;
}

/** Starts the internal listener when `config.internalListen` is set; `null` otherwise. */
/**
 * Starts the internal listener when `config.internalListen` is set: an app of its own, built by the
 * container, listening on that address and serving only the internal routes; `null` otherwise,
 * with a warning in production mode.
 */
export async function startInternalListener(
  options: StartInternalListenerOptions,
): Promise<InternalListener | null> {
  const { config, container } = options;
  const listen = config.internalListen;
  if (listen === null) {
    if (config.mode === 'production') {
      const logger = options.logger ?? createWorkerLogger({ name: 'openverify-api' });
      logger.warn(
        { event: 'internal_listen_unset' },
        'the /api/v1/internal routes answer on the public listener, behind the flow server token ' +
          'only; set OPENVERIFY_INTERNAL_LISTEN to serve them on a listener of their own',
      );
    }
    return null;
  }
  buildingInternalApp = true;
  let app: ReturnType<Container['buildApp']>;
  try {
    app = container.buildApp();
  } finally {
    buildingInternalApp = false;
  }
  try {
    await app.listen({ host: listen.host, port: listen.port });
  } catch (error) {
    await app.close();
    throw error;
  }
  const { port } = app.server.address() as AddressInfo;
  const host = listen.host.includes(':') ? `[${listen.host}]` : listen.host;
  return {
    url: `http://${host}:${String(port)}`,
    close: () => app.close(),
  };
}
