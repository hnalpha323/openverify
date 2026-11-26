/**
 * C100.1, C100.2, C100.5 (Workflow 7B): the importer routes' service. Owner: `api-importers`.
 *
 * A create stores the file as an envelope object, writes the row and enqueues the `list-import` job;
 * the sweep recovers a lost enqueue. The row keeps the object's key and wrapped DEK, because `files`
 * requires a verification.
 *
 * Two uploads of one file are serialised, so the second finds the first's row: the same list, mode,
 * encoding and SHA-256 within 24 hours answers that importer and consumes nothing. The encoding is
 * part of that key, or a file refused as invalid UTF-8 could not come back under its real encoding.
 */
import { createHash } from 'node:crypto';
import {
  buildImporterResource,
  filterValues,
  idSchema,
  IMPORT_LIMITS,
  type ImporterDocument,
  type ImporterErrorListDocument,
  type importerListDocumentSchema,
  type listImporterErrorsQuerySchema,
  type listImportersQuerySchema,
  type ListKind,
} from '@openverify/contracts';
import { importerStatusSchema, toImporterResourceType } from '@openverify/core';
import {
  createImporter as insertImporter,
  encryptBytes,
  findRecentImporter,
  getImporter,
  getImportList,
  listImporterErrors as listStoredImporterErrors,
  listImporters as listStoredImporters,
  lockImportFile,
  markImportersEnqueued,
  type Db,
  type ImporterRow,
} from '@openverify/db';
import type { z } from 'zod';
import { ListProblemError, NotFoundError, RateLimitedError } from '../../errors.js';
import { rateLimitRules } from '../../plugins/rate-limit.js';
import { newStorageKey } from '../../storage/index.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';
import type { ListActing } from '../lists/lists.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import { resolveImportEncoding } from './encoding.js';
import { readImporterUpload, type ImporterBody, type ImporterUpload } from './upload.js';

export type { ImporterBody } from './upload.js';
export type ListImportersQuery = z.infer<typeof listImportersQuerySchema>;
export type ListImporterErrorsQuery = z.infer<typeof listImporterErrorsQuerySchema>;

const IMPORTERS_PATH = '/api/v1/importers';
const HOUR_MS = 3_600_000;
const DEFAULT_ERROR_PAGE = 10;

const importerDocument = (kind: ListKind, row: ImporterRow): ImporterDocument => ({
  data: buildImporterResource({ ...row, kind }),
});

/**
 * C100.2, C107.3: the `importers` policy, keyed by environment. The limiter failing open, as C12
 * does.
 * @throws {RateLimitedError} 429 with `Retry-After` beyond the limit.
 */
export async function consumeImporterRate(
  deps: Pick<ApiDependencies, 'rateLimiter'>,
  environmentId: string,
): Promise<void> {
  let decision;
  try {
    decision = await deps.rateLimiter.consume(
      `importers:${environmentId}`,
      rateLimitRules().importers,
    );
  } catch {
    return;
  }
  if (!decision.allowed) {
    throw new RateLimitedError(
      'This environment started too many imports; retry later.',
      decision.retryAfterSeconds,
    );
  }
}

/** The list an upload fills: its own, of this kind, and still active. */
async function assertImportableList(
  db: Db,
  environmentId: string,
  listId: string,
  kind: ListKind,
): Promise<void> {
  const list = await getImportList(db, environmentId, listId);
  if (list === null) {
    throw new NotFoundError(`List ${listId} was not found.`);
  }
  if (list.kind !== kind) {
    throw new ListProblemError(
      'list_kind_mismatch',
      `List ${listId} does not hold items of this kind.`,
      {
        errors: [
          {
            location: 'body',
            pointer: '/data/attributes/list-id',
            detail: `must be a ${kind} list`,
          },
        ],
      },
    );
  }
  if (list.status === 'archived') {
    throw new ListProblemError('list_archived', `List ${listId} is archived.`);
  }
}

/** The WHATWG name of the upload's encoding: UTF-8 or a single-byte encoding (decision 31). */
function encodingOf(upload: ImporterUpload): string {
  const encoding = resolveImportEncoding(upload.encoding);
  if (encoding === null) {
    throw new ListProblemError('invalid_value', 'This encoding cannot be imported.', {
      errors: [
        {
          location: 'body',
          pointer: '/data/attributes/encoding',
          detail: 'must be utf-8 or a WHATWG single-byte encoding',
        },
      ],
    });
  }
  return encoding;
}

async function enqueue(
  deps: ApiDependencies,
  environmentId: string,
  importerId: string,
): Promise<void> {
  if (deps.listImports === undefined) {
    return;
  }
  const rows = [{ environmentId, id: importerId }];
  try {
    // Recorded before the job exists: a write after it could meet the job's SKIP LOCKED.
    await markImportersEnqueued(deps.db, rows, deps.clock.now());
    await deps.listImports.enqueueListImport({ environmentId, importerId });
  } catch {
    // C100.2: the row is pending, so the next sweep enqueues it.
    await markImportersEnqueued(deps.db, rows, null).catch(() => undefined);
  }
}

interface StoredUpload {
  row: ImporterRow;
  /** Whether this request made the row, rather than finding one. */
  created: boolean;
}

/** Stores the object and the row, or finds the row of an earlier upload of this file. */
async function storeUpload(
  deps: ApiDependencies,
  acting: ListActing,
  kind: ListKind,
  upload: ImporterUpload,
  encoding: string,
): Promise<StoredUpload> {
  const { db, clock, ids, storage, keyring } = deps;
  const { environmentId } = acting.ctx;
  const { listId, mode, bytes } = upload;
  const fileSha256 = createHash('sha256').update(bytes).digest('hex');
  const id = ids.newId('mprt');
  const storageKey = newStorageKey(environmentId);
  const written: string[] = [];
  try {
    return await db.transaction(async (tx) => {
      await lockImportFile(tx, environmentId, { listId, mode, encoding, fileSha256 });
      const since = new Date(clock.now().getTime() - IMPORT_LIMITS.fileIdempotencyHours * HOUR_MS);
      const found = await findRecentImporter(tx, environmentId, {
        listId,
        mode,
        encoding,
        fileSha256,
        since,
      });
      if (found !== null) {
        return { row: found, created: false };
      }
      await consumeImporterRate(deps, environmentId);
      const sealed = encryptBytes(bytes, keyring, { context: id });
      await storage.put(storageKey, sealed.ciphertext);
      written.push(storageKey);
      const row = await insertImporter(tx, environmentId, {
        id,
        listId,
        mode,
        encoding,
        fileSha256,
        fileBytes: bytes.byteLength,
        storageKey,
        wrappedDek: sealed.wrappedDek,
        createdAt: clock.now(),
      });
      await deps.audit.record(
        tx,
        auditEntryOf(acting.ctx, acting.actor, {
          action: 'importer.created',
          resourceType: 'importer',
          resourceId: id,
          metadata: {
            'list-id': listId,
            'importer-type': toImporterResourceType(kind),
            mode,
            encoding,
            'file-bytes': bytes.byteLength,
          },
        }),
      );
      return { row, created: true };
    });
  } catch (error) {
    await Promise.allSettled(written.map((key) => storage.delete(key)));
    throw error;
  }
}

/**
 * `POST /importer/list-item/<plural>`.
 * @throws {RateLimitedError} 429 beyond the `importers` policy.
 * @throws {ListProblemError} 409 `list_archived`; 422 `list_kind_mismatch` or `invalid_value`.
 */
export async function createImporter(
  deps: ApiDependencies,
  acting: ListActing,
  kind: ListKind,
  body: ImporterBody,
  contentType: string,
): Promise<ImporterDocument> {
  const { environmentId } = acting.ctx;
  const upload = await readImporterUpload(body, contentType);
  const encoding = encodingOf(upload);
  await assertImportableList(deps.db, environmentId, upload.listId, kind);
  const { row, created } = await storeUpload(deps, acting, kind, upload, encoding);
  if (created) {
    await enqueue(deps, environmentId, row.id);
  }
  return importerDocument(kind, row);
}

/** `GET /importers`, newest first. */
export async function listImporters(
  deps: ApiDependencies,
  acting: ListActing,
  query: ListImportersQuery,
): Promise<z.infer<typeof importerListDocumentSchema>> {
  const listIds = filterValues(query['filter[list-id]'], idSchema('lst'));
  const statuses = filterValues(query['filter[status]'], importerStatusSchema);
  const page = await withCursor(() =>
    listStoredImporters(
      deps.db,
      acting.ctx.environmentId,
      { listIds, statuses },
      pageRequest(query),
    ),
  );
  const filters = Object.fromEntries(
    Object.entries(query).filter(([key]) => key.startsWith('filter[')),
  ) as Record<string, string | undefined>;
  return {
    data: page.items.map((row) => buildImporterResource(row)),
    links: { next: nextLink(IMPORTERS_PATH, filters, query, page.next) },
  };
}

/** `GET /importers/:id`. */
export async function getImporterDocument(
  deps: ApiDependencies,
  acting: ListActing,
  id: string,
): Promise<ImporterDocument> {
  const row = await getImporter(deps.db, acting.ctx.environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Importer ${id} was not found.`);
  }
  return importerDocument(row.kind, row);
}

/**
 * `GET /importers/:id/errors`, in row order. `page[after]` is a row, because an error has no id of
 * its own. The first page leads with the errors of the whole file, which have no row to page by.
 */
export async function listImporterErrors(
  deps: ApiDependencies,
  acting: ListActing,
  id: string,
  query: ListImporterErrorsQuery,
): Promise<ImporterErrorListDocument> {
  const { environmentId } = acting.ctx;
  if ((await getImporter(deps.db, environmentId, id)) === null) {
    throw new NotFoundError(`Importer ${id} was not found.`);
  }
  const size = query['page[size]'] ?? DEFAULT_ERROR_PAGE;
  const errors = await listStoredImporterErrors(deps.db, environmentId, id, {
    afterRow: query['page[after]'] ?? 0,
    limit: size + 1,
  });
  const numbered = errors.filter(({ row }) => row !== null);
  const more = numbered.length > size;
  const data = more ? errors.slice(0, -1) : errors;
  const last = data.at(-1)?.row ?? null;
  const next = more && last !== null ? String(last) : null;
  return {
    data,
    links: {
      next: nextLink(
        `${IMPORTERS_PATH}/${id}/errors`,
        {},
        { 'page[size]': query['page[size]'] },
        next,
      ),
    },
  };
}
