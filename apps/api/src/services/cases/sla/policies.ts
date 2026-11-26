/**
 * C133.1 (Workflow 8B): what `routes/server/case-sla-policies.ts` calls. Owner `api-queues-sla`;
 * `foundation-8b` (Stage 1b (Q)) froze each name and its route.
 *
 * - Around the clock and `continue` (decision 58) unless the body says otherwise; a calendar of the
 *   environment (else 422 with its pointer).
 * - A change to what the SLA counts (`target-minutes`, `case-calendar-id`, `on-reopen`) moves the
 *   revision; a new name does not (ours). A running SLA keeps what it pinned (C133.4).
 * - A target the calendar cannot reach within ten years (business time's 3,660-day scan) is refused
 *   as `sla_out_of_range`, measured from now on the calendar as it is.
 */
import {
  newId,
  type CaseSlaPolicyDocument,
  type CaseSlaPolicyListDocument,
  type CreateCaseSlaPolicyBody,
  type listCaseSlaPoliciesQuerySchema,
  type UpdateCaseSlaPolicyBody,
} from '@openverify/contracts';
import {
  createCaseSlaPolicyRow,
  getCaseCalendarRow,
  getCaseSlaPolicyRow,
  listCaseSlaPolicyRows,
  updateCaseSlaPolicyRow,
  type Db,
} from '@openverify/db';
import type { z } from 'zod';
import { NotFoundError, UnprocessableContentError } from '../../../errors.js';
import type { ApiDependencies } from '../../context.js';
import { nextLink, pageRequest, withCursor } from '../../pagination.js';
import type { CaseActing } from '../service.js';
import { caseChange, createdAtOf, dateOf, filterList } from '../shared.js';
import { queueAudit } from '../queues/audit.js';
import { caseSlaPolicyResource } from '../queues/resources.js';
import { addBusinessTime } from './business-time.js';
import { businessCalendarOf, measured } from './policy-sla.js';

const PATH = '/api/v1/case-sla-policies';
const ATTRIBUTES = '/data/attributes';
const MINUTE_MS = 60_000;
/** What changes the SLA a case counts, and so moves the revision (C133.4). */
const REVISED = ['target-minutes', 'case-calendar-id', 'on-reopen'] as const;

/**
 * The calendar is one of this environment, and the target reachable on it within ten years.
 * @throws {UnprocessableContentError} for a calendar this environment does not hold.
 * @throws {CaseProblemError} `sla_out_of_range` for a target the calendar cannot reach.
 */
async function assertReachable(
  db: Db,
  environmentId: string,
  targetMinutes: number,
  caseCalendarId: string | null,
  at: Date,
): Promise<void> {
  if (caseCalendarId === null) {
    return;
  }
  const calendar = await getCaseCalendarRow(db, environmentId, caseCalendarId);
  if (calendar === null) {
    throw new UnprocessableContentError('The calendar is not one of this environment.', [
      {
        location: 'body',
        pointer: `${ATTRIBUTES}/case-calendar-id`,
        detail: 'Names no calendar of this environment.',
      },
    ]);
  }
  measured(
    () => addBusinessTime(at, targetMinutes * MINUTE_MS, businessCalendarOf(calendar)),
    `${ATTRIBUTES}/target-minutes`,
  );
}

export async function listCaseSlaPolicies(
  deps: ApiDependencies,
  acting: CaseActing,
  query: z.infer<typeof listCaseSlaPoliciesQuerySchema>,
): Promise<CaseSlaPolicyListDocument> {
  const { start, end } = createdAtOf(query);
  const page = await withCursor(() =>
    listCaseSlaPolicyRows(
      deps.db,
      acting.ctx.environmentId,
      {
        caseCalendarIds: filterList(query['filter[case-calendar-id]']),
        createdAtStart: dateOf(start),
        createdAtEnd: dateOf(end),
      },
      pageRequest(query),
    ),
  );
  return {
    data: page.items.map(caseSlaPolicyResource),
    links: {
      next: nextLink(
        PATH,
        {
          'filter[case-calendar-id]': query['filter[case-calendar-id]'],
          'filter[created-at-start]': start,
          'filter[created-at-end]': end,
        },
        query,
        page.next,
      ),
    },
  };
}

/** Around the clock and `continue` (decision 58) unless the body says otherwise. */
export async function createCaseSlaPolicy(
  deps: ApiDependencies,
  acting: CaseActing,
  body: CreateCaseSlaPolicyBody,
): Promise<CaseSlaPolicyDocument> {
  const attributes = body.data.attributes;
  const { environmentId } = acting.ctx;
  const row = await caseChange(deps, acting, async (unit) => {
    const calendarId = attributes['case-calendar-id'] ?? null;
    await assertReachable(
      unit.tx,
      environmentId,
      attributes['target-minutes'],
      calendarId,
      unit.at,
    );
    const created = await createCaseSlaPolicyRow(unit.tx, environmentId, {
      id: newId('cslap'),
      name: attributes.name,
      targetMinutes: attributes['target-minutes'],
      caseCalendarId: calendarId,
      onReopen: attributes['on-reopen'] ?? 'continue',
    });
    await unit.audit(queueAudit('case-sla-policy.created', created.id, { revision: 1 }));
    return created;
  });
  return { data: caseSlaPolicyResource(row) };
}

export async function getCaseSlaPolicy(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
): Promise<CaseSlaPolicyDocument> {
  const row = await getCaseSlaPolicyRow(deps.db, acting.ctx.environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Case SLA policy ${id} was not found.`);
  }
  return { data: caseSlaPolicyResource(row) };
}

/** A new revision (C133.4); a running SLA keeps what it pinned. */
export async function updateCaseSlaPolicy(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: UpdateCaseSlaPolicyBody,
): Promise<CaseSlaPolicyDocument> {
  const attributes = body.data.attributes;
  const { environmentId } = acting.ctx;
  const row = await caseChange(deps, acting, async (unit) => {
    const current = await getCaseSlaPolicyRow(unit.tx, environmentId, id);
    if (current === null) {
      throw new NotFoundError(`Case SLA policy ${id} was not found.`);
    }
    const target = attributes['target-minutes'] ?? current.targetMinutes;
    const calendarId =
      attributes['case-calendar-id'] === undefined
        ? current.caseCalendarId
        : attributes['case-calendar-id'];
    await assertReachable(unit.tx, environmentId, target, calendarId, unit.at);
    const revised = REVISED.some((key) => attributes[key] !== undefined);
    const updated = await updateCaseSlaPolicyRow(unit.tx, environmentId, id, {
      ...(attributes.name === undefined ? {} : { name: attributes.name }),
      ...(attributes['target-minutes'] === undefined
        ? {}
        : { targetMinutes: attributes['target-minutes'] }),
      ...(attributes['case-calendar-id'] === undefined ? {} : { caseCalendarId: calendarId }),
      ...(attributes['on-reopen'] === undefined ? {} : { onReopen: attributes['on-reopen'] }),
      newRevision: revised,
    });
    if (updated === null) {
      throw new NotFoundError(`Case SLA policy ${id} was not found.`);
    }
    await unit.audit(
      queueAudit('case-sla-policy.updated', id, {
        attributes: Object.keys(attributes).sort(),
        revision: updated.revision,
      }),
    );
    return updated;
  });
  return { data: caseSlaPolicyResource(row) };
}
