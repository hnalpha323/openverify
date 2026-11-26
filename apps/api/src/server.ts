/**
 * The HTTP API process (`pnpm --filter @openverify/api dev:server`, or `node dist/server.js`).
 * It reads the configuration from the environment, builds the container, listens, and on
 * SIGTERM or SIGINT stops accepting connections, finishes in-flight requests and closes the
 * database pool, the storage client and the queues before exiting.
 */
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { ConfigError, loadConfig, type ApiConfig } from './config.js';
import { logStartupWarnings } from './config/startup-warnings.js';
import { startInternalListener, type InternalListener } from './http/internal-listener.js';
import {
  createContainer,
  type ApiApp,
  type Container,
  type ContainerOverrides,
} from './container.js';
import type { ProviderBindings } from './ports.js';

export interface StartServerOptions {
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  overrides?: ContainerOverrides;
}

export interface RunningServer {
  app: ApiApp;
  container: Container;
  /** Base URL of the listening socket, e.g. `http://127.0.0.1:3000`. */
  url: string;
  /** Stops the server and closes the container; later calls wait for the first. */
  close(): Promise<void>;
}

/** The parts of `process` the entrypoint uses, so tests can pass a stand-in. */
export interface ProcessLike {
  once(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  off(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  exitCode?: number | string | null | undefined;
  stderr: { write(chunk: string): unknown };
}

/**
 * What the API warns about once at startup, never naming a value:
 * - C55.7: with an SMS sender bound and `trustProxy` false, `request.ip` is the socket peer, so
 *   behind a proxy the per-IP OTP limit counts every user as one address.
 */
export function startupWarnings(config: ApiConfig, providers: ProviderBindings): string[] {
  const smsBound = providers.sandbox.sms !== undefined || providers.production.sms !== undefined;
  return smsBound && config.trustProxy === false
    ? [
        'An SMS sender is bound while OPENVERIFY_TRUST_PROXY is false: the per-IP OTP limits ' +
          '(otp-ip-hour) key on the address of the proxy in front of the API, if any.',
      ]
    : [];
}

function urlOf(address: AddressInfo): string {
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return `http://${host}:${String(address.port)}`;
}

/**
 * Builds the container from the environment and listens on the configured host and port.
 * @throws {ConfigError} for an invalid configuration, or the listen error (the container is
 * closed again first).
 */
export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const config = loadConfig(options.env ?? process.env);
  const container = createContainer(config, options.overrides);
  const app = container.buildApp();
  for (const warning of startupWarnings(config, container.providers)) {
    app.log.warn(warning);
  }
  // C249.1, C249.2 (Workflow 11B): the stores' transport and the secret files, never a value.
  logStartupWarnings(app.log, config.startupWarnings);
  let internal: InternalListener | null;
  try {
    await app.listen({ port: config.port, host: config.host });
    // C250.3 (Workflow 11B; platform-ops' http/internal-listener.ts): the internal routes' listener.
    internal = await startInternalListener({ config, container });
  } catch (error) {
    await app.close();
    await container.close();
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    app,
    container,
    url: urlOf(app.server.address() as AddressInfo),
    close() {
      closing ??= (internal === null ? Promise.resolve() : internal.close())
        .then(() => app.close())
        .then(() => container.close());
      return closing;
    },
  };
}

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Closes `server` on the first SIGTERM or SIGINT and sets the exit code (0, or 1 when closing
 * failed), so the process exits once nothing is left open.
 * @returns a function that removes the signal handlers.
 */
export function closeOnSignals(
  server: Pick<RunningServer, 'close'>,
  target: ProcessLike = process,
): () => void {
  const detach = () => {
    for (const signal of SIGNALS) {
      target.off(signal, onSignal);
    }
  };
  function onSignal() {
    detach();
    server.close().then(
      () => {
        target.exitCode = 0;
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        target.stderr.write(`OpenVerify API shutdown failed: ${message}\n`);
        target.exitCode = 1;
      },
    );
  }
  for (const signal of SIGNALS) {
    target.once(signal, onSignal);
  }
  return detach;
}

/**
 * Starts the server and closes it on SIGTERM or SIGINT. A startup failure is written to
 * stderr (configuration problems name the variables, never their values) and sets exit code 1.
 */
export async function main(
  options: StartServerOptions & { process?: ProcessLike } = {},
): Promise<RunningServer | undefined> {
  const target = options.process ?? process;
  try {
    const server = await startServer(options);
    closeOnSignals(server, target);
    return server;
  } catch (error) {
    const message =
      error instanceof ConfigError
        ? error.message
        : `OpenVerify API failed to start: ${error instanceof Error ? error.message : String(error)}`;
    target.stderr.write(`${message}\n`);
    target.exitCode = 1;
    return undefined;
  }
}

/* v8 ignore next 3 -- runs only when the file is the process entrypoint */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
