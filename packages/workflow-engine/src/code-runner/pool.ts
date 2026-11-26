/**
 * C123.3, C123.5: the pool of child processes. A child serves one environment at a time and is
 * recycled when the next evaluation belongs to another, after `evaluations-per-child`, and after any
 * interrupt, out-of-memory, stack overflow, crash or framing error (P15). Evaluations are served
 * first come, first served, and `evaluate` always answers: a failure of the sandbox is
 * `sandbox_crashed`, never a rejection.
 *
 * The environment's budget per minute (C143.3, `workflow-code`) is the action's, because it needs
 * Valkey; the pool bounds what runs at once.
 */
import { randomUUID } from 'node:crypto';
import { EVALUATE_CODE_LIMITS, type EvaluateCodeErrorCode } from '../actions/evaluate-code.js';
import {
  RunnerChild,
  crashedResult,
  type ChildPlan,
  type PoolEvent,
  type Schedule,
} from './child-process.js';
import { defaultPoolSize, prepareEvaluateRequest, type EvaluateRequest } from './limits.js';
import { childArgumentsOf, resolveRunnerPaths } from './paths.js';
import type {
  CodeEvaluation,
  CodeEvaluationResult,
  CodeRunner,
  CodeRunnerPoolOptions,
} from './runner.js';

export type { ChildPlan, PoolEvent, Schedule } from './child-process.js';

/** Ours, provisional: a loaded host can take seconds to start Node and compile the `.wasm`. */
const CHILD_START_TIMEOUT_MS = 20_000;

/** An evaluation that ended so leaves a child nobody should reuse. */
const RECYCLED_CODES: ReadonlySet<EvaluateCodeErrorCode> = new Set([
  'timeout',
  'memory_limit',
  'stack_overflow',
  'sandbox_crashed',
]);

/** What the tests change; production passes none of it. */
export interface PoolInternals {
  plan?: ChildPlan;
  evaluationsPerChild?: number;
  startTimeoutMs?: number;
  /** R005: how many evaluations may wait for a child; past it, `runner_busy` at once. */
  maxWaiting?: number;
  schedule?: Schedule;
  observe?: (event: PoolEvent) => void;
}

const REFUSED_INPUT: CodeEvaluationResult = {
  ok: false,
  code: 'runtime_error',
  message: null,
  console: [],
  reason: 'input_refused',
};

const unrefSchedule: Schedule = (run, delayMs) => {
  const timer = setTimeout(run, delayMs);
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
};

function defaultPlan(): ChildPlan {
  const paths = resolveRunnerPaths();
  return { args: childArgumentsOf(paths), label: paths.label };
}

interface Job {
  request: EvaluateRequest;
  answer: (result: CodeEvaluationResult) => void;
  /** Stops listening for the caller's cancellation, once a child took the job. */
  detach: () => void;
}

export class CodeRunnerPool implements CodeRunner {
  /** The variant a child's handshake must name, which the container's handshake repeats. */
  readonly label: string;

  private readonly size: number;
  private readonly plan: ChildPlan;
  private readonly evaluationsPerChild: number;
  private readonly maxWaiting: number;
  private readonly startTimeoutMs: number;
  private readonly schedule: Schedule;
  private readonly observe: (event: PoolEvent) => void;

  private readonly waiting: Job[] = [];
  private readonly idle = new Set<RunnerChild>();
  private readonly busy = new Set<RunnerChild>();
  private readonly leaving = new Set<RunnerChild>();
  private closed = false;

  constructor(options: CodeRunnerPoolOptions, internals: PoolInternals) {
    this.size = Math.max(1, options.size ?? defaultPoolSize());
    this.plan = internals.plan ?? defaultPlan();
    this.label = this.plan.label;
    this.evaluationsPerChild =
      internals.evaluationsPerChild ?? EVALUATE_CODE_LIMITS['evaluations-per-child'].value;
    this.maxWaiting =
      internals.maxWaiting ?? this.size * EVALUATE_CODE_LIMITS['waiting-per-child'].value;
    this.startTimeoutMs = internals.startTimeoutMs ?? CHILD_START_TIMEOUT_MS;
    this.schedule = internals.schedule ?? unrefSchedule;
    this.observe = internals.observe ?? (() => undefined);
  }

  evaluate(evaluation: CodeEvaluation): Promise<CodeEvaluationResult> {
    const request = prepareEvaluateRequest(evaluation, randomUUID());
    return request === null ? Promise.resolve(REFUSED_INPUT) : this.submit(request);
  }

  /**
   * The container's way in: a request off a frame, already checked. R005: `cancelled` is its
   * connection's; a job still waiting when it aborts never reaches a child.
   */
  submit(request: EvaluateRequest, cancelled?: AbortSignal): Promise<CodeEvaluationResult> {
    if (this.closed) return Promise.resolve(crashedResult('runner_closed'));
    if (cancelled?.aborted === true) return Promise.resolve(crashedResult('socket_closed'));
    // R005: past the list a caller would wait longer than its own timer; nothing ran, so a retry
    // may find room, and the caller learns it at once instead of at its timeout.
    if (this.waiting.length >= this.maxWaiting) {
      return Promise.resolve(crashedResult('runner_busy'));
    }
    return new Promise((answer) => {
      const onCancel = (): void => {
        const index = this.waiting.indexOf(job);
        if (index !== -1) {
          this.waiting.splice(index, 1);
          answer(crashedResult('socket_closed'));
        }
      };
      const job: Job = {
        request,
        answer,
        detach: () => {
          cancelled?.removeEventListener('abort', onCancel);
        },
      };
      cancelled?.addEventListener('abort', onCancel, { once: true });
      this.waiting.push(job);
      this.dispatch();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.waiting.splice(0)) {
      job.detach();
      job.answer(crashedResult('runner_closed'));
    }
    const children = [...this.idle, ...this.busy, ...this.leaving];
    for (const child of children) child.end('runner_closed');
    await Promise.all(children.map((child) => child.exited));
  }

  private dispatch(): void {
    for (;;) {
      const job = this.waiting[0];
      if (job === undefined) return;
      const child = this.childFor(job.request['environment-id']);
      if (child === null) return;
      this.waiting.shift();
      job.detach();
      this.idle.delete(child);
      this.busy.add(child);
      void this.serve(child, job);
    }
  }

  /** The environment's own child, then a fresh one, then a new or a recycled slot. */
  private childFor(environmentId: string): RunnerChild | null {
    const idle = [...this.idle].filter((child) => child.alive);
    const bound =
      idle.find((child) => child.environmentId === environmentId) ??
      idle.find((child) => child.environmentId === null);
    if (bound !== undefined) {
      bound.environmentId = environmentId;
      return bound;
    }
    const other = idle[0];
    if (this.idle.size + this.busy.size >= this.size) {
      if (other === undefined) return null;
      this.idle.delete(other);
      this.retire(other);
    }
    const child = this.spawn();
    child.environmentId = environmentId;
    return child;
  }

  private spawn(): RunnerChild {
    const child = new RunnerChild({
      plan: this.plan,
      startTimeoutMs: this.startTimeoutMs,
      schedule: this.schedule,
      observe: this.observe,
    });
    this.idle.add(child);
    void child.exited.then(() => {
      this.idle.delete(child);
      this.leaving.delete(child);
    });
    return child;
  }

  private retire(child: RunnerChild): void {
    this.leaving.add(child);
    child.retire();
  }

  private async serve(child: RunnerChild, job: Job): Promise<void> {
    const failed = await child.ready;
    const result = failed === null ? await child.run(job.request) : crashedResult(failed);
    child.served += 1;
    this.busy.delete(child);
    if (!child.gone) {
      if (!child.alive) this.leaving.add(child);
      else if (this.recycles(child, result)) this.retire(child);
      else this.idle.add(child);
    }
    job.answer(result);
    this.dispatch();
  }

  private recycles(child: RunnerChild, result: CodeEvaluationResult): boolean {
    return (
      child.served >= this.evaluationsPerChild || (!result.ok && RECYCLED_CODES.has(result.code))
    );
  }
}

export const createPool = (
  options: CodeRunnerPoolOptions = {},
  internals: PoolInternals = {},
): CodeRunnerPool => new CodeRunnerPool(options, internals);
