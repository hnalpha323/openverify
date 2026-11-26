/**
 * C167.2 (Phase 9, Workflow 9B): organisation-level actions (users, roles, invitations, MFA resets,
 * organisation settings) write their audit entry in every environment of the organisation, so
 * `audit-logs:read` in any one environment shows them. Their metadata holds ids and closed values
 * only, under a strict schema (Phase 8 C143.5): never a name, an email or free text.
 */
import { roleAssignmentSchema, type AuditActor } from '@openverify/contracts';
import { listEnvironments, type Db } from '@openverify/db';
import { z } from 'zod';
import type { AuditLogger, ServiceContext } from '../../ports.js';
import { auditEntryOf } from '../context.js';

/** One audit entry of an organisation-level action. */
export interface OrganizationAuditEntry {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
}

/** Records `entry` in every environment of the organisation of `ctx`, in `db`'s transaction. */
export async function recordInEveryEnvironment(
  db: Db,
  audit: AuditLogger,
  ctx: ServiceContext,
  actor: AuditActor,
  entry: OrganizationAuditEntry,
): Promise<void> {
  for (const environment of await listEnvironments(db, ctx.organizationId)) {
    await audit.record(db, auditEntryOf({ ...ctx, environmentId: environment.id }, actor, entry));
  }
}

/** `user.roles-assigned` (C167.3): the assignments as stored, ids only. */
export const roleAssignmentsAuditMetadataSchema = z.strictObject({
  assignments: z.array(roleAssignmentSchema).max(50),
});
