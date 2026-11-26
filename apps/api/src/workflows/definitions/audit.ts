/**
 * C143.5 (P19): what a workflow audit entry may carry. Each action has a strict schema with no
 * free-text member, so a name, a note or a filter can never reach `audit_logs.metadata`: ids,
 * enums, numbers and acknowledgement keys, which are codes.
 */
import { idSchema, workflowAcknowledgementKeySchema } from '@openverify/contracts';
import {
  apiScopeSchema,
  workflowKindSchema,
  workflowPausedReasonSchema,
  workflowRolloutLabelSchema,
} from '@openverify/core';
import { z } from 'zod';
import type { AuditedAction } from '../../services/context.js';

const version = idSchema('wfv');
const workflow = idSchema('wfl');

const ROLLOUT = z.strictObject({
  'workflow-id': workflow,
  'workflow-version-id': version,
  'rollout-percentage': z.int().min(0).max(100),
});

const PUBLISHED = z.strictObject({
  'workflow-id': workflow,
  'version-number': z.int().min(1),
  'definition-sha256': z.string().regex(/^[0-9a-f]{64}$/),
  'rollout-percentage': z.int().min(1).max(100),
  'rollout-label': workflowRolloutLabelSchema.nullable(),
  scopes: z.array(apiScopeSchema),
  pii: z.boolean(),
  acknowledgements: z.array(workflowAcknowledgementKeySchema),
  'egress-step-ids': z.array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)),
});

const SCHEMAS = {
  'workflow.created': z.strictObject({ kind: workflowKindSchema }),
  'workflow.updated': z.strictObject({ attributes: z.array(z.enum(['name', 'description'])) }),
  'workflow.paused': z.strictObject({ reason: workflowPausedReasonSchema }),
  'workflow.activated': z.strictObject({}),
  'workflow.archived': z.strictObject({ 'canceled-scheduled-runs': z.int().min(0) }),
  'workflow.published': z.strictObject({ 'workflow-version-id': version }),
  'workflow-version.updated': z.strictObject({
    'workflow-id': workflow,
    'lock-version': z.int().min(1),
  }),
  'workflow-version.published': PUBLISHED,
  'workflow-version.rollout-updated': ROLLOUT,
  'workflow-version.restored': z.strictObject({
    'workflow-id': workflow,
    'restored-from': version,
  }),
  'workflow-version.promoted': z.strictObject({
    'workflow-id': workflow,
    'promoted-from': version,
    'source-environment-id': idSchema('env'),
    'target-environment-id': idSchema('env'),
  }),
  'workflow-version.publisher-rights-reduced': z.strictObject({
    'workflow-id': workflow,
    'missing-scopes': z.array(apiScopeSchema),
  }),
} as const;

export type WorkflowAuditAction = keyof typeof SCHEMAS;

/** Every action this folder writes, for the coverage test. */
export const WORKFLOW_AUDIT_ACTIONS = Object.keys(SCHEMAS) as readonly WorkflowAuditAction[];

const RESOURCE_TYPES: Readonly<Record<string, string>> = {
  workflow: 'workflow',
  'workflow-version': 'workflow-version',
};

/**
 * The entry of `action`.
 * @throws {z.ZodError} for metadata outside the action's schema, which is a bug here.
 */
export function workflowAudit<Action extends WorkflowAuditAction>(
  action: Action,
  resourceId: string,
  metadata: z.input<(typeof SCHEMAS)[Action]>,
): AuditedAction & { metadata: Record<string, unknown> } {
  return {
    action,
    resourceType: RESOURCE_TYPES[action.slice(0, action.indexOf('.'))] ?? 'workflow',
    resourceId,
    metadata: SCHEMAS[action].parse(metadata),
  };
}
