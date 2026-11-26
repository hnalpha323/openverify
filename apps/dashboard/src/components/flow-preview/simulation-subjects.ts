/**
 * C156.4 (Workflow 9C, `dashboard-preview`): what a simulation can set for a version, read from its
 * flow on the server (a flow-spec 1 flow is migrated first, as the engine walks it): the
 * verification steps, the `run_workflow` steps, the lists its routes read (`lists.<id>.matched`) and
 * every flow-provisional signal of the registry (C150.9: no other signal reaches a flow). Only ids
 * and types leave the server, never a step's configuration.
 */
import { STEP_VERIFICATION_TYPES } from '@openverify/contracts';
import { SIGNAL_REGISTRY } from '@openverify/core';
import { migrateFlow, type AnyFlow, type FlowV2 } from '@openverify/flow-spec';
import type { ScopeSubjects } from './scope-form-model';

const LIST_PATH = /lists\.([A-Za-z0-9_-]{1,40})\.matched/g;

const isVerification = (type: string): boolean =>
  Object.hasOwn(STEP_VERIFICATION_TYPES, type) &&
  STEP_VERIFICATION_TYPES[type as keyof typeof STEP_VERIFICATION_TYPES] !== null;

/** The flow as v2, or `null` when it cannot be read. */
function v2Of(flow: AnyFlow): FlowV2 | null {
  try {
    const migrated = migrateFlow(flow);
    return Array.isArray(migrated.steps) ? migrated : null;
  } catch {
    return null;
  }
}

export function simulationSubjectsOf(flow: AnyFlow): ScopeSubjects {
  const signals = SIGNAL_REGISTRY.filter((signal) => signal.flowProvisional).map((signal) => ({
    name: signal.name,
    valueType: signal.valueType,
  }));
  const v2 = v2Of(flow);
  if (v2 === null) {
    return { verifications: [], workflows: [], signals, lists: [] };
  }
  const lists = new Set<string>();
  for (const step of v2.steps) {
    if (step.type === 'branch') {
      for (const match of JSON.stringify(step.routes).matchAll(LIST_PATH)) {
        if (match[1] !== undefined) {
          lists.add(match[1]);
        }
      }
    }
  }
  return {
    verifications: v2.steps
      .filter((step) => isVerification(step.type))
      .map(({ id, type }) => ({ id, type })),
    workflows: v2.steps
      .filter((step) => step.type === 'action' && step.action.kind === 'run_workflow')
      .map(({ id }) => ({ id })),
    signals,
    lists: [...lists],
  };
}
