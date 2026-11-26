/**
 * C123.3 (P16): one child process, seen from the parent. A child is compromised until proved
 * otherwise: it has no Node IPC channel, its frames are capped before they are buffered, parsed with
 * a depth limit and then with the frozen schemas, and any frame it should not have sent ends it. The
 * parent kills it with `SIGKILL` at the step's limit plus the grace, whatever the guest does.
 *
 * Nothing here logs and no error holds a frame's bytes: a frame can carry what a guest wrote (P18).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { EVALUATE_CODE_LIMITS } from '../actions/evaluate-code.js';
import { FrameReader, FrameViolation, encodeFrame, parseFrame, truncateUtf8 } from './frames.js';
import type { EvaluateRequest } from './limits.js';
import {
  REQUEST_FRAME_MAX_BYTES,
  RESPONSE_FRAME_MAX_BYTES,
  codeRunnerResponseSchema,
  type CodeRunnerFailureReason,
  type CodeRunnerResponse,
} from './protocol.js';
import type { CodeEvaluationResult } from './runner.js';

/** A value's depth, plus the frame around it. */
export const RESPONSE_FRAME_MAX_DEPTH = EVALUATE_CODE_LIMITS['output-depth'].value + 1;

/** What `spawn` runs: the arguments of `childArgumentsOf`, and the variant `ready` must name. */
export interface ChildPlan {
  /** This Node, unless a test says otherwise. */
  command?: string;
  args: readonly string[];
  label: string;
}

export type PoolEvent =
  | { type: 'spawned'; pid: number | undefined }
  | { type: 'killed'; pid: number | undefined }
  | { type: 'exited'; pid: number | undefined; code: number | null; signal: string | null };

export type Schedule = (run: () => void, delayMs: number) => () => void;

export interface ChildOptions {
  plan: ChildPlan;
  startTimeoutMs: number;
  schedule: Schedule;
  observe: (event: PoolEvent) => void;
}

export const crashedResult = (reason: CodeRunnerFailureReason): CodeEvaluationResult => ({
  ok: false,
  code: 'sandbox_crashed',
  message: null,
  console: [],
  reason,
});

interface RunningEvaluation {
  id: string;
  lines: string[];
  settle: (result: CodeEvaluationResult) => void;
  cancelKill: () => void;
}

export class RunnerChild {
  /** `null` once the handshake passed, or why it did not. */
  readonly ready: Promise<CodeRunnerFailureReason | null>;
  readonly exited: Promise<void>;
  /** The environment this child is bound to (P15). */
  environmentId: string | null = null;
  served = 0;

  private readonly process: ChildProcess;
  private readonly requests: Writable | undefined;
  private readonly reader = new FrameReader(RESPONSE_FRAME_MAX_BYTES);
  private state: 'starting' | 'running' | 'gone' = 'starting';
  private killed = false;
  private current: RunningEvaluation | null = null;
  private settleReady!: (failure: CodeRunnerFailureReason | null) => void;
  private settleExited!: () => void;
  private cancelStart: () => void;

  constructor(private readonly options: ChildOptions) {
    this.ready = new Promise((resolve) => {
      this.settleReady = resolve;
    });
    this.exited = new Promise((resolve) => {
      this.settleExited = resolve;
    });
    // No `fork`: it opens the IPC channel P16 refuses. `env: {}` keeps every secret out (C123.3).
    this.process = spawn(options.plan.command ?? process.execPath, options.plan.args, {
      env: {},
      cwd: '/',
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    });
    this.requests = this.process.stdio[3] as Writable | undefined;
    const responses = this.process.stdio[4] as Readable | undefined;
    this.cancelStart = options.schedule(() => {
      this.fail('handshake_timeout');
    }, options.startTimeoutMs);

    this.process.once('error', () => {
      this.fail('spawn_failed');
      this.markExited();
    });
    this.process.once('exit', (code, signal) => {
      options.observe({ type: 'exited', pid: this.process.pid, code, signal });
      this.onExit();
    });
    // A write to a dead child: its exit answers the evaluation.
    this.requests?.on('error', () => undefined);
    responses?.on('error', () => undefined);
    responses?.on('data', (chunk: Buffer) => {
      this.onChunk(chunk);
    });
    options.observe({ type: 'spawned', pid: this.process.pid });
  }

  /** The process has ended. */
  get gone(): boolean {
    return this.state === 'gone';
  }

  /** Whether another evaluation may be sent. */
  get alive(): boolean {
    return !this.killed && this.state !== 'gone';
  }

  /** Sends one request. The caller waits for `ready` and sends one at a time. */
  run(request: EvaluateRequest): Promise<CodeEvaluationResult> {
    if (!this.alive) return Promise.resolve(crashedResult('child_exited'));
    let frame: Buffer;
    try {
      frame = encodeFrame(request, REQUEST_FRAME_MAX_BYTES);
    } catch {
      return Promise.resolve(crashedResult('frame_too_large'));
    }
    return new Promise((settle) => {
      const killAfterMs = request.limits['time-ms'] + EVALUATE_CODE_LIMITS['kill-grace-ms'].value;
      const cancelKill = this.options.schedule(() => {
        this.onDeadline();
      }, killAfterMs);
      this.current = { id: request.id, lines: [], settle, cancelKill };
      this.requests?.write(frame);
    });
  }

  /** Ends a child that did nothing wrong: it may leave by itself, and the grace still applies. */
  retire(): void {
    if (this.state === 'gone') return;
    this.requests?.write(encodeFrame({ kind: 'shutdown' }, REQUEST_FRAME_MAX_BYTES));
    const cancel = this.options.schedule(() => {
      this.kill();
    }, EVALUATE_CODE_LIMITS['kill-grace-ms'].value);
    void this.exited.then(cancel);
  }

  /** Ends this child now. A running evaluation is answered with `reason`. */
  end(reason: CodeRunnerFailureReason): void {
    this.fail(reason);
  }

  private kill(): void {
    if (this.killed || this.state === 'gone') return;
    this.killed = true;
    if (this.process.kill('SIGKILL')) {
      this.options.observe({ type: 'killed', pid: this.process.pid });
    }
  }

  private onDeadline(): void {
    const running = this.current;
    if (running === null) return;
    this.current = null;
    this.kill();
    running.settle({ ok: false, code: 'timeout', message: null, console: running.lines });
  }

  private onChunk(chunk: Buffer): void {
    try {
      for (const frame of this.reader.push(chunk)) {
        const parsed = codeRunnerResponseSchema.safeParse(
          parseFrame(frame, RESPONSE_FRAME_MAX_DEPTH),
        );
        if (!parsed.success) throw new FrameViolation('frame_malformed');
        if (!this.onFrame(parsed.data)) return;
      }
    } catch (error) {
      if (!(error instanceof FrameViolation)) throw error;
      this.fail(error.reason);
    }
  }

  /** Whether the child may go on. */
  private onFrame(frame: CodeRunnerResponse): boolean {
    if (frame.kind === 'ready') return this.onReady(frame.variant);
    const running = this.current;
    if (this.state !== 'running' || running?.id !== frame.id) {
      this.fail('frame_unexpected');
      return false;
    }
    switch (frame.kind) {
      case 'console':
        if (running.lines.length >= EVALUATE_CODE_LIMITS['console-lines'].value) {
          this.fail('frame_unexpected');
          return false;
        }
        running.lines.push(frame.line);
        return true;
      case 'value':
        this.finish(running, { ok: true, value: frame.value, console: running.lines });
        return true;
      case 'error':
        this.finish(running, {
          ok: false,
          code: frame.code,
          message:
            frame.message === null
              ? null
              : truncateUtf8(frame.message, EVALUATE_CODE_LIMITS['error-message-bytes'].value),
          console: running.lines,
        });
        return true;
    }
  }

  private onReady(variant: string): boolean {
    if (this.state !== 'starting') {
      this.fail('frame_unexpected');
      return false;
    }
    if (variant !== this.options.plan.label) {
      this.fail('handshake_refused');
      return false;
    }
    this.cancelStart();
    this.state = 'running';
    this.settleReady(null);
    return true;
  }

  private finish(running: RunningEvaluation, result: CodeEvaluationResult): void {
    running.cancelKill();
    this.current = null;
    running.settle(result);
  }

  /** Whatever went wrong: answer what waits, then the kill. */
  private fail(reason: CodeRunnerFailureReason): void {
    this.cancelStart();
    this.kill();
    this.settleReady(reason);
    const running = this.current;
    if (running !== null) this.finish(running, crashedResult(reason));
  }

  private onExit(): void {
    this.fail('child_exited');
    this.markExited();
  }

  private markExited(): void {
    this.state = 'gone';
    this.settleExited();
  }
}
