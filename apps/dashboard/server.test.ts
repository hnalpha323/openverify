// @vitest-environment node
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRequestListener,
  parseServerArgs,
  startDashboardServer,
  standaloneNextConfig,
  type NextAppFactory,
  type StandaloneFiles,
} from './server';
import { isPeerAddressHeaderTrusted } from './src/lib/api/peer-address';

const MARK = Symbol.for('openverify.dashboard.peer-address-header');

afterEach(() => {
  Reflect.deleteProperty(globalThis, MARK);
});

/** What the fake Next.js handler saw. */
interface Seen {
  peer: string | string[] | undefined;
  forwardedFor: string | string[] | undefined;
}

function recordingHandler(seen: Seen[]) {
  return (req: IncomingMessage, res: ServerResponse) => {
    seen.push({
      peer: req.headers['x-openverify-peer-ip'],
      forwardedFor: req.headers['x-forwarded-for'],
    });
    res.end('ok');
    return Promise.resolve();
  };
}

/** GET `url` with raw headers, as a client that forges them would send it. */
function get(url: string, headers: Record<string, string | string[]> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(url, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('parseServerArgs', () => {
  it('defaults to a production server on loopback, port 3001', () => {
    expect(parseServerArgs([])).toEqual({ dev: false, hostname: '127.0.0.1', port: 3001 });
  });

  it('reads --hostname, --port and --dev', () => {
    expect(parseServerArgs(['--hostname', '0.0.0.0', '--port', '3000'])).toEqual({
      dev: false,
      hostname: '0.0.0.0',
      port: 3000,
    });
    expect(parseServerArgs(['--dev']).dev).toBe(true);
  });

  it.each(['0', '65536', 'http', '30.5'])('refuses the port %j', (port) => {
    expect(() => parseServerArgs(['--port', port])).toThrow(
      '--port must be a whole number from 1 to 65535',
    );
  });

  it('accepts the `--` pnpm forwards before script arguments', () => {
    expect(parseServerArgs(['--', '--port', '3000'])).toMatchObject({ port: 3000 });
  });

  it('refuses an unknown option', () => {
    expect(() => parseServerArgs(['--hostnme', 'x'])).toThrow();
  });
});

describe('createRequestListener', () => {
  it('marks this process as the one that sets the peer header', () => {
    expect(isPeerAddressHeaderTrusted()).toBe(false);

    createRequestListener(() => Promise.resolve());

    expect(isPeerAddressHeaderTrusted()).toBe(true);
  });
});

describe('startDashboardServer', () => {
  const running: { close: () => Promise<void> }[] = [];

  afterEach(async () => {
    await Promise.all(running.splice(0).map((server) => server.close()));
  });

  async function start(seen: Seen[]) {
    const prepare = vi.fn(() => Promise.resolve());
    const factory = vi.fn<NextAppFactory>(() => ({
      prepare,
      getRequestHandler: () => recordingHandler(seen),
    }));
    const server = await startDashboardServer(
      { dev: false, hostname: '127.0.0.1', port: 0 },
      factory,
    );
    running.push(server);
    return { server, factory, prepare };
  }

  it('prepares the Next.js app in production mode on the given address', async () => {
    const { server, factory, prepare } = await start([]);

    expect(factory).toHaveBeenCalledOnce();
    const [options] = factory.mock.calls[0] ?? [];
    expect(options).toMatchObject({ dev: false, hostname: '127.0.0.1', port: 0 });
    expect(options?.dir).toMatch(/apps\/dashboard$/);
    expect(prepare).toHaveBeenCalledOnce();
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('hands Next.js the socket peer, overwriting a forged x-openverify-peer-ip', async () => {
    const seen: Seen[] = [];
    const { server } = await start(seen);

    const answer = await get(`${server.url}/inquiries`, {
      'x-openverify-peer-ip': '203.0.113.66',
      'x-forwarded-for': '203.0.113.67',
    });

    expect(answer).toEqual({ status: 200, body: 'ok' });
    expect(seen).toEqual([{ peer: '127.0.0.1', forwardedFor: '203.0.113.67' }]);
  });

  it('overwrites a forged header sent twice', async () => {
    const seen: Seen[] = [];
    const { server } = await start(seen);

    await get(`${server.url}/`, { 'x-openverify-peer-ip': ['203.0.113.66', '203.0.113.68'] });

    expect(seen[0]?.peer).toBe('127.0.0.1');
  });

  it('answers 500 without details when the handler fails', async () => {
    const prepare = () => Promise.resolve();
    const failing = () => () => Promise.reject(new Error('render failed: secret detail'));
    const server = await startDashboardServer(
      { dev: false, hostname: '127.0.0.1', port: 0 },
      () => ({
        prepare,
        getRequestHandler: failing,
      }),
    );
    running.push(server);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const answer = await get(`${server.url}/`);

    expect(answer.status).toBe(500);
    expect(answer.body).not.toContain('secret');
  });
});

describe('the standalone output (Phase 11, Workflow 11C, images-11c; plan amendment 12)', () => {
  const DIR = '/app/apps/dashboard';
  const REQUIRED = `${DIR}/.next/required-server-files.json`;
  const CONFIG = { reactStrictMode: true, distDir: '.next', poweredByHeader: false };
  const files = (entries: Record<string, string>): StandaloneFiles => ({
    exists: (path) => path in entries,
    readFile: (path) => {
      const text = entries[path];
      if (text === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return text;
    },
  });

  it('serves the configuration the build wrote when no next.config is shipped (the image)', () => {
    const json = standaloneNextConfig(
      DIR,
      files({ [REQUIRED]: JSON.stringify({ version: 1, config: CONFIG, files: [] }) }),
    );
    expect(json === null ? null : JSON.parse(json)).toEqual(CONFIG);
  });

  it.each(['next.config.ts', 'next.config.js', 'next.config.mjs'])(
    'leaves Next.js to load %s where it is (development, compose, the e2e stack)',
    (name) => {
      expect(
        standaloneNextConfig(
          DIR,
          files({ [`${DIR}/${name}`]: '', [REQUIRED]: JSON.stringify({ config: CONFIG }) }),
        ),
      ).toBeNull();
    },
  );

  it('answers null without a build, and refuses a build file without its configuration', () => {
    expect(standaloneNextConfig(DIR, files({}))).toBeNull();
    expect(() => standaloneNextConfig(DIR, files({ [REQUIRED]: '{"version":1}' }))).toThrow(
      /required-server-files\.json holds no configuration/,
    );
  });
});
