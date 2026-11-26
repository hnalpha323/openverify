/**
 * A small driver for the golden graphs (C117.1): it plays the executor, finishing each ready step as
 * a script says, so a test reads as what a run does. It round-trips the state through JSON at every
 * advance, because that is what the executor's sealed columns do.
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import type { JsonRecord, JsonValue } from '../expressions/json.js';
import { advance, startRun, stepKey, type AdvanceContext, type RunSeed } from './advance.js';
import type { AdvanceResult, ExecutedStep, ReadyStep, RunState, StepCompletion } from './state.js';

export const NOW = '2026-10-20T12:00:00.000Z';

export const SEED: RunSeed = {
  trigger: {
    id: 'inq_1',
    status: 'completed',
    tags: ['vip', 'beta', 'new'],
    score: 7,
    none: null,
    who: 'Ada',
  },
  inputs: { code: 'x' },
  currentRun: { id: 'wfr_1' },
  now: NOW,
};

export type Script = Readonly<
  Record<
    string,
    | JsonValue
    | { readonly fail: string }
    | { readonly timeout: JsonValue }
    | ((call: number) => JsonValue | { readonly fail: string })
  >
>;

export interface Trace {
  /** Every step that ran, in order, by key: effectful and control-flow alike. */
  readonly steps: readonly string[];
  /** Effectful steps still ready or waiting when the script ran out. */
  readonly pending: readonly string[];
  readonly state: RunState;
  readonly executed: readonly ExecutedStep[];
}

const isFailure = (value: unknown): value is { readonly fail: string } =>
  typeof value === 'object' && value !== null && 'fail' in value;

const isTimeout = (value: unknown): value is { readonly timeout: JsonValue } =>
  typeof value === 'object' && value !== null && 'timeout' in value;

const roundTrip = (state: RunState): RunState => JSON.parse(JSON.stringify(state)) as RunState;

function completionOf(step: ReadyStep, scripted: Script[string] | undefined): StepCompletion {
  const { nodeId, iterationPath } = step;
  if (isFailure(scripted)) {
    return { kind: 'step', nodeId, iterationPath, outcome: 'failed', code: scripted.fail };
  }
  if (isTimeout(scripted)) {
    return { kind: 'step', nodeId, iterationPath, outcome: 'timed_out', output: scripted.timeout };
  }
  return {
    kind: 'step',
    nodeId,
    iterationPath,
    outcome: 'succeeded',
    output: (scripted ?? { ok: true }) as JsonValue,
  };
}

/** Plays `script` to its end, breadth first. An absent key answers `{ ok: true }`. */
export function drive(
  definition: WorkflowDefinition,
  script: Script = {},
  context: AdvanceContext = {},
  options: {
    readonly hold?: readonly string[];
    readonly seed?: Partial<RunSeed>;
    readonly from?: AdvanceResult;
  } = {},
): Trace {
  const steps: string[] = [];
  const executed: ExecutedStep[] = [];
  const calls = new Map<string, number>();
  const hold = new Set(options.hold ?? []);
  const take = (result: AdvanceResult): RunState => {
    for (const step of result.executed) {
      if (step.status === 'succeeded') {
        steps.push(stepKey(step.iterationPath, step.nodeId));
      }
      executed.push(step);
    }
    return roundTrip(result.nextState);
  };
  let result = options.from ?? startRun(definition, { ...SEED, ...options.seed }, context);
  let state = take(result);
  let queue: ReadyStep[] = [...result.stepsToMakeReady];
  const pending: string[] = [];
  for (let step = queue.shift(); step !== undefined; step = queue.shift()) {
    const key = stepKey(step.iterationPath, step.nodeId);
    if (hold.has(key) || hold.has(step.nodeId)) {
      pending.push(key);
      continue;
    }
    steps.push(key);
    const call = (calls.get(key) ?? 0) + 1;
    calls.set(key, call);
    const scripted = script[key] ?? script[step.nodeId];
    const answer = typeof scripted === 'function' ? scripted(call) : scripted;
    const completion: StepCompletion =
      step.kind === 'module'
        ? { kind: 'module-started', nodeId: step.nodeId, iterationPath: step.iterationPath }
        : completionOf(step, answer);
    result = advance(definition, state, completion, context);
    state = take(result);
    queue = [...queue, ...result.stepsToMakeReady];
  }
  return { steps, pending, state, executed };
}

export const outputOf = (trace: Trace, key: string): JsonValue | undefined => {
  const separator = key.lastIndexOf('/') + 1;
  const path = key.slice(0, separator);
  const node = key.slice(separator);
  return trace.state.outputs[path]?.[node];
};

export type { JsonRecord };
