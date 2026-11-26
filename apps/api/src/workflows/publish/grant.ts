/**
 * C121.2, C121.3: a version's grant is derived from the registry at publish and frozen: API scopes
 * only, plus whether any step needs unmasked values. Operator permissions are never part of a grant;
 * they are what publishing asks of its publisher. C121.5: the scopes whose loss pauses a workflow.
 */
import type { WorkflowDefinition, WorkflowGrant, WorkflowStep } from '@openverify/contracts';
import type { ApiScope, Permission } from '@openverify/core';
import type { ActionRegistry, AnyActionRegistryEntry } from '@openverify/workflow-engine/actions';
import type { EnvironmentKind } from '../../ports.js';

export interface GrantInputs {
  registry: ActionRegistry;
  /** C121.2: whether any step sends tainted values off the platform. */
  egress: boolean;
  /** C121.3: the grants of the modules it runs and the workflows it starts. */
  nested: readonly WorkflowGrant[];
}

type ActionStep = Extract<WorkflowStep, { type: 'action' }>;

const actionSteps = (definition: WorkflowDefinition): ActionStep[] =>
  definition.steps.filter((step): step is ActionStep => step.type === 'action');

/** The entry's grant for this step's config. A definition that passed the check has an entry. */
function grantOf(step: ActionStep, entry: AnyActionRegistryEntry) {
  return entry.grant(step.config as never);
}

export function deriveGrant(definition: WorkflowDefinition, inputs: GrantInputs): WorkflowGrant {
  const scopes = new Set<ApiScope>();
  let pii = inputs.egress;
  for (const step of actionSteps(definition)) {
    const entry = inputs.registry.get(step['action-key'], step['action-version']);
    if (entry !== undefined) {
      const grant = grantOf(step, entry);
      grant.scopes.forEach((scope) => scopes.add(scope));
      pii ||= grant.pii;
    }
  }
  for (const nested of inputs.nested) {
    nested.scopes.forEach((scope) => scopes.add(scope));
    pii ||= nested.pii;
  }
  return { scopes: [...scopes], pii };
}

/** C116.4: what a publisher must hold, in the order a refusal names them. */
export function publisherRequirements(
  grant: WorkflowGrant,
  environmentKind: EnvironmentKind,
): readonly Permission[] {
  return [
    ...grant.scopes,
    'workflows:publish',
    ...(grant.pii ? (['pii:view'] as const) : []),
    ...(environmentKind === 'production' ? (['environments:production'] as const) : []),
  ];
}

/**
 * C121.5: the scopes used by an egress, redaction, decline or other adverse step. Losing one pauses
 * the workflow; losing any other keeps it running on its frozen grant, flagged. A `by-config` step
 * counts whatever its config says, so this fails towards a pause.
 */
export function scopesThatPause(
  definition: WorkflowDefinition,
  registry: ActionRegistry,
): ReadonlySet<ApiScope> {
  const scopes = new Set<ApiScope>();
  for (const step of actionSteps(definition)) {
    const entry = registry.get(step['action-key'], step['action-version']);
    if (
      entry !== undefined &&
      (entry.kind === 'egress' || entry.adverse !== 'never' || entry.irreversible)
    ) {
      grantOf(step, entry).scopes.forEach((scope) => scopes.add(scope));
    }
  }
  return scopes;
}
