/**
 * Test support for the case steps (Workflow 8B, `api-case-workflows`): the action harness with the
 * process's object and case handlers, a run's case grant, and people, queues and policies written by
 * the repositories. Only tests import this file. Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import type { CaseAssignmentDistribution } from '@openverify/core';
import {
  createCaseAssignmentPolicyRow,
  createCaseQueueRow,
  createUser,
  openWorkflowStepValues,
  replaceCaseQueueMembers,
} from '@openverify/db';
import { seedCase, seedCaseTemplate } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { WORKFLOW_ACTIONS } from '../../definitions/registry.js';
import { createActionHandlerTable, type ActionHandlerTable } from '../../engine/action-port.js';
import { RUN_WORKFLOW_HANDLER } from '../../engine/run-workflow.js';
import { stepOf } from '../../engine/testing.js';
import { OBJECT_ACTION_HANDLERS } from '../index.js';
import { createActionHarness, EVERY_GRANT, type ActionHarness } from '../testing.js';
import { CASE_ACTION_HANDLERS } from './index.js';

/** A run's grant with the case scopes beside 8A's. */
export const CASE_GRANT = {
  scopes: [...EVERY_GRANT.scopes, 'cases:read', 'cases:write', 'cases:assign', 'cases:redact'],
  pii: true,
} as const;

/** The action harness, its handlers the process's object and case lists. */
export async function createCaseStepHarness(
  options: { environmentKind?: 'sandbox' | 'production' } = {},
): Promise<ActionHarness> {
  const harness = await createActionHarness(options);
  useHandlers(
    harness,
    createActionHandlerTable([
      RUN_WORKFLOW_HANDLER,
      ...OBJECT_ACTION_HANDLERS,
      ...CASE_ACTION_HANDLERS,
    ]),
  );
  return harness;
}

/** The harness's handlers. */
export function handlersOf(harness: ActionHarness): ActionHandlerTable {
  const table = harness.deps.actions?.handlers;
  if (table === undefined) {
    throw new Error('the harness has no handlers');
  }
  return table;
}

/** Runs the harness's steps with `handlers` from now on. */
export function useHandlers(harness: ActionHarness, handlers: ActionHandlerTable): void {
  harness.deps.actions = { registry: WORKFLOW_ACTIONS, handlers };
}

/** A step's sealed output, opened. */
export const stepOutputOf = async (harness: ActionHarness, runId: string, nodeId = 'step') =>
  openWorkflowStepValues(await stepOf(harness, runId, nodeId)).output;

let templates = 0;

/** A searchable text field, as a version declares it. */
export const REFERENCE_FIELD = {
  key: 'reference',
  label: 'Reference',
  type: 'string',
  config: { searchable: true },
};

/** A published template (the default statuses, one text field) and an open case on it. */
export async function caseOn(harness: ActionHarness, fields: Record<string, unknown> = {}) {
  templates += 1;
  const template = await seedCaseTemplate(harness.db, harness.environmentId, {
    key: `CS${String(templates)}`,
  });
  await harness.db.execute(sql`update case_template_versions
    set field_schemas = ${JSON.stringify([REFERENCE_FIELD])}::jsonb where id = ${template.versionId}`);
  const created = await seedCase(harness.db, harness.environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    // Above the template's counter, which names the cases a step makes from 1.
    number: 900,
    fields,
  });
  return { caseId: created.id, templateId: template.id, versionId: template.versionId };
}

/** A user of the harness's organisation holding `permissions` through a role of its own. */
export async function personOf(
  harness: ActionHarness,
  permissions: readonly string[] = ['cases:read', 'cases:write'],
): Promise<string> {
  const id = newId('usr');
  await createUser(harness.db, {
    id,
    organizationId: harness.organizationId,
    email: `${id.toLowerCase()}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$c3ludGhldGljaGFzaA',
  });
  const roleId = newId('role');
  await harness.db.execute(sql`insert into roles (id, organization_id, name, permissions)
    values (${roleId}, ${harness.organizationId}, ${`Synthetic ${roleId}`},
      ${`{${permissions.join(',')}}`}::text[])`);
  await harness.db.execute(sql`insert into user_roles (organization_id, user_id, role_id)
    values (${harness.organizationId}, ${id}, ${roleId})`);
  return id;
}

/** An active queue with `members`, and no policy of its own. */
export async function queueOf(
  harness: ActionHarness,
  members: readonly string[] = [],
): Promise<string> {
  const id = newId('cqueue');
  await harness.db.transaction(async (tx) => {
    await createCaseQueueRow(tx, harness.environmentId, {
      id,
      name: `Synthetic queue ${id}`,
      caseAssignmentPolicyId: null,
    });
    await replaceCaseQueueMembers(
      tx,
      harness.environmentId,
      id,
      members.map((userId) => ({ userId, maxOpen: 50, paused: false })),
    );
  });
  return id;
}

/** A policy over `agents` (or the routed queue's members, for `null`). */
export async function policyOf(
  harness: ActionHarness,
  agents: readonly string[] | null,
  distribution: CaseAssignmentDistribution = 'round-robin',
): Promise<string> {
  const id = newId('cap');
  await harness.db.transaction((tx) =>
    createCaseAssignmentPolicyRow(tx, harness.environmentId, {
      id,
      name: `Synthetic policy ${id}`,
      distribution,
      sort: 'created-at',
      agentIds: agents,
      maxCapacity: null,
      sources: [],
    }),
  );
  return id;
}

/** Rows of a query, as PGlite answers them. */
export async function rowsOf<Row>(harness: ActionHarness, text: string, params: unknown[] = []) {
  return (await harness.database.client.query<Row>(text, params)).rows;
}
