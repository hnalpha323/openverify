/**
 * C173.3 (Workflow 9B, `api-cases-reports`; K12, decision 59, review P36):
 * `POST /api/v1/dashboard/print-audits` (`routes/dashboard/print-audits.ts`).
 *
 * - The object (`inq_`, `rep_` or `ver_`) is one of the session's environment that the user may read
 *   (`inquiries:read`, `reports:read` or `verifications:read`); an unknown, foreign or unreadable one
 *   answers 404, so the route never says whether an object the user may not read exists, and writes
 *   nothing.
 * - The entry is `inquiry.print-initiated`, `report.print-initiated` or
 *   `verification.print-initiated` on the object, by the user, with empty metadata (Phase 8 C143.5's
 *   strict rule: the object is the entry's resource and nothing else is named), written before the
 *   browser's print dialog opens. It records use of the print button, not every print: a browser's
 *   menu or shortcut writes nothing.
 * - The answer names the entry (`aud_`), the object and the time the entry was stored.
 */
import {
  toTimestamp,
  type AuditActor,
  type CreatePrintAuditBody,
  type PrintAuditDocument,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import { getInquiry, getReport, getVerification, type Db } from '@openverify/db';
import { sql } from 'drizzle-orm';
import { NotFoundError } from '../../errors.js';
import type { AuditLogger, Clock, ServiceContext } from '../../ports.js';
import { auditEntryOf } from '../context.js';

export interface PrintAuditDeps {
  db: Db;
  audit: AuditLogger;
  clock: Clock;
}

/** The signed-in user printing: the session's tenant and request, the user, its permissions. */
export interface PrintAuditActing {
  ctx: ServiceContext;
  actor: AuditActor;
  permissions: ReadonlySet<Permission>;
}

export type CreatePrintAudit = (
  deps: PrintAuditDeps,
  acting: PrintAuditActing,
  body: CreatePrintAuditBody,
) => Promise<PrintAuditDocument>;

type PrintedKind = 'inquiry' | 'report' | 'verification';

const KINDS: Readonly<Record<string, { kind: PrintedKind; permission: Permission }>> = {
  inq: { kind: 'inquiry', permission: 'inquiries:read' },
  rep: { kind: 'report', permission: 'reports:read' },
  ver: { kind: 'verification', permission: 'verifications:read' },
};

/** Whether the object exists in the environment. */
async function exists(db: Db, environmentId: string, kind: PrintedKind, id: string) {
  switch (kind) {
    case 'inquiry':
      return (await getInquiry(db, environmentId, id)) !== null;
    case 'report':
      return (await getReport(db, environmentId, id)) !== null;
    case 'verification':
      return (await getVerification(db, environmentId, id)) !== null;
  }
}

/**
 * The entry this transaction just wrote for the object: its public id and time. `xmin` names the
 * writing transaction, so a concurrent print of the same object is never read instead.
 */
async function writtenEntry(
  tx: Db,
  environmentId: string,
  action: string,
  objectId: string,
): Promise<{ publicId: string; createdAt: Date }> {
  const result: unknown = await tx.execute(sql`
    select public_id, created_at from audit_logs
    where environment_id = ${environmentId} and action = ${action} and resource_id = ${objectId}
      and xmin::text = (pg_current_xact_id()::text::bigint % 4294967296)::text
    order by id desc limit 1`);
  const [row] =
    (result as { rows?: { public_id: string; created_at: Date | string }[] }).rows ?? [];
  if (row === undefined) {
    throw new Error('createPrintAudit: the audit entry was not written');
  }
  return { publicId: row.public_id, createdAt: new Date(row.created_at) };
}

export const createPrintAudit: CreatePrintAudit = async (deps, acting, body) => {
  const objectId = body['object-id'];
  const { environmentId } = acting.ctx;
  const printed = KINDS[objectId.slice(0, objectId.indexOf('_'))];
  if (
    printed === undefined ||
    !acting.permissions.has(printed.permission) ||
    !(await exists(deps.db, environmentId, printed.kind, objectId))
  ) {
    throw new NotFoundError(`${objectId} was not found.`);
  }
  const action = `${printed.kind}.print-initiated`;
  const entry = await deps.db.transaction(async (tx) => {
    await deps.audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action,
        resourceType: printed.kind,
        resourceId: objectId,
        metadata: {},
      }),
    );
    return writtenEntry(tx, environmentId, action, objectId);
  });
  return {
    data: {
      type: 'print-audit',
      id: entry.publicId,
      attributes: { 'object-id': objectId, 'recorded-at': toTimestamp(entry.createdAt) },
    },
  };
};
