/**
 * C132.2 (Workflow 8B): what `routes/server/case-assignment-policies.ts` calls. Owner
 * `api-queues-sla`; `foundation-8b` (Stage 1b (Q)) froze each name and its route.
 *
 * A policy's sources are templates and queues of its environment, in priority order (a source the
 * environment does not hold is refused with its pointer, before the database's foreign key would
 * answer); its agents, when listed, are active users of the organisation holding `cases:write`
 * (`case_assignee_ineligible`). What a change sends replaces; cases already assigned stay so.
 */
import {
  newId,
  type CaseAssignmentPolicyDocument,
  type CaseAssignmentPolicyListDocument,
  type CaseAssignmentSource,
  type CreateCaseAssignmentPolicyBody,
  type listCaseAssignmentPoliciesQuerySchema,
  type UpdateCaseAssignmentPolicyBody,
} from '@openverify/contracts';
import {
  caseQueues,
  caseTemplates,
  createCaseAssignmentPolicyRow,
  getCaseAssignmentPolicyRow,
  listCaseAssignmentPolicyRows,
  listCaseAssignmentPolicySourcesOf,
  updateCaseAssignmentPolicyRow,
  type CaseAssignmentPolicyRow,
  type CaseAssignmentSourceInput,
  type Db,
} from '@openverify/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { NotFoundError, UnprocessableContentError } from '../../../errors.js';
import type { ApiDependencies } from '../../context.js';
import { nextLink, pageRequest, withCursor } from '../../pagination.js';
import type { CaseActing } from '../service.js';
import { caseChange, createdAtOf, dateOf, filterList } from '../shared.js';
import { queueAudit } from '../queues/audit.js';
import { caseAssignmentPolicyResource } from '../queues/resources.js';
import { assertMayHoldCases } from './apply.js';

const PATH = '/api/v1/case-assignment-policies';
const ATTRIBUTES = '/data/attributes';

async function documentOf(
  db: Db,
  environmentId: string,
  row: CaseAssignmentPolicyRow,
): Promise<CaseAssignmentPolicyDocument> {
  const sources = await listCaseAssignmentPolicySourcesOf(db, environmentId, [row.id]);
  return { data: caseAssignmentPolicyResource(row, sources) };
}

/** C132.2: each source names a template or a queue of this environment. */
async function sourcesIn(
  db: Db,
  environmentId: string,
  sources: readonly CaseAssignmentSource[],
): Promise<CaseAssignmentSourceInput[]> {
  const templateIds = sources.filter(({ type }) => type === 'case-template').map(({ id }) => id);
  const queueIds = sources.filter(({ type }) => type === 'case-queue').map(({ id }) => id);
  const known = new Set<string>();
  if (templateIds.length > 0) {
    const rows = await db
      .select({ id: caseTemplates.id })
      .from(caseTemplates)
      .where(
        and(eq(caseTemplates.environmentId, environmentId), inArray(caseTemplates.id, templateIds)),
      );
    rows.forEach(({ id }) => known.add(id));
  }
  if (queueIds.length > 0) {
    const rows = await db
      .select({ id: caseQueues.id })
      .from(caseQueues)
      .where(and(eq(caseQueues.environmentId, environmentId), inArray(caseQueues.id, queueIds)));
    rows.forEach(({ id }) => known.add(id));
  }
  const missing = sources.flatMap(({ id }, index) =>
    known.has(id)
      ? []
      : [
          {
            location: 'body',
            pointer: `${ATTRIBUTES}/sources/${String(index)}/id`,
            detail: 'Names nothing this environment holds.',
          },
        ],
  );
  if (missing.length > 0) {
    throw new UnprocessableContentError('A source names nothing this environment holds.', missing);
  }
  return sources.map(({ type, id }) =>
    type === 'case-template' ? { caseTemplateId: id } : { caseQueueId: id },
  );
}

async function assertAgents(
  db: Db,
  acting: CaseActing,
  agents: readonly string[] | null | undefined,
): Promise<void> {
  if (agents === null || agents === undefined) {
    return;
  }
  await assertMayHoldCases(
    db,
    acting.ctx.environmentId,
    acting.ctx.organizationId,
    agents,
    (index) => `${ATTRIBUTES}/agents/${String(index)}`,
  );
}

export async function listCaseAssignmentPolicies(
  deps: ApiDependencies,
  acting: CaseActing,
  query: z.infer<typeof listCaseAssignmentPoliciesQuerySchema>,
): Promise<CaseAssignmentPolicyListDocument> {
  const { environmentId } = acting.ctx;
  const { start, end } = createdAtOf(query);
  const page = await withCursor(() =>
    listCaseAssignmentPolicyRows(
      deps.db,
      environmentId,
      {
        distributions: filterList(query['filter[distribution]']),
        createdAtStart: dateOf(start),
        createdAtEnd: dateOf(end),
      },
      pageRequest(query),
    ),
  );
  const sources = await listCaseAssignmentPolicySourcesOf(
    deps.db,
    environmentId,
    page.items.map(({ id }) => id),
  );
  return {
    data: page.items.map((row) =>
      caseAssignmentPolicyResource(
        row,
        sources.filter(({ caseAssignmentPolicyId }) => caseAssignmentPolicyId === row.id),
      ),
    ),
    links: {
      next: nextLink(
        PATH,
        {
          'filter[distribution]': query['filter[distribution]'],
          'filter[created-at-start]': start,
          'filter[created-at-end]': end,
        },
        query,
        page.next,
      ),
    },
  };
}

/** Its agents must hold `cases:write`; its sources are templates and queues of the environment. */
export async function createCaseAssignmentPolicy(
  deps: ApiDependencies,
  acting: CaseActing,
  body: CreateCaseAssignmentPolicyBody,
): Promise<CaseAssignmentPolicyDocument> {
  const attributes = body.data.attributes;
  const { environmentId } = acting.ctx;
  const row = await caseChange(deps, acting, async (unit) => {
    await assertAgents(unit.tx, acting, attributes.agents);
    const sources = await sourcesIn(unit.tx, environmentId, attributes.sources);
    const created = await createCaseAssignmentPolicyRow(unit.tx, environmentId, {
      id: newId('cap'),
      name: attributes.name,
      distribution: attributes.distribution,
      sort: attributes.sort ?? 'created-at',
      agentIds: attributes.agents ?? null,
      maxCapacity: attributes['max-capacity'] ?? null,
      sources,
    });
    await unit.audit(
      queueAudit('case-assignment-policy.created', created.id, {
        distribution: created.distribution,
        'source-count': sources.length,
      }),
    );
    return created;
  });
  return documentOf(deps.db, environmentId, row);
}

async function requirePolicy(db: Db, environmentId: string, id: string) {
  const row = await getCaseAssignmentPolicyRow(db, environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Case assignment policy ${id} was not found.`);
  }
  return row;
}

export async function getCaseAssignmentPolicy(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
): Promise<CaseAssignmentPolicyDocument> {
  return documentOf(
    deps.db,
    acting.ctx.environmentId,
    await requirePolicy(deps.db, acting.ctx.environmentId, id),
  );
}

/** What it sends replaces; cases already assigned stay so. */
export async function updateCaseAssignmentPolicy(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
  body: UpdateCaseAssignmentPolicyBody,
): Promise<CaseAssignmentPolicyDocument> {
  const attributes = body.data.attributes;
  const { environmentId } = acting.ctx;
  const row = await caseChange(deps, acting, async (unit) => {
    await requirePolicy(unit.tx, environmentId, id);
    await assertAgents(unit.tx, acting, attributes.agents);
    const sources =
      attributes.sources === undefined
        ? undefined
        : await sourcesIn(unit.tx, environmentId, attributes.sources);
    const updated = await updateCaseAssignmentPolicyRow(unit.tx, environmentId, id, {
      ...(attributes.name === undefined ? {} : { name: attributes.name }),
      ...(attributes.distribution === undefined ? {} : { distribution: attributes.distribution }),
      ...(attributes.sort === undefined ? {} : { sort: attributes.sort }),
      ...(attributes.agents === undefined ? {} : { agentIds: attributes.agents }),
      ...(attributes['max-capacity'] === undefined
        ? {}
        : { maxCapacity: attributes['max-capacity'] }),
      ...(sources === undefined ? {} : { sources }),
    });
    if (updated === null) {
      throw new NotFoundError(`Case assignment policy ${id} was not found.`);
    }
    await unit.audit(
      queueAudit('case-assignment-policy.updated', id, {
        attributes: Object.keys(attributes).sort(),
      }),
    );
    return updated;
  });
  return documentOf(deps.db, environmentId, row);
}
