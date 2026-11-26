/**
 * What a run is, to the pure interpreter (plan C117.1, C119): plain JSON, so the executor can seal it
 * and read it back. A key is the node's id behind its iteration path, as `workflow_run_steps` holds
 * them: `loop[3]/send_email`, or `module:checks/tag_it` inside a module (C119.6, C119.8).
 */
import type { JsonRecord, JsonValue } from '../expressions/json.js';

export type StepOutcome = 'succeeded' | 'failed' | 'timed_out';

/** C119.7: a failure that nothing absorbed. `nodeId` is `null` for a whole-run failure. */
export interface StepFailure {
  readonly nodeId: string | null;
  readonly iterationPath: string;
  readonly code: string;
}

/** C119.4: the counter of one parallel, the row each branch's completion decrements. */
export interface JoinState {
  /** Branches still running. */
  readonly open: number;
  /** Branches that ended in a failure nothing absorbed. */
  readonly failed: number;
}

export interface LoopState {
  /** The list, read once when the loop starts; `null` for a `while`. */
  readonly items: readonly JsonValue[] | null;
  /** The next iteration to start. */
  readonly next: number;
  /** Iterations running. */
  readonly open: number;
  readonly failed: number;
  /** Iterations finished. */
  readonly iterations: number;
  /** C119.6: a `map`'s collected values, by iteration. */
  readonly values: Readonly<Record<string, JsonValue>>;
}

export interface ModuleFrame {
  /** C119.8: a module reads its parent only through these. */
  readonly inputs: JsonRecord;
}

export interface RunState {
  readonly status: 'in_progress' | 'completed' | 'errored';
  /** C114.2: the run's clock for this advance, recorded so a resume reads the same value. */
  readonly now: string;
  /** C117.7: step executions so far, loops and retries included. */
  readonly stepExecutions: number;
  readonly trigger: JsonValue;
  readonly inputs: JsonRecord;
  readonly variables: JsonRecord;
  readonly currentRun: JsonRecord;
  readonly currentCase: JsonValue;
  /** Each iteration path's step outputs. */
  readonly outputs: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  readonly joins: Readonly<Record<string, JoinState>>;
  readonly loops: Readonly<Record<string, LoopState>>;
  readonly modules: Readonly<Record<string, ModuleFrame>>;
  /** C119.10: the run's outputs, once its output node ran. */
  readonly runOutputs: JsonRecord;
  /** Failures nothing absorbed, oldest first: what a resume re-readies (C120.3). */
  readonly failures: readonly StepFailure[];
}

/** What just happened to a run. */
export type StepCompletion =
  | { readonly kind: 'start' }
  | {
      readonly kind: 'step';
      readonly nodeId: string;
      readonly iterationPath: string;
      readonly outcome: 'succeeded';
      readonly output: JsonValue;
    }
  | {
      readonly kind: 'step';
      readonly nodeId: string;
      readonly iterationPath: string;
      readonly outcome: 'failed';
      readonly code: string;
    }
  | {
      /** C119.3: a wait's timeout. Its output says `resolved-by: timeout`. */
      readonly kind: 'step';
      readonly nodeId: string;
      readonly iterationPath: string;
      readonly outcome: 'timed_out';
      readonly output: JsonValue;
    }
  | {
      /** C119.8: the executor pinned the module's version and put its definition in the context. */
      readonly kind: 'module-started';
      readonly nodeId: string;
      readonly iterationPath: string;
    }
  | { readonly kind: 'resume' };

/** An effectful node the executor makes ready, and claims (C117.3). */
export type ReadyStep =
  | {
      readonly kind: 'action';
      readonly nodeId: string;
      readonly iterationPath: string;
      readonly actionKey: string;
      readonly actionVersion: number;
    }
  | {
      readonly kind: 'wait-time';
      readonly nodeId: string;
      readonly iterationPath: string;
      readonly seconds: number;
    }
  | {
      readonly kind: 'wait-events';
      readonly nodeId: string;
      readonly iterationPath: string;
      /** C119.3: the subject's object id, plain, because ids are not personal data. */
      readonly correlationKey: string;
      readonly events: readonly string[];
      readonly timeoutSeconds: number;
    }
  | {
      readonly kind: 'module';
      readonly nodeId: string;
      readonly iterationPath: string;
      readonly moduleWorkflowId: string;
      readonly version: string;
    };

/** A control-flow node that ran inside this advance (C117.3), for the step row and the journal. */
export interface ExecutedStep {
  readonly nodeId: string;
  readonly iterationPath: string;
  readonly status: 'succeeded' | 'failed' | 'timed_out';
  readonly output: JsonValue;
  readonly code: string | null;
}

export interface AdvanceResult {
  readonly nextState: RunState;
  readonly stepsToMakeReady: readonly ReadyStep[];
  readonly executed: readonly ExecutedStep[];
}
