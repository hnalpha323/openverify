/**
 * C71 (Workflow 6A Stage 3, `api-reports`): report templates and their versions. A template is one
 * report type's configuration; creating it publishes version 1, later versions start as drafts and
 * publishing one supersedes the published version under the template lock. A report pins the
 * version it was created from.
 *
 * The configuration is checked against the type (`reportTemplateConfigSchema`, 422 with
 * pointers). An omitted `search-lists` is resolved into explicit source ids when the template or
 * the version is created, and stored (C71.2, H09, P13): in a sandbox environment every enabled
 * source of the type's kind, the sandbox list among them; in production every enabled source of
 * that kind that is not sandbox-only. The publish rules refuse an unknown source, a source of
 * another kind or a sandbox-only one in production, an empty list (V01), and a `max-list-age-hours`
 * below a selected source's refresh interval.
 */
import {
  buildReportTemplateResource,
  buildReportTemplateVersionResource,
  filterValues,
  idSchema,
  reportTemplateConfigSchema,
  reportTemplateStatusSchema,
  reportTemplateVersionStatusSchema,
  resolveReportTemplateConfig,
  type ReportTemplateResource,
  type ReportTemplateVersionResource,
} from '@openverify/contracts';
import { REPORT_REGISTRY, reportTypeSchema, type ReportType } from '@openverify/core';
import {
  createDraftReportTemplateVersion,
  createReportTemplate,
  getEnvironment,
  getReportTemplate,
  getReportTemplateVersion,
  listReportTemplates,
  listReportTemplateVersions,
  listWatchlistSourceRows,
  publishReportTemplateVersion,
  updateDraftReportTemplateVersion,
  updateReportTemplate,
  type Db,
  type ReportTemplateVersionRow,
  type ReportTemplateWithVersion,
} from '@openverify/db';
import type { z } from 'zod';
import {
  InvalidTransitionError,
  ListProblemError,
  NotFoundError,
  ReportProblemError,
  UnprocessableContentError,
  type ProblemFieldError,
} from '../../errors.js';
import type { EnvironmentKind } from '../../ports.js';
import { auditEntryOf, type ApiDependencies, type AuditedAction } from '../context.js';
import type { Acting } from '../inquiries.js';
import { customListListProblems } from '../lists/report-view.js';
import { nextLink, pageRequest, withCursor, type PageQuery } from '../pagination.js';
import { watchlistSourceCatalog } from './source-catalog.js';
import { pointerOfPath } from './validation.js';

export const REPORT_TEMPLATES_PATH = '/api/v1/report-templates';
export const REPORT_TEMPLATE_VERSIONS_PATH = '/api/v1/report-template-versions';

/** Who changes a template: the tenant, request metadata and the audit actor. */
export type ReportTemplateActing = Pick<Acting, 'ctx' | 'actor'>;

const CONFIG_POINTER = '/data/attributes/config';

/** The 422 field errors of a refused configuration. */
function configErrors(issues: readonly z.core.$ZodIssue[]): ProblemFieldError[] {
  return issues.map((issue) => ({
    location: 'body',
    pointer: `${CONFIG_POINTER}${pointerOfPath(issue.path)}`,
    detail: issue.message,
  }));
}

async function environmentKindOf(db: Db, environmentId: string): Promise<EnvironmentKind> {
  const environment = await getEnvironment(db, environmentId);
  if (environment === null) {
    throw new NotFoundError('The environment no longer exists.');
  }
  return environment.kind;
}

/**
 * C71.2: the source ids a list type screens when the configuration names none: the enabled
 * sources of its kind, less the sandbox-only ones in production, in id order.
 */
export async function defaultSearchLists(
  db: Db,
  kind: EnvironmentKind,
  type: ReportType,
): Promise<string[]> {
  const sourceKind = REPORT_REGISTRY[type].sourceKind;
  if (sourceKind === null) {
    return [];
  }
  const catalog = watchlistSourceCatalog();
  const ofKind = catalog
    .all()
    .filter((source) => source.kind === sourceKind)
    .map((source) => source.id);
  const rows = await listWatchlistSourceRows(db, ofKind);
  return rows
    .filter(
      (row) =>
        row.enabled &&
        (kind === 'sandbox' || !(row.sandboxOnly || catalog.get(row.id)?.sandboxOnly === true)),
    )
    .map((row) => row.id)
    .sort();
}

/**
 * The configuration to store: checked against the type, with an omitted source list resolved.
 * @throws {UnprocessableContentError} with a pointer per refused member.
 */
async function storedConfig(
  db: Db,
  kind: EnvironmentKind,
  type: ReportType,
  config: unknown,
): Promise<Record<string, unknown>> {
  const parsed = reportTemplateConfigSchema(type).safeParse(config ?? {});
  if (!parsed.success) {
    throw new UnprocessableContentError(
      `The configuration is not one a ${type} template takes.`,
      configErrors(parsed.error.issues),
    );
  }
  const stored = { ...(parsed.data as Record<string, unknown>) };
  if (REPORT_REGISTRY[type].sourceKind !== null && stored['search-lists'] === undefined) {
    stored['search-lists'] = await defaultSearchLists(db, kind, type);
  }
  return stored;
}

/**
 * C71.2: the publish rules of a stored configuration.
 * @throws {ReportProblemError} `watchlist_source_unknown`, `watchlist_source_not_allowed` or
 *   `watchlist_sources_empty`, with a pointer per source.
 * @throws {UnprocessableContentError} for a list age below a selected source's refresh interval.
 */
export function assertPublishableConfig(
  kind: EnvironmentKind,
  type: ReportType,
  stored: Readonly<Record<string, unknown>>,
): void {
  const sourceKind = REPORT_REGISTRY[type].sourceKind;
  if (sourceKind === null) {
    return;
  }
  const lists = (stored['search-lists'] ?? []) as readonly string[];
  if (lists.length === 0) {
    throw new ReportProblemError(
      'watchlist_sources_empty',
      'The template selects no source, so its reports would screen nothing.',
      {
        errors: [
          {
            location: 'body',
            pointer: `${CONFIG_POINTER}/search-lists`,
            detail: 'must select at least one enabled source',
          },
        ],
      },
    );
  }
  const catalog = watchlistSourceCatalog();
  const problems: {
    code: 'watchlist_source_unknown' | 'watchlist_source_not_allowed';
    error: ProblemFieldError;
  }[] = [];
  lists.forEach((id, index) => {
    const source = catalog.get(id);
    const pointer = `${CONFIG_POINTER}/search-lists/${String(index)}`;
    if (source === undefined) {
      problems.push({
        code: 'watchlist_source_unknown',
        error: { location: 'body', pointer, detail: 'is not a source of the manifest' },
      });
    } else if (source.kind !== sourceKind) {
      problems.push({
        code: 'watchlist_source_not_allowed',
        error: { location: 'body', pointer, detail: `is a ${source.kind} source` },
      });
    } else if (source.sandboxOnly && kind === 'production') {
      problems.push({
        code: 'watchlist_source_not_allowed',
        error: { location: 'body', pointer, detail: 'is a sandbox-only list' },
      });
    }
  });
  const [first] = problems;
  if (first !== undefined) {
    throw new ReportProblemError(
      first.code,
      first.code === 'watchlist_source_unknown'
        ? 'The template selects a source the manifest does not know.'
        : 'The template selects a source it may not screen here.',
      { errors: problems.map((problem) => problem.error) },
    );
  }
  const maxAge = resolveReportTemplateConfig(type, stored)['max-list-age-hours'] as number;
  const tooYoung = lists.find((id) => (catalog.get(id)?.refreshIntervalHours ?? 0) > maxAge);
  if (tooYoung !== undefined) {
    throw new UnprocessableContentError(
      'A selected source refreshes less often than the list age allows.',
      [
        {
          location: 'body',
          pointer: `${CONFIG_POINTER}/max-list-age-hours`,
          detail: `must be at least the refresh interval of ${tooYoung} (${String(catalog.get(tooYoung)?.refreshIntervalHours)} h)`,
        },
      ],
    );
  }
}

/** C106.2: a pinned list must be live; a template with none reads each report's. */
async function assertCustomListPublishable(
  db: Db,
  environmentId: string,
  type: ReportType,
  stored: Readonly<Record<string, unknown>>,
): Promise<void> {
  const pinned = stored['list-ids'] as readonly string[] | null | undefined;
  if (type !== 'custom-list' || pinned == null) {
    return;
  }
  const problems = await customListListProblems(db, environmentId, { pinned });
  const [first] = problems;
  if (first !== undefined) {
    throw new ListProblemError(first.code, first.detail, {
      errors: problems.map(({ pointer, detail }) => ({ location: 'body', pointer, detail })),
    });
  }
}

/** The template resource, with its published version resolved. */
export function reportTemplateResource(row: ReportTemplateWithVersion): ReportTemplateResource {
  return buildReportTemplateResource({
    id: row.id,
    name: row.name,
    reportType: row.reportType,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    currentVersion: {
      id: row.currentVersion.id,
      versionNumber: row.currentVersion.version,
      config: row.currentVersion.config,
      createdAt: row.currentVersion.createdAt,
      publishedAt: row.currentVersion.publishedAt,
    },
  });
}

/** The version resource, resolved. */
export function reportTemplateVersionResource(
  version: ReportTemplateVersionRow,
  reportType: ReportType,
): ReportTemplateVersionResource {
  return buildReportTemplateVersionResource({
    id: version.id,
    reportTemplateId: version.reportTemplateId,
    reportType,
    versionNumber: version.version,
    status: version.status,
    config: version.config,
    createdAt: version.createdAt,
    publishedAt: version.publishedAt,
  });
}

function audit(
  deps: Pick<ApiDependencies, 'audit'>,
  tx: Db,
  acting: ReportTemplateActing,
  action: AuditedAction,
): Promise<void> {
  return deps.audit.record(tx, auditEntryOf(acting.ctx, acting.actor, action));
}

/** @throws {NotFoundError} when the template is not in this environment. */
async function findTemplate(db: Db, environmentId: string, id: string) {
  const template = await getReportTemplate(db, environmentId, id);
  if (template === null) {
    throw new NotFoundError(`Report template ${id} was not found.`);
  }
  return template;
}

/** `POST /report-templates` (C71.1): the template and its version 1, published. */
export async function createReportTemplateResource(
  deps: ApiDependencies,
  acting: ReportTemplateActing,
  attributes: { 'report-type': ReportType; name: string; config?: unknown },
): Promise<ReportTemplateResource> {
  const { db, ids } = deps;
  const type = attributes['report-type'];
  const kind = await environmentKindOf(db, acting.ctx.environmentId);
  const config = await storedConfig(db, kind, type, attributes.config);
  assertPublishableConfig(kind, type, config);
  const template = await db.transaction(async (tx) => {
    const created = await createReportTemplate(tx, acting.ctx.environmentId, {
      id: ids.newId('rptp'),
      name: attributes.name,
      reportType: type,
      version: { id: ids.newId('rptpv'), config },
    });
    await audit(deps, tx, acting, {
      action: 'report-template.created',
      resourceType: 'report-template',
      resourceId: created.id,
      metadata: { 'report-type': type },
    });
    return created;
  });
  return reportTemplateResource(template);
}

/** @throws {NotFoundError} when the template is not in this environment. */
export async function getReportTemplateResource(
  { db }: ApiDependencies,
  environmentId: string,
  id: string,
): Promise<ReportTemplateResource> {
  return reportTemplateResource(await findTemplate(db, environmentId, id));
}

export interface ReportTemplateListQuery extends PageQuery {
  'filter[report-type]'?: string | undefined;
  'filter[status]'?: string | undefined;
}

export async function listReportTemplateResources(
  { db }: ApiDependencies,
  environmentId: string,
  query: ReportTemplateListQuery,
): Promise<{ data: ReportTemplateResource[]; links: { next: string | null } }> {
  const page = await withCursor(() =>
    listReportTemplates(db, environmentId, {
      ...pageRequest(query),
      reportType: filterValues(query['filter[report-type]'], reportTypeSchema),
      status: filterValues(query['filter[status]'], reportTemplateStatusSchema),
    }),
  );
  return {
    data: page.items.map(reportTemplateResource),
    links: {
      next: nextLink(
        REPORT_TEMPLATES_PATH,
        {
          'filter[report-type]': query['filter[report-type]'],
          'filter[status]': query['filter[status]'],
        },
        query,
        page.next,
      ),
    },
  };
}

/** `PATCH /report-templates/:id` (C71.1): the name and the status. */
export async function updateReportTemplateResource(
  deps: ApiDependencies,
  acting: ReportTemplateActing,
  id: string,
  attributes: { name?: string | undefined; status?: 'active' | 'archived' | undefined },
): Promise<ReportTemplateResource> {
  const updated = await deps.db.transaction(async (tx) => {
    const row = await updateReportTemplate(tx, acting.ctx.environmentId, id, attributes);
    if (row === null) {
      throw new NotFoundError(`Report template ${id} was not found.`);
    }
    await audit(deps, tx, acting, {
      action: 'report-template.updated',
      resourceType: 'report-template',
      resourceId: id,
      metadata: { attributes: Object.keys(attributes) },
    });
    return row;
  });
  return reportTemplateResource(updated);
}

/** The version and its template's type. @throws {NotFoundError} */
async function findVersion(db: Db, environmentId: string, id: string) {
  const version = await getReportTemplateVersion(db, environmentId, id);
  if (version === null) {
    throw new NotFoundError(`Report template version ${id} was not found.`);
  }
  const template = await findTemplate(db, environmentId, version.reportTemplateId);
  return { version, type: template.reportType };
}

const notDraft = (version: ReportTemplateVersionRow) =>
  new InvalidTransitionError(
    `Version ${String(version.version)} is ${version.status}; only drafts can change.`,
  );

/** `POST /report-template-versions` (C71.1): a draft numbered after the latest version. */
export async function createReportTemplateVersionResource(
  deps: ApiDependencies,
  acting: ReportTemplateActing,
  attributes: { 'report-template-id': string; config: Record<string, unknown> },
): Promise<ReportTemplateVersionResource> {
  const { db, ids } = deps;
  const templateId = attributes['report-template-id'];
  const template = await findTemplate(db, acting.ctx.environmentId, templateId);
  const kind = await environmentKindOf(db, acting.ctx.environmentId);
  const config = await storedConfig(db, kind, template.reportType, attributes.config);
  const version = await db.transaction(async (tx) => {
    const draft = await createDraftReportTemplateVersion(tx, acting.ctx.environmentId, templateId, {
      id: ids.newId('rptpv'),
      config,
    });
    if (draft === null) {
      throw new NotFoundError(`Report template ${templateId} was not found.`);
    }
    await audit(deps, tx, acting, {
      action: 'report-template-version.created',
      resourceType: 'report-template-version',
      resourceId: draft.id,
      metadata: { 'report-template-id': templateId, 'version-number': draft.version },
    });
    return draft;
  });
  return reportTemplateVersionResource(version, template.reportType);
}

/** @throws {NotFoundError} when the version is not in this environment. */
export async function getReportTemplateVersionResource(
  { db }: ApiDependencies,
  environmentId: string,
  id: string,
): Promise<ReportTemplateVersionResource> {
  const { version, type } = await findVersion(db, environmentId, id);
  return reportTemplateVersionResource(version, type);
}

export interface ReportTemplateVersionListQuery extends PageQuery {
  'filter[report-template-id]'?: string | undefined;
  'filter[status]'?: string | undefined;
}

export async function listReportTemplateVersionResources(
  { db }: ApiDependencies,
  environmentId: string,
  query: ReportTemplateVersionListQuery,
): Promise<{ data: ReportTemplateVersionResource[]; links: { next: string | null } }> {
  const page = await withCursor(() =>
    listReportTemplateVersions(db, environmentId, {
      ...pageRequest(query),
      reportTemplateId: filterValues(query['filter[report-template-id]'], idSchema('rptp')),
      status: filterValues(query['filter[status]'], reportTemplateVersionStatusSchema),
    }),
  );
  const types = new Map<string, ReportType>();
  for (const version of page.items) {
    if (!types.has(version.reportTemplateId)) {
      types.set(
        version.reportTemplateId,
        (await findTemplate(db, environmentId, version.reportTemplateId)).reportType,
      );
    }
  }
  return {
    data: page.items.map((version) =>
      reportTemplateVersionResource(version, types.get(version.reportTemplateId) ?? 'watchlist'),
    ),
    links: {
      next: nextLink(
        REPORT_TEMPLATE_VERSIONS_PATH,
        {
          'filter[report-template-id]': query['filter[report-template-id]'],
          'filter[status]': query['filter[status]'],
        },
        query,
        page.next,
      ),
    },
  };
}

/** `PATCH /report-template-versions/:id` (C71.1), drafts only: the configuration. */
export async function updateReportTemplateVersionResource(
  deps: ApiDependencies,
  acting: ReportTemplateActing,
  id: string,
  attributes: { config: Record<string, unknown> },
): Promise<ReportTemplateVersionResource> {
  const { db } = deps;
  const { version, type } = await findVersion(db, acting.ctx.environmentId, id);
  if (version.status !== 'draft') {
    throw notDraft(version);
  }
  const kind = await environmentKindOf(db, acting.ctx.environmentId);
  const config = await storedConfig(db, kind, type, attributes.config);
  const updated = await db.transaction(async (tx) => {
    const row = await updateDraftReportTemplateVersion(tx, acting.ctx.environmentId, id, config);
    if (row === null) {
      throw notDraft(version);
    }
    await audit(deps, tx, acting, {
      action: 'report-template-version.updated',
      resourceType: 'report-template-version',
      resourceId: id,
    });
    return row;
  });
  return reportTemplateVersionResource(updated, type);
}

/** `POST /report-template-versions/:id/publish` (C71.1): the publish rules hold under the lock. */
export async function publishReportTemplateVersionResource(
  deps: ApiDependencies,
  acting: ReportTemplateActing,
  id: string,
): Promise<ReportTemplateVersionResource> {
  const { db } = deps;
  const { type } = await findVersion(db, acting.ctx.environmentId, id);
  const kind = await environmentKindOf(db, acting.ctx.environmentId);
  const published = await db.transaction(async (tx) => {
    const result = await publishReportTemplateVersion(
      tx,
      acting.ctx.environmentId,
      id,
      async (draft) => {
        assertPublishableConfig(kind, type, draft.config);
        await assertCustomListPublishable(tx, acting.ctx.environmentId, type, draft.config);
      },
    );
    if (result === null) {
      throw new NotFoundError(`Report template version ${id} was not found.`);
    }
    if (result.status === 'not_draft') {
      throw notDraft(result.version);
    }
    await audit(deps, tx, acting, {
      action: 'report-template-version.published',
      resourceType: 'report-template-version',
      resourceId: id,
      metadata: {
        'report-template-id': result.version.reportTemplateId,
        'version-number': result.version.version,
      },
    });
    return result.version;
  });
  return reportTemplateVersionResource(published, type);
}
