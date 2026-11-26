/**
 * C263.6 (Phase 11, Workflow 11C, images-11c; Phase 8 P17): the code runner's `tcp:` transport. In
 * a cluster the runner is its own Deployment, reached at `tcp:<host>:<port>`; each connection proves
 * the shared token (at least 32 bytes, compared in constant time) in its first frame before the
 * server says `ready`, and then the socket's frames, limits and checks apply unchanged. A wrong,
 * missing or late token closes the connection with no answer; the token is never in an error. Every
 * value is synthetic and every listener is on 127.0.0.1.
 */
import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { FrameReader, encodeFrame, parseFrame } from './frames.js';
import { resolveRunnerPaths } from './paths.js';
import { createPool } from './pool.js';
import {
  CODE_RUNNER_PROTOCOL_VERSION,
  REQUEST_FRAME_MAX_BYTES,
  RESPONSE_FRAME_MAX_BYTES,
} from './protocol.js';
import type { CodeEvaluation, CodeRunner } from './runner.js';
import { serveCodeRunner, type CodeRunnerServer } from './socket-server.js';
import { CODE_RUNNER_TOKEN_MIN_BYTES, connectCodeRunnerOverTcp } from './transport.js';

const ENVIRONMENT = 'env_01M5CJXHG07XPHF3HRM6NREDH8';
const TOKEN = 'synthetic-runner-token-0123456789abcdef';
const OTHER = 'synthetic-runner-token-fedcba9876543210';

const evaluation = (text: string): CodeEvaluation => ({
  environmentId: ENVIRONMENT,
  source: `export default function (input) {${text}}`,
  input: {},
  limits: { timeMs: 5_000 },
});

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

const listening = async (token = TOKEN): Promise<CodeRunnerServer & { port: number }> => {
  const pool = createPool({ size: 1 });
  const server = await serveCodeRunner({ listen: { host: '127.0.0.1', port: 0, token }, pool });
  closers.push(() => server.close());
  return { ...server, port: server.address?.port ?? 0 };
};

const runner = (port: number, token = TOKEN): CodeRunner => {
  const client = connectCodeRunnerOverTcp({ host: '127.0.0.1', port, token });
  closers.push(() => client.close());
  return client;
};

/**
 * A raw client: what the server sends back, until it closes or `waitMs` passes; `afterReady` is
 * written once the first frame came back (a client waits for `ready` before its first request).
 */
async function raw(
  port: number,
  frames: readonly Buffer[],
  waitMs = 1_000,
  afterReady: readonly Buffer[] = [],
) {
  const socket: Socket = connect({ host: '127.0.0.1', port });
  const reader = new FrameReader(RESPONSE_FRAME_MAX_BYTES);
  const received: unknown[] = [];
  let closed = false;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, waitMs);
    socket.on('connect', () => {
      for (const frame of frames) socket.write(frame);
    });
    socket.on('data', (chunk) => {
      for (const frame of reader.push(chunk)) {
        received.push(parseFrame(frame, 8));
        if (received.length === 1) for (const next of afterReady) socket.write(next);
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      closed = true;
      clearTimeout(timer);
      resolve();
    });
  });
  socket.destroy();
  return { received, closed };
}

const auth = (token: unknown) => encodeFrame({ kind: 'auth', token }, REQUEST_FRAME_MAX_BYTES);

describe('the tcp: transport (C263.6)', () => {
  it('evaluates over TCP with the token, through the same pool and frames as the socket', async () => {
    const server = await listening();
    const client = runner(server.port);

    await expect(client.evaluate(evaluation('return 1 + 1;'))).resolves.toEqual({
      ok: true,
      value: 2,
      console: [],
    });
  });

  it('answers ready only after the token, and then the protocol version and the pool label', async () => {
    const server = await listening();
    const { received, closed } = await raw(server.port, [auth(TOKEN)], 500);

    expect(closed).toBe(false);
    expect(received).toEqual([
      {
        kind: 'ready',
        protocol: CODE_RUNNER_PROTOCOL_VERSION,
        variant: resolveRunnerPaths().label,
      },
    ]);
  });

  it.each([
    ['a wrong token', [auth(OTHER)]],
    ['a token that is not a string', [auth(7)]],
    ['a frame that is not the token', [encodeFrame({ kind: 'shutdown' }, REQUEST_FRAME_MAX_BYTES)]],
    ['a request before the token', [encodeFrame({ kind: 'evaluate' }, REQUEST_FRAME_MAX_BYTES)]],
    ['bytes that are not a frame', [Buffer.from('GET / HTTP/1.1\r\n\r\n')]],
    ['the token with a request pipelined behind it', [Buffer.concat([auth(TOKEN), auth(TOKEN)])]],
  ])('closes the connection without a word on %s', async (_case, frames) => {
    const server = await listening();
    const { received, closed } = await raw(server.port, frames);

    expect(closed).toBe(true);
    expect(received).toEqual([]);
  });

  it('closes a connection that sends nothing within the handshake time', async () => {
    const server = await listening();
    const { received, closed } = await raw(server.port, [], 8_000);

    expect(closed).toBe(true);
    expect(received).toEqual([]);
  }, 10_000);

  it('gives a client with a wrong token a crashed answer, never a rejection, naming no token', async () => {
    const server = await listening();
    const result = await runner(server.port, OTHER).evaluate(evaluation('return 1;'));

    expect(result).toMatchObject({ ok: false, code: 'sandbox_crashed' });
    expect(JSON.stringify(result)).not.toContain('synthetic-runner-token');
  });

  it('keeps the socket limits: an oversized frame after the token ends the connection', async () => {
    const server = await listening();
    const oversized = Buffer.alloc(4);
    oversized.writeUInt32BE(REQUEST_FRAME_MAX_BYTES + 1);
    const { received, closed } = await raw(server.port, [auth(TOKEN)], 1_000, [oversized]);

    expect(closed).toBe(true);
    expect(received).toHaveLength(1);
  });

  it(`refuses a token under ${String(CODE_RUNNER_TOKEN_MIN_BYTES)} bytes on either side, naming no token`, async () => {
    const short = 'synthetic-short-token';
    await expect(
      serveCodeRunner({ listen: { host: '127.0.0.1', port: 0, token: short } }),
    ).rejects.toThrow(/OPENVERIFY_CODE_RUNNER_TOKEN must be at least 32 bytes/);
    expect(() => connectCodeRunnerOverTcp({ host: '127.0.0.1', port: 7700, token: short })).toThrow(
      /OPENVERIFY_CODE_RUNNER_TOKEN must be at least 32 bytes/,
    );
    let message = '';
    try {
      connectCodeRunnerOverTcp({ host: '127.0.0.1', port: 7700, token: short });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain(short);
  });
});
