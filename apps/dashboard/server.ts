/**
 * The dashboard's custom Node server (C21): `node server.ts [--hostname <h>] [--port <p>] [--dev]`.
 *
 * Next.js sets `X-Forwarded-For` only when a request has none, so behind no proxy a client-sent
 * value passes through and the real socket peer is lost. Before Next.js sees a request, this
 * server deletes any incoming `x-openverify-peer-ip` and sets it from `req.socket.remoteAddress`;
 * the BFF derives the operator's address from it (`src/lib/api/client-address.ts`). Start the
 * dashboard with this server, never with `next start`: without it the BFF knows no address and
 * sends none.
 *
 * Node runs this file with its built-in type stripping (Node 22.18+), so it uses erasable
 * TypeScript only and imports with file extensions.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { markPeerAddressHeaderTrusted, setPeerAddressHeader } from './src/lib/api/peer-address.ts';
import { resolveSecretFiles } from './src/lib/secret-files.ts';

/** `src/lib/config.ts`'s `BFF_TOKEN_ENV` (that module imports `server-only`, which Node cannot run). */
const BFF_TOKEN_VARIABLE = 'OPENVERIFY_DASHBOARD_BFF_TOKEN';

export interface ServerOptions {
  /** `next dev` behaviour instead of serving the production build. */
  readonly dev: boolean;
  readonly hostname: string;
  readonly port: number;
}

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** The part of a Next.js app (`next(options)`) this server uses. */
export interface NextApp {
  prepare(): Promise<void>;
  getRequestHandler(): RequestHandler;
}

export type NextAppFactory = (options: {
  dev: boolean;
  dir: string;
  hostname: string;
  port: number;
}) => NextApp;

export interface RunningServer {
  readonly server: Server;
  /** `http://<hostname>:<port>` of the listening socket. */
  readonly url: string;
  close(): Promise<void>;
}

const DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Options from the command line. Defaults: a production server on 127.0.0.1:3001, the address
 * `.env.example` gives the dashboard.
 * @throws {Error} for an unknown option or a port that is not 1-65535.
 */
export function parseServerArgs(args: readonly string[]): ServerOptions {
  const { values } = parseArgs({
    // `pnpm start -- --port 3000` forwards the `--` itself.
    args: args[0] === '--' ? args.slice(1) : [...args],
    options: {
      hostname: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '3001' },
      dev: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const port = /^\d{1,5}$/.test(values.port) ? Number(values.port) : Number.NaN;
  if (!(port >= 1 && port <= 65_535)) {
    throw new Error('--port must be a whole number from 1 to 65535');
  }
  return { dev: values.dev, hostname: values.hostname, port };
}

/**
 * The listener that records each request's socket peer, then hands it to Next.js. Creating it
 * marks this process, so the BFF believes the header (`isPeerAddressHeaderTrusted()`).
 */
export function createRequestListener(handle: RequestHandler) {
  markPeerAddressHeaderTrusted();
  return (req: IncomingMessage, res: ServerResponse): void => {
    setPeerAddressHeader(req.headers, req.socket.remoteAddress);
    handle(req, res).catch((error: unknown) => {
      console.error('The dashboard could not answer a request', error);
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      res.end();
    });
  };
}

/** Prepares the Next.js app in this directory and starts listening (port 0: any free port). */
export async function startDashboardServer(
  options: ServerOptions,
  createNextApp: NextAppFactory,
): Promise<RunningServer> {
  const app = createNextApp({
    dev: options.dev,
    dir: DIR,
    hostname: options.hostname,
    port: options.port,
  });
  await app.prepare();
  const server = createServer(createRequestListener(app.getRequestHandler()));
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(options.port, options.hostname, () => {
      server.off('error', fail);
      done();
    });
  });
  const { address, port } = server.address() as AddressInfo;
  const host = address.includes(':') ? `[${address}]` : address;
  return {
    server,
    url: `http://${host}:${String(port)}`,
    close: () =>
      new Promise<void>((done, fail) => {
        server.close((error) => {
          if (error === undefined) {
            done();
          } else {
            fail(error);
          }
        });
        server.closeAllConnections();
      }),
  };
}

/** The file access `standaloneNextConfig` uses; tests pass a fake. */
export interface StandaloneFiles {
  exists(path: string): boolean;
  readFile(path: string): string;
}

/** The configuration files Next.js would load from the app's directory. */
const NEXT_CONFIG_FILES = ['next.config.ts', 'next.config.js', 'next.config.mjs'];

/**
 * Phase 11, Workflow 11C (images-11c; plan amendment 12): the console image runs this server over
 * Next.js's standalone output, which ships no `next.config.ts` (loading it would need TypeScript at
 * run time). As Next's generated standalone `server.js` does, the configuration the build resolved
 * (`.next/required-server-files.json`) is handed to Next.js through
 * `__NEXT_PRIVATE_STANDALONE_CONFIG`; `null` wherever a `next.config` is present (development,
 * compose, the e2e stack), so those keep loading theirs.
 * @throws {Error} when the build's file holds no configuration.
 */
export function standaloneNextConfig(dir: string, files: StandaloneFiles): string | null {
  const required = `${dir}/.next/required-server-files.json`;
  if (NEXT_CONFIG_FILES.some((name) => files.exists(`${dir}/${name}`)) || !files.exists(required)) {
    return null;
  }
  const parsed = JSON.parse(files.readFile(required)) as { config?: unknown };
  if (typeof parsed.config !== 'object' || parsed.config === null) {
    throw new Error(`${required}: required-server-files.json holds no configuration`);
  }
  return JSON.stringify(parsed.config);
}

/** The secrets the console reads, each also from `<NAME>_FILE` (C249.2; Workflow 11C). */
const SECRET_VARIABLES = [BFF_TOKEN_VARIABLE];

async function main(): Promise<void> {
  const options = parseServerArgs(process.argv.slice(2));
  const secrets = resolveSecretFiles(process.env, SECRET_VARIABLES, {
    readFile: (path) => readFileSync(path, 'utf8'),
    mode: (path) => statSync(path).mode,
  });
  if (secrets.issues.length > 0) {
    throw new Error(`The dashboard's configuration is not valid:\n${secrets.issues.join('\n')}`);
  }
  for (const warning of secrets.warnings) {
    console.warn(JSON.stringify(warning));
  }
  Object.assign(process.env, secrets.env);
  if (!options.dev) {
    // As `next start` does; set before Next.js loads.
    Object.assign(process.env, { NODE_ENV: 'production' });
    const standalone = standaloneNextConfig(DIR, {
      exists: (path) => existsSync(path),
      readFile: (path) => readFileSync(path, 'utf8'),
    });
    if (standalone !== null) {
      Object.assign(process.env, { __NEXT_PRIVATE_STANDALONE_CONFIG: standalone });
    }
  }
  const { default: next } = await import('next');
  const running = await startDashboardServer(options, (nextOptions) => next(nextOptions));
  console.log(`OpenVerify dashboard listening on ${running.url}`);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void running.close().finally(() => process.exit(0));
    });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
