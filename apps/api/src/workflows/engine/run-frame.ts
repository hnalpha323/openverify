/**
 * C117.1: how a run's state is kept. Step outputs live on their step rows, sealed; everything else the
 * interpreter holds (join and loop counters, module frames, failures) and what the executor must
 * remember (pinned modules, an action wait's carry, a test run's options) lives in one frame, sealed
 * in the run's `variables` column around the variables themselves. So it is nulled with the run's
 * values and needs no column of its own, and a reader of the variables takes `values`.
 *
 * Every load happens under the run's lock when it will be written back (C117.3).
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import {
  getWorkflowRunVersion,
  listAllWorkflowRunSteps,
  openWorkflowRunValues,
  openWorkflowStepValues,
  type Db,
  type WorkflowRunRow,
  type WorkflowRunStepRow,
} from '@openverify/db';
import {
  readDefinition,
  type JsonRecord,
  type JsonValue,
  type RunState,
} from '@openverify/workflow-engine';

/** C120.7: a test run's request, sealed with the rest of the run. */
export interface TestRunOptions {
  readonly overrides: JsonRecord;
  readonly allowHosts: readonly string[];
  readonly acknowledgements: readonly string[];
  readonly allowTriggers: boolean;
  readonly endStep: string | null;
  /** C120.7: only a user holding `pii:view` may reach a real host. */
  readonly egressAllowed: boolean;
}

/** C127.2: an action that made its object and waits for its events. */
export interface ActionWait {
  readonly timeoutCode: string;
  readonly carry: JsonRecord;
}

export interface RunFrame {
  readonly 'engine-frame': 1;
  readonly values: JsonRecord;
  readonly joins: RunState['joins'];
  readonly loops: RunState['loops'];
  readonly modules: RunState['modules'];
  readonly failures: RunState['failures'];
  readonly currentRun: JsonRecord;
  readonly currentCase: JsonValue;
  /** C119.8: each started module's pinned `wfv_` id, by its iteration path. */
  readonly moduleVersions: Readonly<Record<string, string>>;
  /** By step key. */
  readonly actionWaits: Readonly<Record<string, ActionWait>>;
  /** C120.3: `unknown` effects a resume acknowledged, by effect key. */
  readonly acknowledged: readonly string[];
  readonly test: TestRunOptions | null;
}

export function newFrame(
  values: JsonRecord,
  currentRun: JsonRecord,
  test: TestRunOptions | null = null,
): RunFrame {
  return {
    'engine-frame': 1,
    values,
    joins: {},
    loops: {},
    modules: {},
    failures: [],
    currentRun,
    currentCase: null,
    moduleVersions: {},
    actionWaits: {},
    acknowledged: [],
    test,
  };
}

const isFrame = (value: unknown): value is RunFrame =>
  typeof value === 'object' && value !== null && 'engine-frame' in value;

/** The run's frame; a run's values that are gone read as an empty frame. */
export function frameOf(sealed: unknown): RunFrame {
  return isFrame(sealed) ? sealed : newFrame((sealed ?? {}) as JsonRecord, {});
}

/** C120.6: what `variables` means to a reader. */
export const variablesOf = (sealed: unknown): Record<string, unknown> | null =>
  sealed === null || sealed === undefined ? null : frameOf(sealed).values;

const CACHE_SIZE = 256;
const cache = new Map<string, WorkflowDefinition>();

/** A published version never changes (C116.1), so its parse is kept. A draft is read each time. */
export async function definitionOf(
  db: Db,
  environmentId: string,
  versionId: string,
): Promise<WorkflowDefinition | null> {
  const known = cache.get(versionId);
  if (known !== undefined) {
    return known;
  }
  const version = await getWorkflowRunVersion(db, environmentId, versionId);
  if (version === null) {
    return null;
  }
  const definition = readDefinition(version.definition);
  if (version.status === 'published') {
    if (cache.size >= CACHE_SIZE) {
      const [oldest] = cache.keys();
      if (oldest !== undefined) {
        cache.delete(oldest);
      }
    }
    cache.set(versionId, definition);
  }
  return definition;
}

export interface LoadedRun {
  run: WorkflowRunRow;
  definition: WorkflowDefinition;
  modules: Record<string, WorkflowDefinition>;
  state: RunState;
  frame: RunFrame;
}

/** C117.1: step outputs from their rows, where a failed step that continued reads as `null`. */
function outputsOf(steps: readonly WorkflowRunStepRow[]): RunState['outputs'] {
  const outputs: Record<string, Record<string, JsonValue>> = {};
  for (const step of steps) {
    if (step.status === 'succeeded' || step.status === 'timed_out' || step.status === 'failed') {
      const byNode = (outputs[step.iterationPath] ??= {});
      byNode[step.nodeId] =
        step.status === 'failed'
          ? null
          : ((openWorkflowStepValues(step).output as JsonValue | null) ?? null);
    }
  }
  return outputs;
}

/** @throws {Error} when the version is gone, which a foreign key keeps from happening. */
export async function loadRun(db: Db, run: WorkflowRunRow, now: Date): Promise<LoadedRun> {
  const { environmentId } = run;
  const definition = await definitionOf(db, environmentId, run.workflowVersionId);
  if (definition === null) {
    throw new Error('a run’s version is gone');
  }
  const values = openWorkflowRunValues(run);
  const frame = frameOf(values.variables);
  const modules: Record<string, WorkflowDefinition> = {};
  for (const [path, versionId] of Object.entries(frame.moduleVersions)) {
    const module = await definitionOf(db, environmentId, versionId);
    if (module !== null) {
      modules[path] = module;
    }
  }
  const steps = await listAllWorkflowRunSteps(db, environmentId, run.id);
  const state: RunState = {
    status: 'in_progress',
    now: now.toISOString(),
    stepExecutions: run.stepExecutions,
    trigger: (values.triggerSnapshot ?? null) as JsonValue,
    inputs: (values.inputs ?? {}) as JsonRecord,
    variables: frame.values,
    currentRun: frame.currentRun,
    currentCase: frame.currentCase,
    outputs: outputsOf(steps),
    joins: frame.joins,
    loops: frame.loops,
    modules: frame.modules,
    runOutputs: {},
    failures: frame.failures,
  };
  return { run, definition, modules, state, frame };
}

/** What goes back into the sealed column after an advance. */
export function packFrame(frame: RunFrame, state: RunState): RunFrame {
  return {
    ...frame,
    values: state.variables,
    joins: state.joins,
    loops: state.loops,
    modules: state.modules,
    failures: state.failures,
    currentRun: state.currentRun,
    currentCase: state.currentCase,
  };
}

/** The definition a node at an iteration path belongs to. */
export function definitionAt(loaded: LoadedRun, iterationPath: string): WorkflowDefinition {
  const segments = iterationPath.split('/').filter((segment) => segment !== '');
  let module: string | null = null;
  let prefix = '';
  for (const segment of segments) {
    prefix += `${segment}/`;
    if (segment.startsWith('module:')) {
      module = prefix;
    }
  }
  return module === null ? loaded.definition : (loaded.modules[module] ?? loaded.definition);
}
