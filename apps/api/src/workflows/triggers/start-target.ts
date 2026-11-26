/**
 * What every start of a run reads first: the version a subject runs, with its definition and grant.
 * A version's definition is read through `readDefinition`, so an old schema version upgrades, and one
 * that cannot be read is a code here, never a thrown value.
 */
import { workflowGrantSchema, type WorkflowDefinition } from '@openverify/contracts';
import type { WorkflowRolloutLabel } from '@openverify/core';
import type { WorkflowVersionRow } from '@openverify/db';
import { DefinitionReadError, readDefinition } from '@openverify/workflow-engine';
import type { RunGrant } from '../engine/action-port.js';

export interface RunTarget {
  version: WorkflowVersionRow;
  definition: WorkflowDefinition;
  grant: RunGrant;
  deploymentId: string | null;
  rolloutLabel: WorkflowRolloutLabel | null;
}

/** The definition and grant of a chosen version, or `null` when either cannot be read. */
export function readRunTarget(
  version: WorkflowVersionRow,
  deploymentId: string | null,
  rolloutLabel: WorkflowRolloutLabel | null,
): RunTarget | null {
  const grant = workflowGrantSchema.safeParse(version.grant);
  if (!grant.success) {
    return null;
  }
  try {
    return {
      version,
      definition: readDefinition(version.definition),
      grant: grant.data,
      deploymentId,
      rolloutLabel,
    };
  } catch (error) {
    if (error instanceof DefinitionReadError) {
      return null;
    }
    throw error;
  }
}
