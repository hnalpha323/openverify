// @vitest-environment node
/**
 * C157.1 (Workflow 9D review R005): the flow server streams a file of `dist/` so that a client that
 * stops reading and drops the connection releases the file (its read stream closed, its descriptor
 * with it), and a read that fails never reaches the process as an unhandled `error` event: the
 * response is cut, the failure logged, and the server keeps serving. Streams are observed through
 * `node:fs`'s `createReadStream`, wrapped here (every other `node:fs` export is the real one).
 */
import type { ReadStream } from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startFlowServer, type AccessLogLine, type RunningFlowServer } from '../../server.ts';

/** The streams the server opened, by file name; a name listed in `failing` gets a failing stream. */
const opened = vi.hoisted(() => ({
  streams: [] as { readonly path: string; readonly stream: NodeJS.ReadableStream }[],
  failing: new Set<string>(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const createReadStream = ((path: unknown, options?: unknown) => {
    const name = String(path);
    if ([...opened.failing].some((failing) => name.endsWith(failing))) {
      // One chunk, then a read error: the shape of EIO or a file replaced during a deploy.
      let sent = false;
      const stream = new Readable({
        read() {
          if (sent) {
            this.destroy(Object.assign(new Error('synthetic read failure'), { code: 'EIO' }));
            return;
          }
          sent = true;
          this.push(Buffer.alloc(1024, 1));
        },
      });
      opened.streams.push({ path: name, stream });
      return stream;
    }
    const stream = (actual.createReadStream as (p: unknown, o?: unknown) => ReadStream)(
      path,
      options,
    );
    opened.streams.push({ path: name, stream });
    return stream;
  }) as typeof actual.createReadStream;
  return { ...actual, default: { ...actual, createReadStream }, createReadStream };
});

/** Larger than any socket buffer on loopback, so a client that stops reading holds the stream. */
const BIG_BYTES = 64 * 1024 * 1024;
const BIG = 'big-Abc123de.js';
const BROKEN = 'broken-Abc123de.js';

let root: string;
let server: RunningFlowServer;
const log: AccessLogLine[] = [];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'openverify-flow-streaming-'));
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(
    join(dist, 'index.html'),
    '<!doctype html><html><head></head><body>x</body></html>',
  );
  writeFileSync(join(dist, 'assets', BIG), Buffer.alloc(BIG_BYTES, 0x20));
  writeFileSync(join(dist, 'assets', BROKEN), Buffer.alloc(64 * 1024, 0x20));
  writeFileSync(join(dist, 'assets', 'small-Abc123de.js'), 'export {};');
  opened.failing.add(BROKEN);
  server = await startFlowServer({
    config: {
      distDir: dist,
      apiOrigin: 'https://api.example.com',
      consoleOrigin: null,
      lookup: null,
      trustedProxyHops: 0,
    },
    hostname: '127.0.0.1',
    port: 0,
    log: (line) => log.push(line),
  });
});

afterAll(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

/** Sends a raw GET and resolves with the socket once the first bytes of the answer arrive. */
function startDownload(path: string) {
  const url = new URL(server.url);
  const socket = connect(Number(url.port), url.hostname);
  const received: Buffer[] = [];
  const firstBytes = new Promise<void>((resolve, reject) => {
    socket.once('data', () => {
      resolve();
    });
    socket.once('error', reject);
  });
  socket.on('data', (chunk: Buffer) => received.push(chunk));
  const ended = new Promise<void>((resolve) => {
    socket.once('close', () => {
      resolve();
    });
  });
  socket.write(`GET ${path} HTTP/1.1\r\nHost: flow.example.com\r\nConnection: close\r\n\r\n`);
  return { socket, firstBytes, ended, received };
}

/** The stream the server opened for `name` (the newest one). */
function streamOf(name: string) {
  const found = opened.streams.filter((entry) => entry.path.endsWith(name)).at(-1);
  if (found === undefined) {
    throw new Error(`No stream was opened for ${name}`);
  }
  return found.stream as ReadStream;
}

/** Whether a plain GET is still answered (the process and its listener are alive). */
async function stillServes(): Promise<number> {
  const download = startDownload('/assets/small-Abc123de.js');
  await download.ended;
  return Number(/^HTTP\/1\.1 (\d{3})/.exec(Buffer.concat(download.received).toString())?.[1]);
}

describe('streaming a file of dist/ (C157.1, review R005)', () => {
  it('sends a whole file and logs only its 200', async () => {
    const before = log.length;
    const download = startDownload(`/assets/${BIG}`);
    await download.ended;

    const answer = Buffer.concat(download.received);
    expect(answer.subarray(answer.indexOf('\r\n\r\n') + 4).length).toBe(BIG_BYTES);
    await vi.waitFor(
      () => {
        expect(streamOf(BIG).closed).toBe(true);
      },
      { timeout: 5_000, interval: 25 },
    );
    expect(log.slice(before)).toEqual([{ entry: 'asset', status: 200 }]);
  });

  it('closes the file’s stream when the client drops the connection mid-download', async () => {
    const download = startDownload(`/assets/${BIG}`);
    await download.firstBytes;
    download.socket.pause();
    const stream = streamOf(BIG);
    expect(stream.closed).toBe(false);

    download.socket.destroy();

    await vi.waitFor(
      () => {
        expect(stream.closed).toBe(true);
      },
      { timeout: 5_000, interval: 25 },
    );
    expect(await stillServes()).toBe(200);
  });

  it('cuts the answer and logs the failure when the read fails, and keeps serving', async () => {
    const unhandled = vi.fn();
    const failedUnhandled = new Promise<void>((resolve) => {
      unhandled.mockImplementation(() => {
        resolve();
      });
    });
    process.on('uncaughtException', unhandled);
    try {
      const download = startDownload(`/assets/${BROKEN}`);
      // An unhandled stream error leaves the answer open forever: stop at whichever comes first.
      await Promise.race([download.ended, failedUnhandled]);
      expect(unhandled).not.toHaveBeenCalled();
      const answer = Buffer.concat(download.received);

      // The connection is cut: nothing at all when the failure comes before the buffered head was
      // flushed, else the head and fewer body bytes than its Content-Length; never the whole file.
      const text = answer.toString('latin1');
      expect(text === '' || text.startsWith('HTTP/1.1 200 ')).toBe(true);
      const body = text === '' ? answer : answer.subarray(answer.indexOf('\r\n\r\n') + 4);
      expect(body.length).toBeLessThan(64 * 1024);
      expect(log).toContainEqual({ entry: 'error', status: 500 });
      expect(await stillServes()).toBe(200);
    } finally {
      process.off('uncaughtException', unhandled);
    }
  });
});
