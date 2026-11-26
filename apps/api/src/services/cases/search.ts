/**
 * C137.2 (Workflow 8B, `api-cases`): `POST /cases/search`, `case-logic`'s parsed tree compiled into
 * parameterised SQL over plaintext columns and the HMAC field index, never over a sealed value.
 *
 * - Read-after-write (decision 74): it reads Postgres in the request, so a case written before it is
 *   found by it.
 * - Template visibility holds (C129.4): a case of a template the reader may not see is never found.
 * - A `fields.*` leaf compares a field's keyed value, keyed per template and field (P25), against
 *   each searchable template the reader may see; a query holding one needs PII visibility, or it is a
 *   membership oracle on masked values (403 naming `pii:view`).
 * - Problems name their JSON Pointer and code and never the value (422).
 * - Sorted by one of four timestamps, a missing one last; paged forward (`page.after`) and back
 *   (`page.before`) by a case id, and `links` carry the ids to send.
 * - `case-search`, 120 a minute per key, follows C12: 429 past it, through when unanswered.
 */
import {
  CASE_LIMITS,
  parseCaseSearchQuery,
  type CaseSearchCondition,
  type CaseSearchPredicate,
  type FieldSchema,
} from '@openverify/core';
import {
  caseAccounts,
  caseFieldKeys,
  caseFieldValueKey,
  caseInquiries,
  caseQueues,
  cases,
  caseTemplates,
  caseTemplateVersions,
  caseVisibleTo,
  getCaseRows,
  templateVisibleTo,
  type Case,
  type CaseReader,
  type Db,
} from '@openverify/db';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { CaseSearchBody, CaseSearchDocument } from '@openverify/contracts';
import { BadRequestError, PermissionDeniedError, RateLimitedError } from '../../errors.js';
import { rateLimitRules } from '../../plugins/rate-limit.js';
import type { Principal } from '../../ports.js';
import type { ApiDependencies } from '../context.js';
import { searchValueText } from './fields.js';
import { CaseProblemError } from './problems.js';
import { caseResources } from './resources.js';
import type { CaseActing } from './service.js';
import { readerOf } from './shared.js';
import { CASE_SORT_COLUMNS, caseSortKey, caseSortOrder, caseSortPast } from './sort.js';

/** The searchable top-level field keys, by key, with the templates that mark them searchable. */
export async function searchableFields(
  db: Db,
  environmentId: string,
  reader: CaseReader,
): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      templateId: caseTemplateVersions.caseTemplateId,
      fieldSchemas: caseTemplateVersions.fieldSchemas,
    })
    .from(caseTemplateVersions)
    .where(
      and(
        eq(caseTemplateVersions.environmentId, environmentId),
        eq(caseTemplateVersions.status, 'published'),
        templateVisibleTo(
          reader,
          caseTemplateVersions.environmentId,
          caseTemplateVersions.caseTemplateId,
        ),
      ),
    );
  const fields = new Map<string, string[]>();
  for (const { templateId, fieldSchemas } of rows) {
    for (const field of fieldSchemas as FieldSchema[]) {
      if (field.config?.searchable === true) {
        fields.set(field.key, [...(fields.get(field.key) ?? []), templateId]);
      }
    }
  }
  return fields;
}

const TIME_COLUMNS = CASE_SORT_COLUMNS;

const OPERATORS = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;

const MISSING_COLUMNS = {
  resolved_at: cases.resolvedAt,
  sla_expires_at: cases.slaExpiresAt,
  resolution: cases.resolution,
  assignee: cases.assigneeId,
  case_queue: cases.caseQueueId,
  case_queue_id: cases.caseQueueId,
  resolver: cases.resolverId,
} as const;

/** The SQL of one leaf (C137.2); values are bound parameters, never text in the statement. */
function conditionSql(
  condition: CaseSearchCondition,
  context: { key: Uint8Array; environmentId: string; fields: Map<string, string[]> },
): SQL {
  switch (condition.kind) {
    case 'time':
      return sql`${TIME_COLUMNS[condition.attribute]} ${sql.raw(OPERATORS[condition.operator])} ${condition.value.toISOString()}::timestamptz`;
    case 'missing':
      return sql`${MISSING_COLUMNS[condition.attribute]} is null`;
    case 'equals':
      switch (condition.attribute) {
        case 'case_template_id':
          return eq(cases.caseTemplateId, condition.value);
        case 'template':
          return sql`exists (select 1 from ${caseTemplates} t
            where t.environment_id = ${cases.environmentId} and t.id = ${cases.caseTemplateId}
              and t.name = ${condition.value})`;
        case 'status':
          return eq(cases.status, condition.value);
        case 'state':
          return eq(cases.statusCategory, condition.value);
        case 'resolution':
          return eq(cases.resolution, condition.value);
        case 'assignee':
          return eq(cases.assigneeId, condition.value);
        case 'case_queue':
          return sql`exists (select 1 from ${caseQueues} q
            where q.environment_id = ${cases.environmentId} and q.id = ${cases.caseQueueId}
              and q.name = ${condition.value})`;
        case 'case_queue_id':
          return eq(cases.caseQueueId, condition.value);
        case 'resolver':
          return eq(cases.resolverId, condition.value);
      }
      break;
    case 'holds': {
      const held =
        condition.attribute === 'account_id'
          ? sql`exists (select 1 from ${caseAccounts} h where h.environment_id = ${cases.environmentId}
              and h.case_id = ${cases.id} and h.account_id = ${condition.value})`
          : sql`exists (select 1 from ${caseInquiries} h where h.environment_id = ${cases.environmentId}
              and h.case_id = ${cases.id} and h.inquiry_id = ${condition.value})`;
      return held;
    }
    case 'tagged':
      // R007: the form `cases_lower_tags_idx` (GIN on `openverify_lower_tags(tags)`) serves, as every
      // other resource's tag filter is.
      return sql`openverify_lower_tags(${cases.tags}) @> array[lower(${condition.value})]::text[]`;
    case 'field': {
      const text = searchValueText(condition.value);
      const keys = (context.fields.get(condition.key) ?? []).map((caseTemplateId) =>
        caseFieldValueKey(context.key, {
          environmentId: context.environmentId,
          caseTemplateId,
          fieldKey: condition.key,
          text,
        }),
      );
      if (keys.length === 0) {
        return sql`false`;
      }
      return sql`exists (select 1 from ${caseFieldKeys} k
        where k.environment_id = ${cases.environmentId} and k.case_id = ${cases.id}
          and k.field_key = ${condition.key}
          and k.value_key in (${sql.join(
            keys.map((key) => sql`${key}`),
            sql`, `,
          )}))`;
    }
  }
  return sql`false`;
}

/** The predicate tree as one SQL condition. */
export function predicateSql(
  predicate: CaseSearchPredicate,
  context: { key: Uint8Array; environmentId: string; fields: Map<string, string[]> },
): SQL {
  switch (predicate.kind) {
    case 'and':
      return sql`(${sql.join(
        predicate.clauses.map((clause) => predicateSql(clause, context)),
        sql` and `,
      )})`;
    case 'or':
      return sql`(${sql.join(
        predicate.clauses.map((clause) => predicateSql(clause, context)),
        sql` or `,
      )})`;
    case 'not':
      return sql`(not ${predicateSql(predicate.clause, context)})`;
    default:
      return conditionSql(predicate, context);
  }
}

/** The reader's search, parsed and compiled, or the problem that refuses it. */
export async function compileCaseSearch(
  deps: Pick<ApiDependencies, 'db' | 'blindIndexKey'>,
  acting: Pick<CaseActing, 'ctx' | 'mask'> & { principal: Principal | null },
  query: unknown,
  pointer: string,
): Promise<SQL | null> {
  const { environmentId } = acting.ctx;
  const fields = await searchableFields(deps.db, environmentId, readerOf(acting.principal));
  const parsed = parseCaseSearchQuery(
    query,
    { isSearchableField: (key) => fields.has(key) },
    pointer,
  );
  if (!parsed.ok) {
    // K8-27 (Workflow 9B, contracts B41): named, keeping each `search_*` code.
    throw new CaseProblemError('case_search_invalid', 'The search does not fit its grammar.', {
      errors: parsed.problems.map((problem) => ({
        location: 'body',
        pointer: problem.pointer,
        detail: 'This part of the search is refused.',
        code: problem.code,
      })),
    });
  }
  if (parsed.fieldKeys.length > 0 && !acting.mask.visible) {
    throw new PermissionDeniedError(
      'Searching by a field needs pii:view: an equality search would reveal masked values.',
      ['pii:view'],
    );
  }
  return parsed.predicate === null
    ? null
    : predicateSql(parsed.predicate, { key: deps.blindIndexKey, environmentId, fields });
}

/** The visible case ids that `condition` finds, at most `limit`, by id. */
export async function caseIdsMatching(
  db: Db,
  environmentId: string,
  reader: CaseReader,
  condition: SQL | null,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(eq(cases.environmentId, environmentId), caseVisibleTo(reader), condition ?? undefined),
    )
    .orderBy(asc(cases.id))
    .limit(limit);
  return rows.map(({ id }) => id);
}

async function consumeSearch(deps: Pick<ApiDependencies, 'rateLimiter'>, principal: Principal) {
  const key = principal.kind === 'api-key' ? principal.apiKeyId : principal.userId;
  let decision;
  try {
    decision = await deps.rateLimiter.consume(
      `case-search:${key}`,
      rateLimitRules()['case-search'],
    );
  } catch {
    return;
  }
  if (!decision.allowed) {
    throw new RateLimitedError('Too many case searches; retry later.', decision.retryAfterSeconds);
  }
}

/** C137.2: read-after-write, `fields.*` only with PII visibility, under `case-search`. */
export async function searchCases(
  deps: ApiDependencies,
  acting: CaseActing,
  body: CaseSearchBody,
): Promise<CaseSearchDocument> {
  const { environmentId } = acting.ctx;
  await consumeSearch(deps, acting.principal);
  const condition = await compileCaseSearch(deps, acting, body.query, '/query');
  const reader = readerOf(acting.principal);
  const attribute = body.sort?.attribute ?? 'created_at';
  const direction = body.sort?.direction ?? 'desc';
  const size = body.page?.size ?? CASE_LIMITS['search-page-default'].value;
  const sortKey = caseSortKey(attribute, direction);
  const backwards = body.page?.before !== undefined;
  const cursorId = body.page?.after ?? body.page?.before;
  const ascending = (direction === 'asc') !== backwards;
  let after: SQL | undefined;
  if (cursorId !== undefined) {
    const [position] = await deps.db
      .select({ key: sql<string>`(${sortKey})::text` })
      .from(cases)
      .where(
        and(eq(cases.environmentId, environmentId), eq(cases.id, cursorId), caseVisibleTo(reader)),
      )
      .limit(1);
    if (position === undefined) {
      throw new BadRequestError('page names no case of this search.');
    }
    after = caseSortPast(attribute, direction, ascending, { key: position.key, id: cursorId });
  }
  const rows = await deps.db
    .select()
    .from(cases)
    .where(
      and(
        eq(cases.environmentId, environmentId),
        caseVisibleTo(reader),
        condition ?? undefined,
        after,
      ),
    )
    .orderBy(...caseSortOrder(attribute, direction, ascending))
    .limit(size + 1);
  const more = rows.length > size;
  const page = rows.slice(0, size);
  if (backwards) {
    page.reverse();
  }
  const found: Case[] = await getCaseRows(
    deps.db,
    environmentId,
    { kind: 'system' },
    page.map(({ id }) => id),
  );
  // K8-30: the page's views and attachments in a fixed number of queries.
  const data = await caseResources(deps.db, environmentId, found, acting.mask);
  const first = page.at(0)?.id ?? null;
  const last = page.at(-1)?.id ?? null;
  return {
    data,
    links: {
      next: backwards ? last : more ? last : null,
      prev: backwards ? (more ? first : null) : cursorId === undefined ? null : first,
    },
  };
}
