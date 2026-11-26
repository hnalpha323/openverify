/**
 * C138.1, C138.2 (Workflow 8B (F); P19, P26): the export routes' services. Owner `api-case-files`.
 *
 * - {@link createCaseExport}: under `case-exports` (10 an hour per environment, C143.3, following C12:
 *   429 past it, through when the limiter cannot answer); `include-personal-data` needs `pii:view`
 *   (403); the selection is decided now (`selection.ts`: at most 10,000 cases, 422
 *   `export_too_large`) and sealed with the pending row; its audit entry records the selection's shape
 *   alone; the job is enqueued after the commit, and the answer is 202 with the export.
 * - Only the creating principal lists, reads and downloads an export: another gets 404, as for one
 *   that does not exist (P26).
 * - {@link downloadCaseExport}: the completed file within its 24 hours (410 once expired, 404 before it
 *   is made); `cases:export` is the route's, and `pii:view` is checked again when the file holds
 *   personal data, so a creator who has since lost either is refused; audited.
 */
import {
  buildCaseExportResource,
  type CaseExportDocument,
  type CaseExportListDocument,
  type CaseExportResource,
  type CreateCaseExportBody,
  type ListCaseExportsQuery,
} from '@openverify/contracts';
import {
  createCaseExportRow,
  getCaseExportRow,
  listCaseExports as listCaseExportRows,
  type CaseExport,
  type CaseExportCreator,
} from '@openverify/db';
import {
  AppError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitedError,
} from '../../../errors.js';
import { rateLimitRules } from '../../../plugins/rate-limit.js';
import { auditEntryOf, type ApiDependencies } from '../../context.js';
import { nextLink, pageRequest, withCursor } from '../../pagination.js';
import { caseFileAudit } from '../attachments/audit.js';
import { ObjectUnreadableError, openSealedObject } from '../attachments/objects.js';
import type { CaseActing } from '../service.js';
import { filterList } from '../shared.js';
import { exportShapeOf, selectExportCaseIds } from './selection.js';

/** A downloaded export file: CSV or the JSON bundle, named by the server. */
export interface CaseExportFile {
  bytes: Uint8Array;
  mediaType: 'text/csv; charset=utf-8' | 'application/json';
  filename: string;
}

const EXPORTS_PATH = '/api/v1/case-exports';

/** The creator an acting principal is; a run never exports. */
function creatorOf(acting: CaseActing): CaseExportCreator {
  if (acting.actor.type === 'workflow-run') {
    throw new PermissionDeniedError('A workflow run does not export cases.');
  }
  return { type: acting.actor.type, id: acting.actor.id };
}

/** C138.1: the export as its creator reads it; nothing names a filter or a value. */
export function caseExportResource(row: CaseExport): CaseExportResource {
  return buildCaseExportResource({
    id: row.id,
    status: row.status,
    format: row.format,
    includePersonalData: row.includePersonalData,
    caseCount: row.caseCount,
    byteSize: row.byteSize,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt,
  });
}

/** P26: the creator's own export; anyone else's reads as one that does not exist. */
async function ownExport(deps: ApiDependencies, acting: CaseActing, id: string) {
  const creator = creatorOf(acting);
  const row = await getCaseExportRow(deps.db, acting.ctx.environmentId, id);
  if (row?.creatorType !== creator.type || row.creatorId !== creator.id) {
    throw new NotFoundError(`Case export ${id} was not found.`);
  }
  return row;
}

/** C143.3: `case-exports`, 10 an hour per environment; 429 past it, through when unanswered. */
async function consumeExports(deps: Pick<ApiDependencies, 'rateLimiter'>, environmentId: string) {
  let decision;
  try {
    decision = await deps.rateLimiter.consume(
      `case-exports:${environmentId}`,
      rateLimitRules()['case-exports'],
    );
  } catch {
    return;
  }
  if (!decision.allowed) {
    throw new RateLimitedError('Too many case exports; retry later.', decision.retryAfterSeconds);
  }
}

export async function createCaseExport(
  deps: ApiDependencies,
  acting: CaseActing,
  body: CreateCaseExportBody,
): Promise<CaseExportDocument> {
  const { environmentId } = acting.ctx;
  const attributes = body.data.attributes;
  const creator = creatorOf(acting);
  const includePersonalData = attributes['include-personal-data'] ?? false;
  if (includePersonalData && !acting.mask.visible) {
    throw new PermissionDeniedError('An export with personal data needs pii:view.', ['pii:view']);
  }
  await consumeExports(deps, environmentId);
  const caseIds = await selectExportCaseIds(deps, acting, attributes);
  const id = deps.ids.newId('cexp');
  const row = await deps.db.transaction(async (tx) => {
    const made = await createCaseExportRow(tx, environmentId, {
      id,
      creator,
      format: attributes.format,
      includePersonalData,
      request: { 'case-ids': caseIds },
    });
    await deps.audit.record(
      tx,
      auditEntryOf(
        acting.ctx,
        acting.actor,
        caseFileAudit('case-export.created', id, {
          format: attributes.format,
          'include-personal-data': includePersonalData,
          shape: exportShapeOf(attributes),
        }),
      ),
    );
    return made;
  });
  await deps.caseExports?.enqueueCaseExport({ environmentId, caseExportId: id });
  return { data: caseExportResource(row) };
}

export async function listCaseExports(
  deps: ApiDependencies,
  acting: CaseActing,
  query: ListCaseExportsQuery,
): Promise<CaseExportListDocument> {
  const statuses = filterList(query['filter[status]']) as CaseExport['status'][] | undefined;
  const page = await withCursor(() =>
    listCaseExportRows(deps.db, acting.ctx.environmentId, {
      creator: creatorOf(acting),
      statuses,
      page: pageRequest(query),
    }),
  );
  return {
    data: page.items.map(caseExportResource),
    links: {
      next: nextLink(EXPORTS_PATH, { 'filter[status]': query['filter[status]'] }, query, page.next),
    },
  };
}

export async function getCaseExport(
  deps: ApiDependencies,
  acting: CaseActing,
  exportId: string,
): Promise<CaseExportDocument> {
  return { data: caseExportResource(await ownExport(deps, acting, exportId)) };
}

export async function downloadCaseExport(
  deps: ApiDependencies,
  acting: CaseActing,
  exportId: string,
): Promise<CaseExportFile> {
  const row = await ownExport(deps, acting, exportId);
  const lapsed = row.expiresAt !== null && row.expiresAt.getTime() <= deps.clock.now().getTime();
  if (row.status === 'expired' || (row.status === 'completed' && lapsed)) {
    throw new AppError({
      status: 410,
      detail: 'This export’s file was deleted when its 24 hours ran out.',
    });
  }
  if (row.status !== 'completed' || row.storageKey === null || row.wrappedDek === null) {
    throw new NotFoundError('This export has no file yet.');
  }
  if (row.includePersonalData && !acting.mask.visible) {
    throw new PermissionDeniedError(
      'This export holds personal data: downloading it needs pii:view.',
      ['pii:view'],
    );
  }
  let bytes: Buffer;
  try {
    bytes = await openSealedObject(deps, {
      storageKey: row.storageKey,
      wrappedDek: row.wrappedDek,
      context: row.id,
      ...(row.byteSize === null ? {} : { byteSize: row.byteSize }),
    });
  } catch (error) {
    if (error instanceof ObjectUnreadableError) {
      throw new NotFoundError('The file of this export is not available.');
    }
    throw error;
  }
  await deps.audit.record(
    deps.db,
    auditEntryOf(
      acting.ctx,
      acting.actor,
      caseFileAudit('case-export.downloaded', row.id, {
        format: row.format,
        'include-personal-data': row.includePersonalData,
        'case-count': row.caseCount ?? 0,
      }),
    ),
  );
  return row.format === 'csv'
    ? { bytes, mediaType: 'text/csv; charset=utf-8', filename: `case-export-${row.id}.csv` }
    : { bytes, mediaType: 'application/json', filename: `case-export-${row.id}.json` };
}
