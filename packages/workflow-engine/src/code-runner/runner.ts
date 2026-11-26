/**
 * C123.3: the runner's frozen interface. `code-sandbox` builds both forms behind it, and the Evaluate
 * Code action (`api-egress`) reads nothing else: `OPENVERIFY_WORKFLOW_CODE_RUNNER` chooses `pool` or
 * `socket:<path>` (C143.8).
 */
import type { EvaluateCodeErrorCode } from '../actions/evaluate-code.js';
import { createPool } from './pool.js';
import type { CodeRunnerFailureReason } from './protocol.js';
import { createSocketRunner } from './socket-client.js';

/** One evaluation, its input already mapped from the step's `properties` and sized. */
export interface CodeEvaluation {
  /** A child serves one environment at a time (P15). */
  environmentId: string;
  source: string;
  input: Readonly<Record<string, unknown>>;
  /** The step's limits; absent, the defaults of `EVALUATE_CODE_LIMITS`. */
  limits?: { timeMs?: number; memoryBytes?: number };
  /** Only the sandbox test run captures `console` (C120.7). */
  captureConsole?: boolean;
}

export type CodeEvaluationResult =
  | { ok: true; value: unknown; console: readonly string[] }
  | {
      ok: false;
      code: EvaluateCodeErrorCode;
      /** The guest's own text (P18); sealed by the caller, never logged. */
      message: string | null;
      console: readonly string[];
      reason?: CodeRunnerFailureReason;
    };

export interface CodeRunner {
  /** Always answers: a failure of the sandbox is `sandbox_crashed`, never a rejection. */
  evaluate(evaluation: CodeEvaluation): Promise<CodeEvaluationResult>;
  close(): Promise<void>;
}

export interface CodeRunnerPoolOptions {
  /** `max(1, CPUs - 1)` when absent (C123.5). */
  size?: number;
}

/** The pool of child processes (C123.3). */
export const createCodeRunnerPool: (options?: CodeRunnerPoolOptions) => CodeRunner = (options) =>
  createPool(options);

/** The container form, over a Unix socket on a shared volume (C123.3, P17). */
export const connectCodeRunner: (socketPath: string) => CodeRunner = (socketPath) =>
  createSocketRunner(socketPath);
