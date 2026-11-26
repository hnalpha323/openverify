/**
 * C123.3 (P17): the container form. The worker reaches the `code-runner` service over a Unix socket
 * on a shared volume, with the same frames and the same child pool inside. A server is as
 * untrusted as a child to the worker, and a frame is checked on both sides. Every value is
 * synthetic.
 */
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameReader, encodeFrame, parseFrame } from './frames.js';
import { childArgumentsOf, resolveRunnerPaths } from './paths.js';
import { createPool, type PoolEvent, type PoolInternals } from './pool.js';
import {
  CODE_RUNNER_PROTOCOL_VERSION,
  REQUEST_FRAME_MAX_BYTES,
  RESPONSE_FRAME_MAX_BYTES,
  type CodeRunnerFailureReason,
} from './protocol.js';
import { createSocketRunner, type SocketInternals } from './socket-client.js';
import { serveCodeRunner, type CodeRunnerServer } from './socket-server.js';
import { prepareEvaluateRequest } from './limits.js';
import type { CodeEvaluation, CodeEvaluationResult, CodeRunner } from './runner.js';

const ENVIRONMENT = 'env_01M5CJXHG07XPHF3HRM6NREDH8';
const ID = '00000000-0000-4000-8000-000000000001';
const FAKE_CHILD = fileURLToPath(new URL('./testing/fake-child.mjs', import.meta.url));
const LABEL = '@jitl/quickjs-wasmfile-release-sync@0.32.0';
const READY = { kind: 'ready', protocol: CODE_RUNNER_PROTOCOL_VERSION, variant: LABEL };

const evaluation = (text: string, change: Partial<CodeEvaluation> = {}): CodeEvaluation => ({
  environmentId: ENVIRONMENT,
  source: `export default function (input) {${text}}`,
  input: {},
  limits: { timeMs: 5_000 },
  ...change,
});

const crashed = (reason: CodeRunnerFailureReason): CodeEvaluationResult => ({
  ok: false,
  code: 'sandbox_crashed',
  message: null,
  console: [],
  reason,
});

let directory: string;
let socketPath: string;
const closers: (() => Promise<void>)[] = [];

const client = (internals?: SocketInternals): CodeRunner => {
  const runner = createSocketRunner(socketPath, internals);
  closers.push(() => runner.close());
  return runner;
};

const served = async (options: PoolInternals = {}): Promise<CodeRunnerServer> => {
  const pool = createPool({ size: 1 }, options);
  const server = await serveCodeRunner({ socketPath, pool });
  closers.push(() => server.close());
  return server;
};

/** A server that does what a test says with each connection. */
const fakeServer = async (onConnection: (socket: Socket) => void): Promise<Server> => {
  const server = createServer(onConnection);
  await new Promise<void>((resolve) => {
    server.listen(socketPath, resolve);
  });
  closers.push(
    () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );
  return server;
};

const sendsReady = (socket: Socket, then?: (id: string) => void) => {
  socket.write(encodeFrame(READY, RESPONSE_FRAME_MAX_BYTES));
  const reader = new FrameReader(REQUEST_FRAME_MAX_BYTES);
  socket.on('error', () => undefined);
  socket.on('data', (chunk) => {
    for (const frame of reader.push(chunk)) {
      const { id } = parseFrame(frame, 4) as { id: string };
      then?.(id);
    }
  });
};

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'code-runner-socket-'));
  socketPath = join(directory, 'code-runner.sock');
});

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  rmSync(directory, { recursive: true, force: true });
});

describe('an evaluation over the socket', () => {
  it('answers from a real child', async () => {
    await served();
    const result = await client().evaluate(evaluation('return input.a + 1;', { input: { a: 1 } }));
    expect(result).toEqual({ ok: true, value: 2, console: [] });
  });

  it('carries the console of a test run', async () => {
    await served();
    const result = await client().evaluate(
      evaluation('console.log("line"); return 1;', { captureConsole: true }),
    );
    expect(result).toEqual({ ok: true, value: 1, console: ['line'] });
  });

  it('carries each error of the child, with the guest message', async () => {
    await served();
    const runner = client();
    expect(await runner.evaluate(evaluation('throw new Error("no");'))).toEqual({
      ok: false,
      code: 'runtime_error',
      message: 'no',
      console: [],
    });
    expect(await runner.evaluate(evaluation('for (;;) {}', { limits: { timeMs: 20 } }))).toEqual({
      ok: false,
      code: 'timeout',
      message: null,
      console: [],
    });
  });

  it('carries what the pool decided as sandbox_crashed, with its reason', async () => {
    const paths = resolveRunnerPaths(FAKE_CHILD);
    await served({ plan: { args: [...childArgumentsOf(paths), 'exit'], label: paths.label } });
    expect(await client().evaluate(evaluation('return 1;'))).toEqual(crashed('child_exited'));
  });

  it('runs evaluations side by side on one connection', async () => {
    await served();
    const runner = client();
    const results = await Promise.all(
      [1, 2, 3].map((value) => runner.evaluate(evaluation(`return ${String(value)};`))),
    );
    expect(results.map((result) => (result as { value: number }).value)).toEqual([1, 2, 3]);
  });

  it('holds a child to one environment inside the container too (P15)', async () => {
    const events: PoolEvent[] = [];
    await served({ observe: (event) => events.push(event) });
    const runner = client();
    await runner.evaluate(evaluation('return 1;'));
    await runner.evaluate(evaluation('return 1;'));
    await runner.evaluate(
      evaluation('return 1;', { environmentId: 'env_01M5CJXHG07XPHF3HRM6NREDH9' }),
    );
    expect(events.filter((event) => event.type === 'spawned')).toHaveLength(2);
  });

  it('refuses what the contract refuses, without a connection', async () => {
    const result = await client().evaluate(evaluation('return 1;', { environmentId: 'other' }));
    expect(result).toEqual({
      ok: false,
      code: 'runtime_error',
      message: null,
      console: [],
      reason: 'input_refused',
    });
  });
});

describe('when the server is not there', () => {
  it('answers socket_unavailable, and connects again once it is', async () => {
    const runner = client();
    expect(await runner.evaluate(evaluation('return 1;'))).toEqual(crashed('socket_unavailable'));
    await served();
    expect(await runner.evaluate(evaluation('return 1;'))).toMatchObject({ ok: true, value: 1 });
  });

  it('answers socket_closed when the server goes mid-evaluation, and connects again', async () => {
    const connections: Socket[] = [];
    await fakeServer((socket) => {
      connections.push(socket);
      sendsReady(socket, () => {
        if (connections.length === 1) {
          socket.destroy();
          return;
        }
      });
    });
    const runner = client();
    expect(await runner.evaluate(evaluation('return 1;'))).toEqual(crashed('socket_closed'));
    const second = runner.evaluate(evaluation('return 1;', { limits: { timeMs: 1 } }));
    await expect.poll(() => connections.length).toBe(2);
    connections[1]?.destroy();
    expect(await second).toEqual(crashed('socket_closed'));
  });
});

describe('a server that misbehaves (it is as untrusted as a child)', () => {
  const header = (length: number) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(length);
    return bytes;
  };

  it.each<[string, (id: string, socket: Socket) => void, CodeRunnerFailureReason]>([
    ['a header announcing 1 GiB', (_id, s) => s.write(header(1024 ** 3)), 'frame_too_large'],
    [
      'text that is no JSON',
      (_id, s) => s.write(Buffer.concat([header(1), Buffer.from('{')])),
      'frame_malformed',
    ],
    [
      'a frame past the schema',
      (id, s) => s.write(encodeFrame({ kind: 'eval', id }, RESPONSE_FRAME_MAX_BYTES)),
      'frame_malformed',
    ],
    [
      'an answer to nothing',
      (_id, s) =>
        s.write(encodeFrame({ kind: 'value', id: ID, value: 1 }, RESPONSE_FRAME_MAX_BYTES)),
      'frame_unexpected',
    ],
    [
      'a second handshake',
      (_id, s) => s.write(encodeFrame(READY, RESPONSE_FRAME_MAX_BYTES)),
      'frame_unexpected',
    ],
  ])('refuses %s', async (_name, misbehave, reason) => {
    await fakeServer((socket) => {
      sendsReady(socket, (id) => {
        misbehave(id, socket);
      });
    });
    expect(await client().evaluate(evaluation('return 1;'))).toEqual(crashed(reason));
  });

  it('refuses another variant at the handshake', async () => {
    await fakeServer((socket) => {
      socket.write(encodeFrame({ ...READY, variant: 'other@1.0.0' }, RESPONSE_FRAME_MAX_BYTES));
      socket.on('error', () => undefined);
    });
    expect(await client().evaluate(evaluation('return 1;'))).toEqual(crashed('handshake_refused'));
  });

  it('refuses a frame before the handshake', async () => {
    await fakeServer((socket) => {
      socket.write(encodeFrame({ kind: 'value', id: ID, value: 1 }, RESPONSE_FRAME_MAX_BYTES));
      socket.on('error', () => undefined);
    });
    expect(await client().evaluate(evaluation('return 1;'))).toEqual(crashed('frame_unexpected'));
  });

  it('gives up on a server that never says ready', async () => {
    await fakeServer((socket) => {
      socket.on('error', () => undefined);
    });
    const result = await client({ connectTimeoutMs: 20 }).evaluate(evaluation('return 1;'));
    expect(result).toEqual(crashed('handshake_timeout'));
  });

  it('gives up on a server that never answers, after the kill it should have made', async () => {
    const delays: number[] = [];
    const schedule = (run: () => void, delayMs: number) => {
      delays.push(delayMs);
      const timer = setTimeout(run, delayMs);
      return () => {
        clearTimeout(timer);
      };
    };
    await fakeServer((socket) => {
      sendsReady(socket);
    });
    const result = await client({ answerMarginMs: 10, schedule }).evaluate(
      evaluation('return 1;', { limits: { timeMs: 20 } }),
    );
    expect(result).toEqual(crashed('socket_timeout'));
    expect(delays).toContain(20 + 250 + 10);
  });

  it('times out one evaluation alone, keeps the connection, and drops its late answer (R005)', async () => {
    const connections: Socket[] = [];
    const ids: string[] = [];
    await fakeServer((socket) => {
      connections.push(socket);
      sendsReady(socket, (id) => {
        ids.push(id);
      });
    });
    const runner = client({ answerMarginMs: 10 });
    const slow = runner.evaluate(evaluation('return 1;', { limits: { timeMs: 20 } }));
    const other = runner.evaluate(evaluation('return 2;'));

    expect(await slow).toEqual(crashed('socket_timeout'));
    await expect.poll(() => ids.length).toBe(2);
    for (const id of ids) {
      connections[0]?.write(encodeFrame({ kind: 'value', id, value: 7 }, RESPONSE_FRAME_MAX_BYTES));
    }

    expect(await other).toEqual({ ok: true, value: 7, console: [] });
    expect(connections).toHaveLength(1);
  });

  it('ends a connection that leaves too many evaluations unanswered (R005)', async () => {
    const connections: Socket[] = [];
    await fakeServer((socket) => {
      connections.push(socket);
      sendsReady(socket);
    });
    const runner = client({ answerMarginMs: 10, abandonedMax: 1 });
    const quick = { limits: { timeMs: 20 } };

    expect(await runner.evaluate(evaluation('return 1;', quick))).toEqual(
      crashed('socket_timeout'),
    );
    expect(await runner.evaluate(evaluation('return 2;', quick))).toEqual(
      crashed('socket_timeout'),
    );
    const third = runner.evaluate(evaluation('return 3;', quick));

    await expect.poll(() => connections.length).toBe(2);
    expect(await third).toEqual(crashed('socket_timeout'));
  });

  it('caps the console of an answer that came late (R005)', async () => {
    const connections: Socket[] = [];
    const ids: string[] = [];
    await fakeServer((socket) => {
      connections.push(socket);
      sendsReady(socket, (id) => {
        ids.push(id);
      });
    });
    const runner = client({ answerMarginMs: 10 });
    const slow = runner.evaluate(evaluation('return 1;', { limits: { timeMs: 20 } }));
    const other = runner.evaluate(evaluation('return 2;'));
    expect(await slow).toEqual(crashed('socket_timeout'));
    await expect.poll(() => ids.length).toBe(2);
    const [late] = ids;
    for (let line = 0; line < 51; line += 1) {
      connections[0]?.write(
        encodeFrame({ kind: 'console', id: late, line: 'x' }, RESPONSE_FRAME_MAX_BYTES),
      );
    }

    expect(await other).toEqual(crashed('frame_unexpected'));
  });

  it('caps a guest message at 1 KiB again', async () => {
    await fakeServer((socket) => {
      sendsReady(socket, (id) => {
        socket.write(
          encodeFrame(
            { kind: 'error', id, code: 'runtime_error', message: 'é'.repeat(2000) },
            RESPONSE_FRAME_MAX_BYTES,
          ),
        );
      });
    });
    const result = await client().evaluate(evaluation('return 1;'));
    expect(Buffer.byteLength((result as { message: string }).message)).toBeLessThanOrEqual(1024);
  });

  it('refuses a 51st console line', async () => {
    await fakeServer((socket) => {
      sendsReady(socket, (id) => {
        for (let index = 0; index < 51; index += 1) {
          socket.write(encodeFrame({ kind: 'console', id, line: 'x' }, RESPONSE_FRAME_MAX_BYTES));
        }
      });
    });
    expect(await client().evaluate(evaluation('return 1;'))).toEqual(crashed('frame_unexpected'));
  });
});

describe('close', () => {
  it('answers what waits, and every evaluation after it', async () => {
    await fakeServer((socket) => {
      sendsReady(socket);
    });
    const runner = client();
    const running = runner.evaluate(evaluation('return 1;'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runner.close();
    expect(await running).toEqual(crashed('runner_closed'));
    expect(await runner.evaluate(evaluation('return 1;'))).toEqual(crashed('runner_closed'));
    await expect(runner.close()).resolves.toBeUndefined();
  });
});

describe('the server', () => {
  /**
   * A connection and the frames it receives. `framesReach(count)` resolves on the `data` event that
   * brings the count-th frame, so a wait is bounded by the test's own 60 s guard and not by
   * `expect.poll`'s 1 s default, which a child starting under a full suite's load outran (Workflow
   * 8B Stage 1a amendment 31).
   */
  const dial = async (): Promise<{
    socket: Socket;
    frames: unknown[];
    closed: Promise<void>;
    framesReach: (count: number) => Promise<void>;
  }> => {
    const socket = connect(socketPath);
    const frames: unknown[] = [];
    const waiters: { count: number; resolve: () => void }[] = [];
    const reader = new FrameReader(RESPONSE_FRAME_MAX_BYTES);
    socket.on('data', (chunk) => {
      for (const frame of reader.push(chunk)) frames.push(parseFrame(frame, 40));
      for (const waiter of waiters.filter(({ count }) => frames.length >= count)) waiter.resolve();
    });
    const framesReach = (count: number) =>
      frames.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiters.push({ count, resolve });
          });
    const closed = new Promise<void>((resolve) => {
      socket.on('close', () => {
        resolve();
      });
    });
    socket.on('error', () => undefined);
    await framesReach(1);
    return { socket, frames, closed, framesReach };
  };

  const validRequest = () => {
    const request = prepareEvaluateRequest(evaluation('return 1;'), ID);
    if (request === null) throw new Error('the request was refused');
    return request;
  };

  it('says ready with the protocol and the variant', async () => {
    await served();
    const { frames, socket } = await dial();
    expect(frames[0]).toEqual(READY);
    socket.destroy();
  });

  it('answers on the same connection', async () => {
    await served();
    const { socket, frames, framesReach } = await dial();
    socket.write(encodeFrame(validRequest(), REQUEST_FRAME_MAX_BYTES));
    await framesReach(2);
    expect(frames[1]).toEqual({ kind: 'value', id: ID, value: 1 });
    socket.destroy();
  });

  it('drops a connection that announces more than a request can hold', async () => {
    await served();
    const { socket, closed } = await dial();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(1024 ** 3);
    socket.write(header);
    await closed;
  });

  it.each([
    ['text that is no JSON', Buffer.from('{')],
    ['a frame past the schema', Buffer.from('{"kind":"eval"}')],
  ])('drops a connection that sends %s', async (_name, payload) => {
    await served();
    const { socket, closed } = await dial();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length);
    socket.write(Buffer.concat([header, payload]));
    await closed;
  });

  it('drops a connection that asks past a ceiling', async () => {
    await served();
    const { socket, closed } = await dial();
    const request = validRequest();
    const past = { ...request, limits: { ...request.limits, 'time-ms': 60_000 } };
    socket.write(encodeFrame(past, REQUEST_FRAME_MAX_BYTES));
    await closed;
  });

  it('takes shutdown as the end of that connection alone', async () => {
    await served();
    const { socket, closed } = await dial();
    socket.write(encodeFrame({ kind: 'shutdown' }, REQUEST_FRAME_MAX_BYTES));
    await closed;
    expect(await client().evaluate(evaluation('return 1;'))).toMatchObject({ ok: true });
  });

  it('survives a client that leaves before its answer', async () => {
    await served();
    const { socket, closed } = await dial();
    socket.write(encodeFrame(validRequest(), REQUEST_FRAME_MAX_BYTES));
    socket.destroy();
    await closed;
    expect(await client().evaluate(evaluation('return 2;'))).toMatchObject({ ok: true, value: 2 });
  });

  it('cancels what a connection left waiting when it goes (R005)', async () => {
    const pool = createPool({ size: 1 });
    const submit = vi.spyOn(pool, 'submit');
    const server = await serveCodeRunner({ socketPath, pool });
    closers.push(() => server.close());
    const { socket, closed } = await dial();
    socket.write(encodeFrame(validRequest(), REQUEST_FRAME_MAX_BYTES));
    await expect.poll(() => submit.mock.calls.length).toBe(1);

    socket.destroy();
    await closed;

    const signal = submit.mock.calls[0]?.[1];
    await expect.poll(() => signal?.aborted).toBe(true);
  });

  it('replaces a stale socket file, and lets the worker in', async () => {
    writeFileSync(socketPath, '');
    await served();
    expect(statSync(socketPath).isSocket()).toBe(true);
    expect(statSync(socketPath).mode & 0o666).toBe(0o666);
  });

  it('makes its own pool when none is given', async () => {
    const server = await serveCodeRunner({ socketPath, size: 1 });
    closers.push(() => server.close());
    expect(await client().evaluate(evaluation('return 1;'))).toMatchObject({ ok: true });
  });

  it('takes its socket away on close', async () => {
    const server = await served();
    await server.close();
    expect(() => statSync(socketPath)).toThrow();
  });
});
