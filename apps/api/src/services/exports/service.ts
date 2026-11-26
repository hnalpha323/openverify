/**
 * C166.1-C166.4, C166.6 (Workflow 9B): generic exports, ours, mirroring Phase 8's case exports
 * (C138.1, `services/cases/exports/service.ts`). Owner: `api-exports`. The route has already checked
 * `EXPORT_PERMISSIONS[object-type]` and counted the `exports` policy.
 *
 * - `POST /exports` (202): `filter` is read through the list route's own query schema, or the saved
 *   view `saved-view-id` names (`selection.ts`); the filters that need PII visibility are checked with
 *   the caller's (`filter[next-step-name]`, a transaction string field, `filter[identifier]`: 403);
 *   `include-personal-data` needs `pii:view` (403); a list export names a list with an importer (422
 *   otherwise). The row is written with its request sealed (the filter and the key's attribute
 *   blocklist, C169.3) and its `filter_keys`; one audit entry records the filter's keys only; the
 *   `export` job is enqueued after the commit (a lost enqueue is the sweep's).
 * - Reads are the creating principal's alone: another principal's export answers 404, as one that
 *   does not exist. Each read and download checks the export's own type permission again (403), and
 *   the list leaves out the types the caller no longer holds.
 * - `GET /exports/:id/download`: the completed file within its 24 hours (410 once expired, 404 before
 *   it is cut); `pii:view` again for a file with personal data (403); one audit entry per download.
 */
import {
  type createExportBodySchema,
  type ExportResource,
  type exportDocumentSchema,
  type exportListDocumentSchema,
  type listExportsQuerySchema,
} from '@openverify/contracts';
import {
  EXPORT_FORMATS,
  EXPORT_OBJECT_TYPES,
  EXPORT_PERMISSIONS,
  type ExportObjectType,
  type ExportStatus,
} from '@openverify/core';
import {
  createExportRow,
  getExportRow,
  listExportRows,
  type ExportCreator,
  type ExportRecord,
} from '@openverify/db';
import { z } from 'zod';
import { AppError, NotFoundError, PermissionDeniedError } from '../../errors.js';
import { authorizePrincipal } from '../../plugins/principal-auth.js';
import type { WorkflowActing } from '../../workflows/acting.js';
import { keyAttributeBlocklistOf } from '../api-keys/blocklist.js';
import { ObjectUnreadableError, openSealedObject } from '../cases/attachments/objects.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';
import { inquiryListFilters } from '../list-filters/inquiries.js';
import { transactionListFilters } from '../list-filters/transactions.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import { assertExportableList, exportSelectionOf, type ExportFilter } from './selection.js';

export type ExportDocument = z.infer<typeof exportDocumentSchema>;
export type ExportListDocument = z.infer<typeof exportListDocumentSchema>;

/** A downloaded export: the CSV, named by the server. */
export interface ExportFile {
  bytes: Uint8Array;
  filename: string;
}

export type CreateExport = (
  deps: ApiDependencies,
  acting: WorkflowActing,
  body: z.infer<typeof createExportBodySchema>,
) => Promise<ExportDocument>;
export type ListExports = (
  deps: ApiDependencies,
  acting: WorkflowActing,
  query: z.infer<typeof listExportsQuerySchema>,
) => Promise<ExportListDocument>;
export type GetExport = (
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
) => Promise<ExportDocument>;
export type DownloadExport = (
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
) => Promise<ExportFile>;

/** What the sealed request holds: the filter with its values, and the key's blocklist (C169.3). */
export interface ExportRequest {
  filter: ExportFilter;
  blocklist: readonly string[];
}

const EXPORTS_PATH = '/api/v1/exports';

/** C143.5's rule: the audit metadata of an export, its shape only, by a strict schema. */
const filterKey = z.string().regex(/^filter\[[a-z0-9_.\-[\]]{1,96}\]$/);
const EXPORT_AUDIT = {
  'export.created': z.strictObject({
    'object-type': z.enum(EXPORT_OBJECT_TYPES),
    format: z.enum(EXPORT_FORMATS),
    'include-personal-data': z.boolean(),
    'filter-keys': z.array(filterKey).max(100),
    'saved-view-id': z
      .string()
      .regex(/^svw_[0-9A-HJKMNP-TV-Z]{26}$/)
      .nullable(),
  }),
  'export.downloaded': z.strictObject({
    'object-type': z.enum(EXPORT_OBJECT_TYPES),
    'include-personal-data': z.boolean(),
    'row-count': z.int().min(0),
  }),
} as const;

function exportAudit<Action extends keyof typeof EXPORT_AUDIT>(
  action: Action,
  id: string,
  metadata: z.input<(typeof EXPORT_AUDIT)[Action]>,
) {
  return {
    action,
    resourceType: 'export',
    resourceId: id,
    metadata: EXPORT_AUDIT[action].parse(metadata) as Record<string, unknown>,
  };
}

/** The creator an acting principal is; a workflow run never exports. */
function creatorOf(acting: WorkflowActing): ExportCreator {
  if (acting.actor.type === 'workflow-run') {
    throw new PermissionDeniedError('A workflow run does not export.');
  }
  return { type: acting.actor.type, id: acting.actor.id };
}

/** C166.6: the export as its creator reads it; its filter's keys, never a value. */
export function exportResource(row: ExportRecord): ExportResource {
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  return {
    type: 'export',
    id: row.id,
    attributes: {
      'object-type': row.objectType,
      format: row.format,
      status: row.status,
      'filter-keys': [...row.filterKeys],
      'saved-view-id': row.savedViewId,
      'include-personal-data': row.includePersonalData,
      'row-count': row.rowCount,
      'byte-size': row.byteSize,
      'error-code': row.errorCode,
      'created-at': row.createdAt.toISOString(),
      'cut-at': iso(row.cutAt),
      'completed-at': iso(row.completedAt),
      'expires-at': iso(row.expiresAt),
    },
  };
}

/** P26: the creator's own export, with its type still permitted; anyone else's reads as missing. */
async function ownExport(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
): Promise<ExportRecord> {
  const creator = creatorOf(acting);
  const row = await getExportRow(deps.db, acting.ctx.environmentId, id);
  if (row?.creatorType !== creator.type || row.creatorId !== creator.id) {
    throw new NotFoundError(`Export ${id} was not found.`);
  }
  authorizePrincipal(acting.principal, [EXPORT_PERMISSIONS[row.objectType]]);
  return row;
}

/** The filters that need PII visibility, checked with the caller's, as the list routes check them. */
async function checkFilter(
  deps: ApiDependencies,
  acting: WorkflowActing,
  objectType: ExportObjectType,
  filter: ExportFilter,
): Promise<void> {
  const environmentId = acting.ctx.environmentId;
  const piiVisible = acting.mask.visible;
  if (objectType === 'inquiries') {
    await inquiryListFilters(deps.db, { environmentId, query: filter, piiVisible });
  } else if (objectType === 'transactions') {
    await transactionListFilters(deps.db, {
      environmentId,
      query: filter as never,
      piiVisible,
      blindIndexKey: deps.blindIndexKey,
    });
  } else if (objectType === 'lists') {
    await assertExportableList(deps.db, environmentId, filter);
  }
}

export const createExport: CreateExport = async (deps, acting, body) => {
  const { environmentId } = acting.ctx;
  const attributes = body.data.attributes;
  const objectType = attributes['object-type'];
  const creator = creatorOf(acting);
  const includePersonalData = attributes['include-personal-data'] ?? false;
  if (includePersonalData && !acting.mask.visible) {
    throw new PermissionDeniedError('An export with personal data needs pii:view.', ['pii:view']);
  }
  const selection = await exportSelectionOf(deps.db, acting.principal, attributes);
  await checkFilter(deps, acting, objectType, selection.filter);
  const id = deps.ids.newId('exp');
  const filterKeys = Object.keys(selection.filter).sort();
  const request: ExportRequest = {
    filter: selection.filter,
    blocklist: keyAttributeBlocklistOf(acting.principal),
  };
  const row = await deps.db.transaction(async (tx) => {
    const made = await createExportRow(tx, environmentId, {
      id,
      creator,
      objectType,
      format: attributes.format,
      includePersonalData,
      request: request as unknown as Record<string, unknown>,
      filterKeys,
      savedViewId: selection.savedViewId,
      at: deps.clock.now(),
    });
    await deps.audit.record(
      tx,
      auditEntryOf(
        acting.ctx,
        acting.actor,
        exportAudit('export.created', id, {
          'object-type': objectType,
          format: attributes.format,
          'include-personal-data': includePersonalData,
          'filter-keys': filterKeys,
          'saved-view-id': selection.savedViewId,
        }),
      ),
    );
    return made;
  });
  try {
    await deps.exports?.enqueueExport({ environmentId, exportId: id });
  } catch {
    // The export is pending, so the sweep enqueues it again.
  }
  return { data: exportResource(row) };
};

const listOf = (value: string | undefined): string[] | undefined => value?.split(',');

export const listExports: ListExports = async (deps, acting, query) => {
  const asked = listOf(query['filter[object-type]']) as ExportObjectType[] | undefined;
  const held = EXPORT_OBJECT_TYPES.filter(
    (type) =>
      acting.principal.permissions.has(EXPORT_PERMISSIONS[type]) &&
      (asked === undefined || asked.includes(type)),
  );
  const page =
    held.length === 0
      ? { items: [], next: null }
      : await withCursor(() =>
          listExportRows(deps.db, acting.ctx.environmentId, {
            creator: creatorOf(acting),
            statuses: listOf(query['filter[status]']) as ExportStatus[] | undefined,
            objectTypes: held,
            page: pageRequest(query),
          }),
        );
  return {
    data: page.items.map(exportResource),
    links: {
      next: nextLink(
        EXPORTS_PATH,
        {
          'filter[status]': query['filter[status]'],
          'filter[object-type]': query['filter[object-type]'],
        },
        query,
        page.next,
      ),
    },
  };
};

export const getExport: GetExport = async (deps, acting, id) => ({
  data: exportResource(await ownExport(deps, acting, id)),
});

export const downloadExport: DownloadExport = async (deps, acting, id) => {
  const row = await ownExport(deps, acting, id);
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
      exportAudit('export.downloaded', row.id, {
        'object-type': row.objectType,
        'include-personal-data': row.includePersonalData,
        'row-count': row.rowCount ?? 0,
      }),
    ),
  );
  return { bytes, filename: `export-${row.objectType}-${row.id}.csv` };
};
