/**
 * C123.3 (P17): the worker's side of the Unix socket, behind the frozen `CodeRunner` interface. A
 * server is as untrusted as a child, because a compromised child's container sits behind it: its
 * frames are capped before they are buffered, parsed with a depth limit and then with the schemas,
 * and any frame it should not have sent ends the connection. `evaluate` always answers. The
 * connection is made on first use and again after any failure. R005: an evaluation's timer (its
 * limit, the kill grace and the server's queue) ends that evaluation alone with `socket_timeout`,
 * and its late answer is dropped; the server answers `runner_busy` at once when its pool is full.
 */
import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { EVALUATE_CODE_LIMITS } from '../actions/evaluate-code.js';
import { RESPONSE_FRAME_MAX_DEPTH, crashedResult, type Schedule } from './child-process.js';
import { FrameReader, FrameViolation, encodeFrame, parseFrame, truncateUtf8 } from './frames.js';
import { prepareEvaluateRequest, type EvaluateRequest } from './limits.js';
import { resolveRunnerPaths } from './paths.js';
import {
  REQUEST_FRAME_MAX_BYTES,
  RESPONSE_FRAME_MAX_BYTES,
  codeRunnerSocketResponseSchema,
  type CodeRunnerFailureReason,
  type CodeRunnerSocketResponse,
} from './protocol.js';
import type { CodeEvaluation, CodeEvaluationResult, CodeRunner } from './runner.js';

/** Ours, provisional: what a healthy server needs to answer the handshake. */
const CONNECT_TIMEOUT_MS = 5_000;
/** Ours, provisional: the server's queue, past the kill the server should already have made. */
const ANSWER_MARGIN_MS = 30_000;
/**
 * Ours, provisional (R005): evaluations that timed out and whose answers may still come. A server
 * that leaves this many unanswered is not serving, so the connection ends and the next one starts.
 */
const ABANDONED_MAX = 64;

/** What the tests change; production passes none of it. */
export interface SocketInternals {
  label?: string;
  connectTimeoutMs?: number;
  answerMarginMs?: number;
  abandonedMax?: number;
  schedule?: Schedule;
}

/** How a connection is made: the socket path, or C263.6's TCP target with its token frame. */
interface Dial {
  connect: () => Socket;
  preamble: Buffer | null;
}

interface Waiting {
  lines: string[];
  settle: (result: CodeEvaluationResult) => void;
  cancelTimer: () => void;
}

const REFUSED_INPUT: CodeEvaluationResult = {
  ok: false,
  code: 'runtime_error',
  message: null,
  console: [],
  reason: 'input_refused',
};

const refSchedule: Schedule = (run, delayMs) => {
  const timer = setTimeout(run, delayMs);
  return () => {
    clearTimeout(timer);
  };
};

class Connection {
  /** `null` once the handshake passed, or why it did not. */
  readonly ready: Promise<CodeRunnerFailureReason | null>;
  ended = false;

  private readonly socket: Socket;
  private readonly reader = new FrameReader(RESPONSE_FRAME_MAX_BYTES);
  private readonly waiting = new Map<string, Waiting>();
  /** R005: timed-out evaluations, by id, with the console lines their late answer brought. */
  private readonly abandoned = new Map<string, number>();
  private settleReady!: (failure: CodeRunnerFailureReason | null) => void;
  private shaken = false;
  private readonly cancelConnect: () => void;

  constructor(
    dial: Dial,
    private readonly options: Required<SocketInternals>,
  ) {
    this.ready = new Promise((resolve) => {
      this.settleReady = resolve;
    });
    this.cancelConnect = options.schedule(() => {
      this.end('handshake_timeout');
    }, options.connectTimeoutMs);
    this.socket = dial.connect();
    // C263.6: the tcp: transport proves its token first; the server answers ready only after it.
    if (dial.preamble !== null) this.socket.write(dial.preamble);
    this.socket.on('error', () => {
      this.end(this.shaken ? 'socket_closed' : 'socket_unavailable');
    });
    this.socket.on('close', () => {
      this.end(this.shaken ? 'socket_closed' : 'socket_unavailable');
    });
    this.socket.on('data', (chunk) => {
      this.onChunk(chunk);
    });
  }

  send(request: EvaluateRequest): Promise<CodeEvaluationResult> {
    if (this.ended) return Promise.resolve(crashedResult('socket_closed'));
    return new Promise((settle) => {
      const answerAfterMs =
        request.limits['time-ms'] +
        EVALUATE_CODE_LIMITS['kill-grace-ms'].value +
        this.options.answerMarginMs;
      const cancelTimer = this.options.schedule(() => {
        this.timeOut(request.id);
      }, answerAfterMs);
      this.waiting.set(request.id, { lines: [], settle, cancelTimer });
      this.socket.write(encodeFrame(request, REQUEST_FRAME_MAX_BYTES));
    });
  }

  /** Whatever went wrong: answer everything that waits, then drop the socket. */
  end(reason: CodeRunnerFailureReason): void {
    if (this.ended) return;
    this.ended = true;
    this.cancelConnect();
    this.settleReady(reason);
    for (const waiting of this.waiting.values()) {
      waiting.cancelTimer();
      waiting.settle(crashedResult(reason));
    }
    this.waiting.clear();
    this.socket.destroy();
  }

  /**
   * R005: one evaluation's timer ends that evaluation alone; the others on the connection go on, and
   * its late answer is dropped when it comes.
   */
  private timeOut(id: string): void {
    const waiting = this.waiting.get(id);
    if (waiting === undefined) return;
    this.waiting.delete(id);
    if (this.abandoned.size >= this.options.abandonedMax) {
      waiting.settle(crashedResult('socket_timeout'));
      this.end('socket_timeout');
      return;
    }
    this.abandoned.set(id, 0);
    waiting.settle(crashedResult('socket_timeout'));
  }

  /** A frame for a timed-out evaluation: dropped, its console still capped. */
  private onAbandoned(frame: Exclude<CodeRunnerSocketResponse, { kind: 'ready' }>): boolean {
    if (frame.kind !== 'console') {
      this.abandoned.delete(frame.id);
      return true;
    }
    const lines = (this.abandoned.get(frame.id) ?? 0) + 1;
    if (lines > EVALUATE_CODE_LIMITS['console-lines'].value) {
      this.end('frame_unexpected');
      return false;
    }
    this.abandoned.set(frame.id, lines);
    return true;
  }

  private onChunk(chunk: Buffer): void {
    try {
      for (const frame of this.reader.push(chunk)) {
        const parsed = codeRunnerSocketResponseSchema.safeParse(
          parseFrame(frame, RESPONSE_FRAME_MAX_DEPTH),
        );
        if (!parsed.success) throw new FrameViolation('frame_malformed');
        if (!this.onFrame(parsed.data)) return;
      }
    } catch (error) {
      if (!(error instanceof FrameViolation)) throw error;
      this.end(error.reason);
    }
  }

  /** Whether the server may go on. */
  private onFrame(frame: CodeRunnerSocketResponse): boolean {
    if (frame.kind === 'ready') return this.onReady(frame.variant);
    if (this.shaken && this.abandoned.has(frame.id)) return this.onAbandoned(frame);
    const waiting = this.waiting.get(frame.id);
    if (!this.shaken || waiting === undefined) {
      this.end('frame_unexpected');
      return false;
    }
    switch (frame.kind) {
      case 'console':
        if (waiting.lines.length >= EVALUATE_CODE_LIMITS['console-lines'].value) {
          this.end('frame_unexpected');
          return false;
        }
        waiting.lines.push(frame.line);
        return true;
      case 'value':
        this.finish(frame.id, waiting, { ok: true, value: frame.value, console: waiting.lines });
        return true;
      case 'error':
        this.finish(frame.id, waiting, {
          ok: false,
          code: frame.code,
          message:
            frame.message === null
              ? null
              : truncateUtf8(frame.message, EVALUATE_CODE_LIMITS['error-message-bytes'].value),
          console: waiting.lines,
        });
        return true;
      case 'crashed':
        this.finish(frame.id, waiting, crashedResult(frame.reason));
        return true;
    }
  }

  private onReady(variant: string): boolean {
    if (this.shaken) {
      this.end('frame_unexpected');
      return false;
    }
    if (variant !== this.options.label) {
      this.end('handshake_refused');
      return false;
    }
    this.shaken = true;
    this.cancelConnect();
    this.settleReady(null);
    return true;
  }

  private finish(id: string, waiting: Waiting, result: CodeEvaluationResult): void {
    waiting.cancelTimer();
    this.waiting.delete(id);
    waiting.settle(result);
  }
}

class SocketCodeRunner implements CodeRunner {
  private readonly options: Required<SocketInternals>;
  private connection: Connection | null = null;
  private closed = false;

  constructor(
    private readonly dial: Dial,
    internals: SocketInternals,
  ) {
    this.options = {
      label: internals.label ?? resolveRunnerPaths().label,
      connectTimeoutMs: internals.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
      answerMarginMs: internals.answerMarginMs ?? ANSWER_MARGIN_MS,
      abandonedMax: internals.abandonedMax ?? ABANDONED_MAX,
      schedule: internals.schedule ?? refSchedule,
    };
  }

  async evaluate(evaluation: CodeEvaluation): Promise<CodeEvaluationResult> {
    const request = prepareEvaluateRequest(evaluation, randomUUID());
    if (request === null) return REFUSED_INPUT;
    if (this.closed) return crashedResult('runner_closed');
    const connection = this.connected();
    const failed = await connection.ready;
    return failed === null ? connection.send(request) : crashedResult(failed);
  }

  close(): Promise<void> {
    this.closed = true;
    this.connection?.end('runner_closed');
    return Promise.resolve();
  }

  private connected(): Connection {
    if (this.connection === null || this.connection.ended) {
      this.connection = new Connection(this.dial, this.options);
    }
    return this.connection;
  }
}

export const createSocketRunner = (
  socketPath: string,
  internals: SocketInternals = {},
): CodeRunner =>
  new SocketCodeRunner({ connect: () => connect(socketPath), preamble: null }, internals);

/**
 * C263.6 (Phase 11, Workflow 11C): the same client over TCP. Its first frame carries the token
 * (`{kind: 'auth', token}`), which never appears in a result or an error; the server, as untrusted
 * as over the socket, says `ready` only after it.
 */
export const createTcpRunner = (
  target: { host: string; port: number; token: string },
  internals: SocketInternals = {},
): CodeRunner =>
  new SocketCodeRunner(
    {
      connect: () => connect({ host: target.host, port: target.port }),
      preamble: encodeFrame({ kind: 'auth', token: target.token }, REQUEST_FRAME_MAX_BYTES),
    },
    internals,
  );
