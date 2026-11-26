/**
 * C128.1, C128.2: what a run knows of its own decision, read from the path actually executed: the
 * routes it took, the digest of each condition and Evaluate Code source they depended on, and whether
 * a person took part. `solely-automated` is `false` only for a wait resolved, not timed out, singly by
 * a user who held `inquiries:write`, on a case holding the subject, whose resolution the route taken
 * read. A manual, CSV, API or case-action start is no person, nor is a bulk action, a key or a run.
 */
import { createHash } from 'node:crypto';
import type { WorkflowDefinition } from '@openverify/contracts';
import type { Db, DecisionEvidence, DecisionHumanStep, DecisionRunFacts } from '@openverify/db';
import {
  HUMAN_STEP_ENTRIES,
  canonicalJson,
  conditionalsReading,
  createHumanStepTable,
  humanStepOf,
  isJsonRecord,
  type JsonValue,
  type RunState,
} from '@openverify/workflow-engine';
import type { RunDecisionFacts } from '../../../services/decisions/record.js';
import type { ActionContext } from '../../engine/action-port.js';
import { CASE_HOLDS_SUBJECT, type CaseHoldsSubject } from './case-holds.js';

const HUMAN_STEPS = createHumanStepTable(HUMAN_STEP_ENTRIES);

interface ExecutedOutput {
  nodeId: string;
  output: JsonValue;
}

/** Every step output so far, at every iteration path. */
export function executedOutputs(state: Pick<RunState, 'outputs'>): ExecutedOutput[] {
  return Object.values(state.outputs).flatMap((outputs) =>
    Object.entries(outputs).map(([nodeId, output]) => ({ nodeId, output })),
  );
}

const digest = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

/** C128.1: the routes taken, and each condition read to reach them, the taken one included. */
export function routesOf(
  definition: WorkflowDefinition,
  state: Pick<RunState, 'outputs'>,
): Pick<DecisionRunFacts, 'routes' | 'conditionSha256' | 'codeSha256'> {
  const routes: { nodeId: string; routeKey: string }[] = [];
  const conditionSha256 = new Set<string>();
  const codeSha256 = new Set<string>();
  for (const { nodeId, output } of executedOutputs(state)) {
    if (isJsonRecord(output) && typeof output['source-sha256'] === 'string') {
      codeSha256.add(output['source-sha256']);
    }
    const step = definition.steps.find(({ id }) => id === nodeId);
    if (step?.type === 'conditional' && isJsonRecord(output) && typeof output.route === 'string') {
      routes.push({ nodeId, routeKey: output.route });
      for (const { key, condition } of step.routes) {
        // A route without a condition is a catch-all: it reads nothing, so it adds no digest.
        if (condition !== undefined) {
          conditionSha256.add(digest(condition));
        }
        if (key === output.route) {
          break;
        }
      }
    }
  }
  return { routes, conditionSha256: [...conditionSha256], codeSha256: [...codeSha256] };
}

/** C128.2: the person on the path actually executed, or `null`. */
export async function humanStepOnPath(
  tx: Db,
  definition: WorkflowDefinition,
  state: Pick<RunState, 'outputs'>,
  input: { environmentId: string; subjectId: string },
  caseHolds: CaseHoldsSubject = CASE_HOLDS_SUBJECT,
): Promise<DecisionHumanStep | null> {
  const outputs = executedOutputs(state);
  const ran = new Set(outputs.map(({ nodeId }) => nodeId));
  for (const { nodeId, output } of outputs) {
    const step = definition.steps.find(({ id }) => id === nodeId);
    const human = step?.type === 'wait' ? humanStepOf(HUMAN_STEPS, output) : null;
    if (
      human !== null &&
      conditionalsReading(definition, nodeId).some((reader) => ran.has(reader)) &&
      (await caseHolds(tx, { ...input, eventId: human['event-id'] }))
    ) {
      return {
        kind: human.kind,
        actorId: human['actor-id'],
        eventId: human['event-id'],
        resolvedVia: human['resolved-via'],
        nodeId,
      };
    }
  }
  return null;
}

/** C128.1 (H10): what the run itself read of a heuristic, with its tier, stage and confidence. */
export function runEvidenceOf(state: Pick<RunState, 'outputs'>): DecisionEvidence[] {
  return executedOutputs(state).flatMap(({ nodeId, output }) => {
    // C127.10 (H21): a Calculate that fell back on its default.
    if (isJsonRecord(output) && output.defaulted === true) {
      const evidence: DecisionEvidence = {
        kind: 'step',
        id: null,
        name: nodeId,
        status: 'defaulted',
        tier: 'R',
        stage: 'ga',
        confidence: null,
      };
      return [evidence];
    }
    const matches = isJsonRecord(output) ? output.matches : undefined;
    if (!Array.isArray(matches)) {
      return [];
    }
    return matches.flatMap((match): DecisionEvidence[] => {
      if (!isJsonRecord(match)) {
        return [];
      }
      const item = match['list-item-id'];
      const { id, method, tier, stage, confidence } = match;
      return [
        {
          kind: typeof item === 'string' ? 'list-item' : 'report-match',
          id: typeof item === 'string' ? item : typeof id === 'string' ? id : null,
          name: typeof method === 'string' ? method : null,
          status: null,
          tier: typeof tier === 'string' ? tier : 'H',
          stage: typeof stage === 'string' ? stage : 'beta',
          confidence: typeof confidence === 'number' ? confidence : null,
        },
      ];
    });
  });
}

export interface DeclaredBasis {
  'decision-basis'?: RunDecisionFacts['decisionBasis'] | undefined;
  'contest-route'?: Record<string, unknown> | undefined;
  'biometric-basis'?: RunDecisionFacts['biometricBasis'] | undefined;
}

/** A run's facts about one decision on `subjectId`. */
export async function runDecisionFactsOf(
  tx: Db,
  context: ActionContext,
  subjectId: string,
  declared: DeclaredBasis = {},
  caseHolds?: CaseHoldsSubject,
): Promise<RunDecisionFacts> {
  const { definition, state, environmentId } = context;
  const humanStep = await humanStepOnPath(
    tx,
    definition,
    state,
    { environmentId, subjectId },
    caseHolds,
  );
  return {
    run: {
      workflowId: context.workflowId,
      workflowVersionId: context.workflowVersionId,
      nodeId: context.nodeId,
      ...routesOf(definition, state),
    },
    solelyAutomated: humanStep === null,
    humanStep,
    decisionBasis: declared['decision-basis'] ?? null,
    contestRoute: declared['contest-route'] ?? null,
    biometricBasis: declared['biometric-basis'] ?? null,
    testRunId: context.testRun?.id ?? null,
  };
}
