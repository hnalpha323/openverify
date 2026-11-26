/**
 * C138.1 (Workflow 8B, `api-case-files`; P19, P25, P26): what an export selects, decided when it is
 * asked for, in the API process that holds the blind-index key a field search compares with.
 *
 * - A filter takes the `GET /cases` filters; a search the `POST /cases/search` grammar, compiled by
 *   `api-cases`' compiler, so a leaf on a field needs `pii:view` (403) and a malformed one answers
 *   its pointers (422); neither selects every case the requester can see. Each holds template
 *   visibility (C129.4).
 * - At most 10,000 cases (decision 69): one more found answers 422 `export_too_large`.
 * - The ids found are what the export's sealed request holds, newest first or in the search's sort;
 *   the job reads them again with the creator's visibility, so a case the creator can no longer see
 *   is left out.
 * - Its audit entry records the selection's shape: member names, attributes and operators, never a
 *   value (P19).
 */
import type { CreateCaseExportBody } from '@openverify/contracts';
import { CASE_LIMITS } from '@openverify/core';
import { caseFilterConditions, cases, caseVisibleTo, type CaseFilters } from '@openverify/db';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { ApiDependencies } from '../../context.js';
import { compileCaseSearch } from '../search.js';
import { caseSortOrder } from '../sort.js';
import type { CaseActing } from '../service.js';
import { readerOf } from '../shared.js';
import { CaseProblemError } from '../problems.js';
import type { CaseExportShape } from '../attachments/audit.js';

type Attributes = CreateCaseExportBody['data']['attributes'];
type Filter = NonNullable<Attributes['filter']>;

/** C138.1: the `GET /cases` filters an export takes, as the case repository reads them. */
function filtersOf(filter: Filter): CaseFilters {
  return {
    statuses: filter.status,
    caseTemplateIds: filter['case-template-id'],
    accountIds: filter['account-id'],
    referenceId: filter['reference-id'],
    inquiryIds: filter['inquiry-id'],
    reportIds: filter['report-id'],
    caseQueueIds: filter['case-queue-id'],
    assigneeIds: filter['assignee-id'],
    statusCategories: filter['status-category'],
    slaStates: filter['sla-state'],
  };
}

/** The leaves of a search tree, written out to two levels by the contract. */
function leavesOf(node: unknown): { attribute: string; operator: string }[] {
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  const value = node as Record<string, unknown>;
  if (typeof value.attribute === 'string' && typeof value.operator === 'string') {
    return [{ attribute: value.attribute, operator: value.operator }];
  }
  const children = [value.and, value.or, value.not].flatMap((child) =>
    Array.isArray(child) ? (child as unknown[]) : child === undefined ? [] : [child],
  );
  return children.flatMap(leavesOf);
}

/** P19: the selection's shape, never a value. */
export function exportShapeOf(attributes: Attributes): CaseExportShape {
  if (attributes.search !== undefined) {
    return {
      kind: 'search',
      leaves: leavesOf(attributes.search.query) as Extract<
        CaseExportShape,
        { kind: 'search' }
      >['leaves'],
      sort: attributes.search.sort?.attribute ?? null,
    };
  }
  if (attributes.filter !== undefined) {
    return { kind: 'filter', members: Object.keys(attributes.filter).sort() };
  }
  return { kind: 'all' };
}

/**
 * The ids the export selects, in its order.
 * @throws {CaseProblemError} `export_too_large` past 10,000 cases.
 */
export async function selectExportCaseIds(
  deps: Pick<ApiDependencies, 'db' | 'blindIndexKey'>,
  acting: CaseActing,
  attributes: Attributes,
): Promise<string[]> {
  const { environmentId } = acting.ctx;
  const cap = CASE_LIMITS['export-cases'].value;
  let conditions: (SQL | undefined)[] = [];
  let order: SQL[] = [desc(cases.createdAt), desc(cases.id)];
  if (attributes.search !== undefined) {
    const condition = await compileCaseSearch(
      deps,
      acting,
      attributes.search.query,
      '/data/attributes/search/query',
    );
    conditions = [condition ?? undefined];
    const sort = attributes.search.sort;
    if (sort !== undefined) {
      // A missing timestamp sorts last either way, as the search does.
      order = caseSortOrder(sort.attribute, sort.direction);
    }
  } else if (attributes.filter !== undefined) {
    const found = caseFilterConditions(filtersOf(attributes.filter));
    if (found === null) {
      return [];
    }
    conditions = found;
  }
  const rows = await deps.db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(
        eq(cases.environmentId, environmentId),
        caseVisibleTo(readerOf(acting.principal)),
        ...conditions,
      ),
    )
    .orderBy(...order)
    .limit(cap + 1);
  if (rows.length > cap) {
    throw new CaseProblemError(
      'export_too_large',
      `An export holds at most ${String(cap)} cases; narrow the filter or the search.`,
    );
  }
  return rows.map(({ id }) => id);
}
