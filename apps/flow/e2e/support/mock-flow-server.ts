/**
 * C157 (Workflow 9A, flow-server-embed): the mocked suite's flow server. `playwright.config.ts`'s
 * web server builds `dist/` and serves it with `vite preview`, whose fixed headers say
 * `frame-ancestors 'none'`; the preview and embed specs need the headers the flow server computes,
 * so each starts `node --conditions=@openverify/source server.ts` over the same `dist/`, on a
 * loopback port of its own, against a stub of the API's internal embed-policy route in this process.
 * Nothing reaches the network: the flow's own API calls are still answered by `page.route`.
 */
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { API_ORIGIN } from './mock-flow-api';

const FLOW_ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** Synthetic: the flow server's token for the stub (C174.7: at least 32 bytes). */
const TOKEN = 'synthetic-flow-server-token-e2e-0123456789';

export interface RunningFlowServer {
  /** `http://127.0.0.1:<port>`, the flow's origin. */
  readonly origin: string;
  /** The inquiry ids the stub was asked about, in order. */
  readonly lookups: readonly string[];
  /** The origins the stub answers for `inquiryId` (`frame-ancestors`). */
  setPolicy(inquiryId: string, origins: readonly string[]): void;
  close(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('No port assigned'));
        }
      });
    });
  });
}

/** Starts the stub API and the flow server; the console origin is the preview's only frame. */
export async function startMockFlowServer(consoleOrigin: string): Promise<RunningFlowServer> {
  const policies = new Map<string, readonly string[]>();
  const lookups: string[] = [];
  const stub = createHttpServer((req, res) => {
    const id = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
    lookups.push(id);
    const origins = policies.get(id);
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end();
    } else if (origins === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{}');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          'inquiry-id': id,
          'template-id': 'itmpl_01M5CJXHG07XPHF3HRM6NREDH7',
          'environment-id': 'env_01M5CJXHG07XPHF3HRM6NREDH7',
          'frame-ancestors': origins,
        }),
      );
    }
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const stubAddress = stub.address();
  const stubPort = typeof stubAddress === 'object' && stubAddress !== null ? stubAddress.port : 0;

  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const child = spawn(
    process.execPath,
    [
      '--conditions=@openverify/source',
      'server.ts',
      '--port',
      String(port),
      '--dist',
      `${FLOW_ROOT}dist`,
    ],
    {
      cwd: FLOW_ROOT,
      env: {
        ...process.env,
        VITE_OPENVERIFY_API_URL: API_ORIGIN,
        OPENVERIFY_DASHBOARD_PUBLIC_URL: consoleOrigin,
        OPENVERIFY_FLOW_SERVER_TOKEN: TOKEN,
        OPENVERIFY_FLOW_SERVER_API_URL: `http://127.0.0.1:${String(stubPort)}`,
        OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS: '0',
      },
      stdio: 'ignore',
    },
  );
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${origin}/`)).ok) {
        break;
      }
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline || child.exitCode !== null) {
      child.kill();
      stub.close();
      throw new Error('The flow server did not start');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {
    origin,
    lookups,
    setPolicy: (inquiryId, origins) => {
      policies.set(inquiryId, origins);
    },
    close: async () => {
      child.kill();
      await new Promise<void>((resolve) => {
        stub.close(() => {
          resolve();
        });
      });
    },
  };
}

/** A page a loopback page server answers: its type and body. */
export interface ServedPage {
  readonly type: string;
  readonly body: string;
}

export interface RunningPageServer {
  /** `http://localhost:<port>`: loopback, so Chromium's local-network checks let it frame the flow. */
  readonly origin: string;
  close(): Promise<void>;
}

/**
 * A page server on loopback for a console or a customer page. A page fulfilled by `page.route`
 * counts as a public address to Chromium, whose local-network access checks then refuse to let it
 * frame the loopback flow server; a real loopback server is what an operator's own pages are.
 */
export async function startPageServer(
  pageOf: (path: string) => ServedPage | null,
): Promise<RunningPageServer> {
  const server = createHttpServer((req, res) => {
    const served = pageOf(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (served === null) {
      res.writeHead(404).end();
    } else {
      res.writeHead(200, { 'content-type': served.type }).end(served.body);
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    origin: `http://localhost:${String(port)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
