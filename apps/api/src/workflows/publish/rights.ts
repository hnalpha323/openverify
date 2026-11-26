/**
 * C121.5 (P09, V05, V08; decision 45): what a publisher's standing means for a running workflow.
 * Losing a right that an egress, redaction, decline or other adverse step uses, or `pii:view` or
 * production where the version needs them, pauses it; losing any other scope keeps it running on its
 * frozen grant, flagged and audited, until someone republishes.
 */
import type { WorkflowDefinition, WorkflowGrant } from '@openverify/contracts';
import type { ApiScope, Permission } from '@openverify/core';
import type { ActionRegistry } from '@openverify/workflow-engine/actions';
import type { EnvironmentKind } from '../../ports.js';
import { scopesThatPause } from './grant.js';

export interface PublisherStanding {
  /** `false` for a deactivated or deleted user. */
  active: boolean;
  permissions: ReadonlySet<Permission>;
}

export type PublisherVerdict =
  { kind: 'fine' } | { kind: 'flag'; missingScopes: readonly ApiScope[] } | { kind: 'pause' };

export interface LiveVersion {
  definition: WorkflowDefinition;
  grant: WorkflowGrant;
}

export function publisherVerdict(
  standing: PublisherStanding,
  version: LiveVersion,
  environmentKind: EnvironmentKind,
  registry: ActionRegistry,
): PublisherVerdict {
  const { permissions } = standing;
  if (
    !standing.active ||
    (version.grant.pii && !permissions.has('pii:view')) ||
    (environmentKind === 'production' && !permissions.has('environments:production'))
  ) {
    return { kind: 'pause' };
  }
  const missingScopes = version.grant.scopes.filter((scope) => !permissions.has(scope));
  if (missingScopes.length === 0) {
    return { kind: 'fine' };
  }
  const pausing = scopesThatPause(version.definition, registry);
  return missingScopes.some((scope) => pausing.has(scope))
    ? { kind: 'pause' }
    : { kind: 'flag', missingScopes };
}
