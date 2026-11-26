/**
 * C121.5: the `publisher-rights` sweep (60 s). It compares each running workflow's publisher with its
 * live versions' requirements. A publisher who lost a right that matters pauses the workflow, with an
 * audit entry and `workflow.paused`, and it stays paused until a holder of the rights republishes,
 * which also ends its runs' next such step (`publisher_revoked`). A lesser loss is flagged on the
 * version and audited once. The sweep also retires the wait index of versions nothing can wait
 * through any more (C119.3).
 *
 * A row lock decides each pause, so a publish that has just fixed things wins. Nothing here reads a
 * value of a run.
 */
import type { WorkflowDefinitionIssue, WorkflowGrant } from '@openverify/contracts';
import { isPermission, type ApiScope, type Permission } from '@openverify/core';
import {
  getEnvironment,
  getUser,
  listPublishedWorkflowVersions,
  listRunningWorkflows,
  listUserPermissions,
  lockWorkflow,
  removeRetiredWorkflowWaitIndex,
  setWorkflowStatus,
  setWorkflowVersionWarnings,
  type Environment,
  type WorkflowRow,
  type WorkflowVersionRow,
} from '@openverify/db';
import { readDefinition } from '@openverify/workflow-engine';
import type { StagedEvent } from '../../events/index.js';
import { appendSystemAuditEntry } from '../../services/audit-log.js';
import { workflowAudit } from '../../workflows/definitions/audit.js';
import { WORKFLOW_ACTIONS } from '../../workflows/definitions/registry.js';
import { workflowResource } from '../../workflows/definitions/resources.js';
import { held } from '../../workflows/definitions/shared.js';
import { publisherVerdict, type PublisherStanding } from '../../workflows/publish/rights.js';
import type { WorkflowWorkerDeps } from '../../workflows/worker.js';

const BATCH = 200;
const FLAG = 'publisher_scope_lost';
/** Provisional: longer than a delivery a publish overtook can stay pending. */
const WAIT_INDEX_GRACE_MS = 86_400_000;

async function standingOf(
  deps: WorkflowWorkerDeps,
  environment: Environment,
  userId: string | null,
): Promise<PublisherStanding> {
  const user = userId === null ? null : await getUser(deps.db, environment.organizationId, userId);
  if (user?.status !== 'active') {
    return { active: false, permissions: new Set() };
  }
  const held = await listUserPermissions(deps.db, environment.organizationId, user.id);
  return { active: true, permissions: new Set<Permission>(held.filter(isPermission)) };
}

async function pause(deps: WorkflowWorkerDeps, workflow: WorkflowRow): Promise<void> {
  const { events } = deps.services;
  const environmentId = workflow.environmentId;
  const staged: StagedEvent[] = [];
  await deps.db.transaction(async (tx) => {
    const current = await lockWorkflow(tx, environmentId, workflow.id);
    if (current?.status !== 'running') {
      return;
    }
    const at = deps.clock.now();
    const row = await setWorkflowStatus(
      tx,
      environmentId,
      workflow.id,
      'paused',
      'publisher_revoked',
      at,
    );
    staged.push(
      await events.stage(tx, {
        environmentId,
        name: 'workflow.paused',
        payload: { data: workflowResource(held(row)) },
      }),
    );
    await appendSystemAuditEntry(
      tx,
      environmentId,
      workflowAudit('workflow.paused', workflow.id, { reason: 'publisher_revoked' }),
    );
  });
  await events.dispatch(staged);
}

/** Writes the flag once, and takes it off once the rights are back. */
async function flag(
  deps: WorkflowWorkerDeps,
  version: WorkflowVersionRow,
  missingScopes: readonly ApiScope[],
): Promise<void> {
  const warnings = version.warnings as readonly WorkflowDefinitionIssue[];
  const others = warnings.filter(({ code }) => code !== FLAG);
  const flagged = others.length !== warnings.length;
  if (flagged === missingScopes.length > 0) {
    return;
  }
  await deps.db.transaction(async (tx) => {
    const { environmentId, id, workflowId } = version;
    if (missingScopes.length === 0) {
      await setWorkflowVersionWarnings(tx, environmentId, id, others);
      return;
    }
    await setWorkflowVersionWarnings(tx, environmentId, id, [
      ...warnings,
      {
        pointer: '',
        code: FLAG,
        detail: 'Its publisher no longer holds every scope of this version.',
      },
    ]);
    await appendSystemAuditEntry(
      tx,
      environmentId,
      workflowAudit('workflow-version.publisher-rights-reduced', id, {
        'workflow-id': workflowId,
        'missing-scopes': [...missingScopes],
      }),
    );
  });
}

async function checkWorkflow(
  deps: WorkflowWorkerDeps,
  environment: Environment,
  workflow: WorkflowRow,
): Promise<void> {
  const versions = await listPublishedWorkflowVersions(
    deps.db,
    workflow.environmentId,
    workflow.id,
  );
  for (const version of versions) {
    const verdict = publisherVerdict(
      await standingOf(deps, environment, version.publishedById),
      {
        definition: readDefinition(version.definition),
        grant: version.grant as WorkflowGrant,
      },
      environment.kind,
      WORKFLOW_ACTIONS,
    );
    if (verdict.kind === 'pause') {
      await pause(deps, workflow);
      return;
    }
    await flag(deps, version, verdict.kind === 'flag' ? verdict.missingScopes : []);
  }
}

export async function runPublisherRightsSweep(deps: WorkflowWorkerDeps): Promise<void> {
  await removeRetiredWorkflowWaitIndex(
    deps.db,
    new Date(deps.clock.now().getTime() - WAIT_INDEX_GRACE_MS),
  );
  const environments = new Map<string, Environment | null>();
  const environmentOf = async (id: string) => {
    if (!environments.has(id)) {
      environments.set(id, await getEnvironment(deps.db, id));
    }
    return environments.get(id) ?? null;
  };
  let after: string | null = null;
  for (;;) {
    const batch: WorkflowRow[] = await listRunningWorkflows(deps.db, { after, limit: BATCH });
    for (const workflow of batch) {
      const environment = await environmentOf(workflow.environmentId);
      if (environment !== null) {
        await checkWorkflow(deps, environment, workflow);
      }
    }
    const last = batch.at(-1);
    if (last === undefined || batch.length < BATCH) {
      return;
    }
    after = last.id;
  }
}
