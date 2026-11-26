/**
 * C123.3 (P17): the container's side of the Unix socket. The `code-runner` service holds no network,
 * no secret and a read-only root, and serves the same frames and the same child pool as the worker
 * would. The worker holds the keys, so nothing it sends is executed outside a child, and a
 * connection that sends a frame the contract refuses is dropped.
 *
 * The socket file is world-writable because the worker runs under another user: what guards it is
 * the shared volume, which only the worker and this service mount (`docs/workflows/`).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { chmod, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { FrameReader, FrameViolation, encodeFrame, parseFrame } from './frames.js';
import { evaluateRequestAllowed, type EvaluateRequest } from './limits.js';
import { createPool, type CodeRunnerPool } from './pool.js';
import {
  CHILD_REPORTED_ERROR_CODES,
  CODE_RUNNER_PROTOCOL_VERSION,
  FRAME_HEADER_BYTES,
  REQUEST_FRAME_MAX_BYTES,
  RESPONSE_FRAME_MAX_BYTES,
  codeRunnerRequestSchema,
  type CodeRunnerSocketResponse,
} from './protocol.js';
import type { CodeEvaluationResult } from './runner.js';
import { CODE_RUNNER_TOKEN_MIN_BYTES, CODE_RUNNER_TOKEN_VARIABLE } from './transport.js';

/** The frame, its `limits`: a request holds nothing deeper, its input being text. */
const REQUEST_FRAME_MAX_DEPTH = 2;
const SOCKET_MODE = 0o666;
/** C263.6: the token frame's cap; a token is short text, so nothing larger is buffered first. */
const AUTH_FRAME_MAX_BYTES = 1_024;
/** C263.6, ours, provisional: how long a TCP connection may take to prove its token. */
const AUTH_TIMEOUT_MS = 5_000;

const CHILD_CODES: ReadonlySet<string> = new Set(CHILD_REPORTED_ERROR_CODES);

export interface CodeRunnerServerOptions {
  /** The Unix socket (C123.3); unused when `listen` is set. */
  socketPath?: string;
  /**
   * C263.6 (Phase 11, Workflow 11C): a TCP listener instead of the socket, each connection proving
   * `token` (at least 32 bytes) in its first frame before `ready`.
   */
  listen?: { host: string; port: number; token: string };
  /** The container makes its own; absent, one of `size` children. */
  pool?: CodeRunnerPool;
  size?: number;
}

export interface CodeRunnerServer {
  /** C263.6: the TCP listener's address (its port when 0 was asked for); absent on the socket. */
  address?: { host: string; port: number };
  close(): Promise<void>;
}

const childCode = (code: string): (typeof CHILD_REPORTED_ERROR_CODES)[number] | null =>
  CHILD_CODES.has(code) ? (code as (typeof CHILD_REPORTED_ERROR_CODES)[number]) : null;

function finalFrame(id: string, result: CodeEvaluationResult): CodeRunnerSocketResponse {
  if (result.ok) return { kind: 'value', id, value: result.value as never };
  const code = childCode(result.code);
  return code === null
    ? { kind: 'crashed', id, reason: result.reason ?? 'child_exited' }
    : { kind: 'error', id, code, message: result.message };
}

function writeAnswer(socket: Socket, request: EvaluateRequest, result: CodeEvaluationResult): void {
  if (socket.destroyed) return;
  const { id } = request;
  for (const line of result.console) {
    socket.write(encodeFrame({ kind: 'console', id, line }, RESPONSE_FRAME_MAX_BYTES));
  }
  try {
    socket.write(encodeFrame(finalFrame(id, result), RESPONSE_FRAME_MAX_BYTES));
  } catch (error) {
    if (!(error instanceof FrameViolation)) throw error;
    const frame = { kind: 'crashed', id, reason: error.reason };
    socket.write(encodeFrame(frame, RESPONSE_FRAME_MAX_BYTES));
  }
}

function serveConnection(socket: Socket, pool: CodeRunnerPool): void {
  const reader = new FrameReader(REQUEST_FRAME_MAX_BYTES);
  // R005: what this connection left waiting never reaches a child once it goes.
  const gone = new AbortController();
  socket.on('close', () => {
    gone.abort();
  });
  const onFrame = (bytes: Uint8Array): void => {
    const parsed = codeRunnerRequestSchema.safeParse(parseFrame(bytes, REQUEST_FRAME_MAX_DEPTH));
    if (
      !parsed.success ||
      (parsed.data.kind === 'evaluate' && !evaluateRequestAllowed(parsed.data))
    ) {
      throw new FrameViolation('frame_malformed');
    }
    if (parsed.data.kind === 'shutdown') {
      socket.destroy();
      return;
    }
    const request = parsed.data;
    void pool.submit(request, gone.signal).then((result) => {
      writeAnswer(socket, request, result);
    });
  };
  socket.on('error', () => undefined);
  socket.on('data', (chunk) => {
    try {
      for (const frame of reader.push(chunk)) onFrame(frame);
    } catch (error) {
      if (!(error instanceof FrameViolation)) throw error;
      socket.destroy();
    }
  });
  socket.write(
    encodeFrame(
      { kind: 'ready', protocol: CODE_RUNNER_PROTOCOL_VERSION, variant: pool.label },
      RESPONSE_FRAME_MAX_BYTES,
    ),
  );
}

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * C263.6: a TCP connection's first frame must be `{kind: 'auth', token}` with the shared token,
 * compared in constant time over fixed-length digests, alone in what the client sent (it waits for
 * `ready` before its first request) and within `AUTH_TIMEOUT_MS`. Anything else closes the
 * connection without a word; the token is never logged or echoed.
 */
function gateConnection(socket: Socket, expected: Buffer, serve: () => void): void {
  let received = Buffer.alloc(0);
  const timer = setTimeout(() => {
    socket.destroy();
  }, AUTH_TIMEOUT_MS);
  timer.unref();
  const refuse = (): void => {
    clearTimeout(timer);
    socket.destroy();
  };
  const onData = (chunk: Buffer): void => {
    received = Buffer.concat([received, chunk]);
    if (received.length < FRAME_HEADER_BYTES) return;
    const length = received.readUInt32BE(0);
    if (length === 0 || length > AUTH_FRAME_MAX_BYTES) {
      refuse();
      return;
    }
    if (received.length < FRAME_HEADER_BYTES + length) return;
    socket.off('data', onData);
    if (received.length !== FRAME_HEADER_BYTES + length) {
      refuse();
      return;
    }
    let frame: unknown;
    try {
      frame = parseFrame(received.subarray(FRAME_HEADER_BYTES), 1);
    } catch {
      refuse();
      return;
    }
    const token =
      typeof frame === 'object' && frame !== null && (frame as { kind?: unknown }).kind === 'auth'
        ? (frame as { token?: unknown }).token
        : undefined;
    if (typeof token !== 'string' || !timingSafeEqual(digest(token), expected)) {
      refuse();
      return;
    }
    clearTimeout(timer);
    serve();
  };
  socket.on('error', () => undefined);
  socket.on('data', onData);
}

const closed = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });

export async function serveCodeRunner(options: CodeRunnerServerOptions): Promise<CodeRunnerServer> {
  const { listen, socketPath } = options;
  if (listen === undefined && socketPath === undefined) {
    throw new TypeError('the code runner needs a socket path or a listen address');
  }
  if (
    listen !== undefined &&
    Buffer.byteLength(listen.token, 'utf8') < CODE_RUNNER_TOKEN_MIN_BYTES
  ) {
    throw new TypeError(
      `${CODE_RUNNER_TOKEN_VARIABLE} must be at least ${String(CODE_RUNNER_TOKEN_MIN_BYTES)} bytes`,
    );
  }
  const expected = listen === undefined ? null : digest(listen.token);
  const pool = options.pool ?? createPool(options.size === undefined ? {} : { size: options.size });
  const connections = new Set<Socket>();
  const server = createServer((socket) => {
    connections.add(socket);
    socket.on('close', () => {
      connections.delete(socket);
    });
    if (expected === null) {
      serveConnection(socket, pool);
    } else {
      gateConnection(socket, expected, () => {
        serveConnection(socket, pool);
      });
    }
  });
  if (listen !== undefined) {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(listen.port, listen.host, resolve);
    });
  } else if (socketPath !== undefined) {
    // A file left by a stopped service: only this service binds this path.
    await rm(socketPath, { force: true });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    await chmod(socketPath, SOCKET_MODE);
  }
  const bound = server.address();
  return {
    ...(listen !== undefined && bound !== null && typeof bound === 'object'
      ? { address: { host: bound.address, port: bound.port } }
      : {}),
    close: async () => {
      for (const socket of connections) socket.destroy();
      await Promise.all([closed(server), pool.close()]);
    },
  };
}
