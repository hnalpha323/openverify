/**
 * C132, C133 (Workflow 8B, `api-queues-sla`): the queue, policy and calendar resources, built from
 * their rows through the contracts' builders. None carries a subject's data (C143.5).
 */
import {
  buildCaseAssignmentPolicyResource,
  buildCaseCalendarResource,
  buildCaseQueueResource,
  buildCaseSlaPolicyResource,
  type CaseAssignmentPolicyResource,
  type CaseCalendarResource,
  type CaseCalendarWeek,
  type CaseQueueResource,
  type CaseSlaPolicyResource,
} from '@openverify/contracts';
import type {
  CaseAssignmentPolicyRow,
  CaseAssignmentPolicySourceRow,
  CaseCalendarRow,
  CaseQueueMemberRow,
  CaseQueueRow,
  CaseSlaPolicyRow,
} from '@openverify/db';

export function caseQueueResource(
  row: CaseQueueRow,
  members: readonly CaseQueueMemberRow[],
): CaseQueueResource {
  return buildCaseQueueResource({
    id: row.id,
    name: row.name,
    status: row.status,
    members: members.map(({ userId, maxOpen, paused }) => ({ userId, maxOpen, paused })),
    caseAssignmentPolicyId: row.caseAssignmentPolicyId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  });
}

export function caseAssignmentPolicyResource(
  row: CaseAssignmentPolicyRow,
  sources: readonly CaseAssignmentPolicySourceRow[],
): CaseAssignmentPolicyResource {
  return buildCaseAssignmentPolicyResource({
    id: row.id,
    name: row.name,
    distribution: row.distribution,
    sort: row.sort,
    agentIds: row.agentIds,
    maxCapacity: row.maxCapacity,
    sources: sources.map((source) =>
      source.caseTemplateId === null
        ? { type: 'case-queue', id: String(source.caseQueueId) }
        : { type: 'case-template', id: source.caseTemplateId },
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function caseSlaPolicyResource(row: CaseSlaPolicyRow): CaseSlaPolicyResource {
  return buildCaseSlaPolicyResource({
    id: row.id,
    name: row.name,
    targetMinutes: row.targetMinutes,
    caseCalendarId: row.caseCalendarId,
    onReopen: row.onReopen,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function caseCalendarResource(row: CaseCalendarRow): CaseCalendarResource {
  return buildCaseCalendarResource({
    id: row.id,
    name: row.name,
    timeZone: row.timeZone,
    week: row.week as CaseCalendarWeek,
    holidays: row.holidays,
    closures: row.closures,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
