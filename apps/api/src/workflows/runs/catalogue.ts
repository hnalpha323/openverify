/**
 * C122.4, C122.5: `GET /workflow-actions`. It renders the registry, so the console's palette never
 * hard-codes a step: each action version with its schemas, grant and whether it works here. An action
 * whose adapter is unbound here is listed `available: false`, so publishing warns and a run errors.
 */
import type {
  workflowActionListDocumentSchema,
  WorkflowActionResource,
} from '@openverify/contracts';
import type { ActionGrant, AnyActionRegistryEntry } from '@openverify/workflow-engine/actions';
import { z } from 'zod';
import type { ApiDependencies } from '../../services/context.js';
import type { WorkflowActing } from '../acting.js';
import { boundAdaptersOf } from '../adapters.js';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';

type Schema = Record<string, never>;

const jsonSchema = (schema: z.ZodType): Schema =>
  z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as unknown as Schema;

/** A grant read from no config: what every use needs. */
function baseGrant(entry: AnyActionRegistryEntry): ActionGrant {
  try {
    return entry.grant({} as never);
  } catch {
    return { scopes: [], pii: false };
  }
}

/** C122.5: whether the adapter an action needs is bound for this environment kind. */
function unavailableReason(
  entry: AnyActionRegistryEntry,
  deps: ApiDependencies,
  acting: WorkflowActing,
): 'provider_not_configured' | 'code_disabled' | null {
  if (boundAdaptersOf(deps, acting.environmentKind).has(entry.availability)) {
    return null;
  }
  return entry.availability === 'code-runner' ? 'code_disabled' : 'provider_not_configured';
}

function resourceOf(
  entry: AnyActionRegistryEntry,
  deps: ApiDependencies,
  acting: WorkflowActing,
): WorkflowActionResource {
  const reason = unavailableReason(entry, deps, acting);
  return {
    type: 'workflow-action',
    id: `${entry.key}@${String(entry.version)}`,
    attributes: {
      key: entry.key,
      version: entry.version,
      kind: entry.kind,
      stage: entry.stage,
      delivery: entry.delivery,
      adverse: entry.adverse,
      'config-schema': jsonSchema(entry.config),
      'output-schema': jsonSchema(entry.output),
      grant: { scopes: [...baseGrant(entry).scopes], pii: baseGrant(entry).pii },
      'grant-depends-on-config': entry.grantDependsOnConfig,
      emits: [...entry.emits],
      triggers: entry.triggers === null ? null : [...entry.triggers],
      available: reason === null,
      reason,
    },
  };
}

export const actionCatalogue = (
  deps: ApiDependencies,
  acting: WorkflowActing,
): z.infer<typeof workflowActionListDocumentSchema> => ({
  data: WORKFLOW_ACTIONS.list().map((entry) => resourceOf(entry, deps, acting)),
  links: { next: null },
});
