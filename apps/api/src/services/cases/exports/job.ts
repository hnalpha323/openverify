/**
 * C138.1, C138.2 (Workflow 8B, `api-case-files`; decision 69, P19): the `case-export` job.
 *
 * - One job claims a pending export (`FOR UPDATE SKIP LOCKED`), reads the cases its sealed request
 *   names again with the creator's visibility (a case the creator can no longer see is left out), and
 *   writes the file: CSV through Phase 7's neutralising writer, one row per case in
 *   `CASE_EXPORT_CSV_COLUMNS` order, with `fields` (one JSON cell) only with personal data; or the JSON
 *   bundle (`caseExportBundleSchema`), each case with its timeline, comments and held objects' ids and
 *   types, masked unless it holds personal data. Comments never go in a CSV. Redacted content reads
 *   "redacted" in a CSV and `null` in JSON, never as an empty value (C138.4).
 * - The file is sealed (the export's id as its context) and kept 24 hours; the completion drops the
 *   request (P19), writes an `exported` history row and stages `case.exported` per case in one
 *   transaction, and dispatches the events after the commit.
 * - A failure records `export_failed` and deletes a file already put. Nothing here logs a value.
 * - Workflow 8C review R006: a file holds at most `CASE_LIMITS['export-bytes']`; past it the export
 *   fails with `export_too_large`, written as soon as the text passes the limit, so a JSON bundle is
 *   built case by case (each entry checked by its own schema and written out at once, each timeline
 *   and comment page counted as it is read), so it never holds much more than the limit and one
 *   case's pages. The file is still sealed and put whole, because the storage port and the sealing
 *   take one object.
 */
import { writeCsv } from '@openverify/checks';
import {
  CASE_EXPORT_CSV_COLUMNS,
  CASE_EXPORT_PERSONAL_DATA_COLUMNS,
  caseExportBundleEntrySchema,
  caseExportBundleSchema,
} from '@openverify/contracts';
import { CASE_LIMITS } from '@openverify/core';
import {
  appendCaseHistory,
  claimCaseExportRow,
  completeCaseExportRow,
  encryptBytes,
  failCaseExportRow,
  getCaseRows,
  listCaseCommentRows,
  listCaseHistoryRows,
  listHeldObjectIdsOfCases,
  type Case,
  type CaseExport,
  type CaseHeldObjectId,
  type CaseReader,
} from '@openverify/db';
import { piiMaskFor, UNMASKED, type PiiMask } from '../../../auth/pii.js';
import type { StagedEvent } from '../../../events/index.js';
import type { CaseFileJobDeps } from '../../../jobs/cases/index.js';
import type { Principal } from '../../../ports.js';
import { newStorageKey } from '../../../storage/index.js';
import { caseAttachmentsOf } from '../attachments/resources.js';
import {
  caseCommentResource,
  caseEventResource,
  caseHistoryResource,
  caseResource,
} from '../resources.js';

/** A failure no problem code names: the job could not write the file. */
export const EXPORT_FAILED = 'export_failed';

/** R006: the file would pass its byte limit; recorded as the problem code `export_too_large`. */
export class ExportTooLargeError extends Error {
  override name = 'ExportTooLargeError';
}

/** The text of a file, counted against its limit as it is written. */
class BoundedText {
  private readonly parts: string[] = [];
  private bytes = 0;

  constructor(private readonly limit: number) {}

  /** Counts `text` without keeping it: what a page read costs before it is written. */
  count(text: string): void {
    if (this.bytes + Buffer.byteLength(text, 'utf8') > this.limit) {
      throw new ExportTooLargeError('the export passes its byte limit');
    }
  }

  push(text: string): void {
    this.count(text);
    this.bytes += Buffer.byteLength(text, 'utf8');
    this.parts.push(text);
  }

  toString(): string {
    return this.parts.join('');
  }
}

/** C138.1 (decision 69): how long a file is kept. */
export const EXPORT_KEPT_MS = CASE_LIMITS['export-hours'].value * 60 * 60 * 1000;

/** The mask of a reader without `pii:view`: what an export without personal data serves. */
const MASKED: PiiMask = piiMaskFor({ kind: 'api-key', piiMasked: true } as unknown as Principal);

const REDACTED = 'redacted';

const HELD_COLUMNS: Readonly<Record<string, CaseHeldObjectId['objectType'][]>> = {
  'account-ids': ['account'],
  'inquiry-ids': ['inquiry'],
  'report-ids': ['report'],
  'report-run-ids': ['report-run'],
  'transaction-ids': ['transaction'],
  'verification-ids': ['verification', 'document'],
  'graph-query-ids': ['graph-query'],
};

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

function readerOfCreator(row: CaseExport): CaseReader {
  return row.creatorType === 'user'
    ? { kind: 'user', userId: row.creatorId }
    : { kind: 'api-key', apiKeyId: row.creatorId };
}

function heldBy(held: readonly CaseHeldObjectId[]): Map<string, CaseHeldObjectId[]> {
  const byCase = new Map<string, CaseHeldObjectId[]>();
  for (const object of held) {
    byCase.set(object.caseId, [...(byCase.get(object.caseId) ?? []), object]);
  }
  return byCase;
}

/** C138.2: the CSV, one row per case. */
function csvOf(
  rows: readonly Case[],
  held: Map<string, CaseHeldObjectId[]>,
  includePersonalData: boolean,
  limit: number,
): string {
  const text = new BoundedText(limit);
  text.push(csvTextOf(rows, held, includePersonalData));
  return text.toString();
}

function csvTextOf(
  rows: readonly Case[],
  held: Map<string, CaseHeldObjectId[]>,
  includePersonalData: boolean,
): string {
  const header = [
    ...CASE_EXPORT_CSV_COLUMNS,
    ...(includePersonalData ? CASE_EXPORT_PERSONAL_DATA_COLUMNS : []),
  ];
  return writeCsv(
    header,
    rows.map((row) => {
      const objects = held.get(row.id) ?? [];
      const idsOf = (column: string) =>
        objects
          .filter(({ objectType }) => HELD_COLUMNS[column]?.includes(objectType))
          .map(({ objectId }) => objectId)
          .join(' ');
      const redacted = row.redactedAt !== null;
      return [
        row.id,
        row.name,
        row.caseTemplateId,
        row.status,
        row.statusCategory,
        row.resolution,
        row.caseQueueId,
        row.assigneeId,
        iso(row.createdAt),
        iso(row.assignedAt),
        iso(row.resolvedAt),
        row.slaState,
        iso(row.slaExpiresAt),
        redacted ? REDACTED : row.tags.join(' '),
        ...Object.keys(HELD_COLUMNS).map(idsOf),
        ...(includePersonalData
          ? [redacted || row.fields === null ? REDACTED : JSON.stringify(row.fields)]
          : []),
      ];
    }),
  );
}

/** Every page of a case's timeline or comments, each counted against the file's limit as read. */
async function everyPage<T>(
  text: BoundedText,
  read: (after: string | number | undefined) => Promise<{ items: T[]; next: string | null }>,
  shown: (item: T) => unknown,
): Promise<T[]> {
  const all: T[] = [];
  let counted = '';
  let after: string | number | undefined;
  for (;;) {
    const page = await read(after);
    all.push(...page.items);
    counted += JSON.stringify(page.items.map(shown));
    text.count(counted);
    if (page.next === null) {
      return all;
    }
    after = page.next;
  }
}

/** C138.2: the JSON bundle, written one checked entry at a time (R006). */
async function bundleOf(
  deps: CaseFileJobDeps,
  row: CaseExport,
  rows: readonly Case[],
  held: Map<string, CaseHeldObjectId[]>,
  exportedAt: Date,
  limit: number,
): Promise<string> {
  const { environmentId } = row;
  const mask = row.includePersonalData ? UNMASKED : MASKED;
  const meta = caseExportBundleSchema.shape.meta.parse({
    'case-export-id': row.id,
    'exported-at': exportedAt.toISOString(),
    'include-personal-data': row.includePersonalData,
    'case-count': rows.length,
  });
  const text = new BoundedText(limit);
  text.push('{"data":[');
  for (const [index, each] of rows.entries()) {
    const resource = await caseResource(deps.db, environmentId, each, mask);
    const attachments = mask.attributes({
      attachments: await caseAttachmentsOf(deps.db, environmentId, each.id),
    });
    const history = await everyPage(
      text,
      (after) =>
        listCaseHistoryRows(deps.db, environmentId, each.id, {
          size: 100,
          ...(after === undefined ? {} : { after: Number(after) }),
        }),
      caseHistoryResource,
    );
    const comments = await everyPage(
      text,
      (after) =>
        listCaseCommentRows(deps.db, environmentId, each.id, {
          size: 100,
          ...(after === undefined ? {} : { after: String(after) }),
        }),
      (comment) => caseCommentResource(comment, mask),
    );
    const entry = caseExportBundleEntrySchema.parse({
      case: { ...resource, attributes: { ...resource.attributes, ...attachments } },
      history: history.map(caseHistoryResource),
      comments: comments.map((comment) => caseCommentResource(comment, mask)),
      'held-objects': (held.get(each.id) ?? []).map(({ objectType, objectId }) => ({
        type: objectType,
        id: objectId,
      })),
    });
    text.push(`${index === 0 ? '' : ','}${JSON.stringify(entry)}`);
  }
  text.push(`],"meta":${JSON.stringify(meta)}}`);
  return text.toString();
}

/** Runs one export; one already claimed, finished or gone is left as it is. */
export async function runCaseExport(
  deps: CaseFileJobDeps,
  environmentId: string,
  exportId: string,
): Promise<void> {
  const claimed = await deps.db.transaction((tx) =>
    claimCaseExportRow(tx, environmentId, exportId, { now: deps.clock.now() }),
  );
  if (claimed === null) {
    return;
  }
  let storageKey: string | null = null;
  try {
    const ids = (claimed.request?.['case-ids'] ?? []) as string[];
    const rows = await getCaseRows(deps.db, environmentId, readerOfCreator(claimed), ids);
    const held = heldBy(
      await listHeldObjectIdsOfCases(
        deps.db,
        environmentId,
        rows.map(({ id }) => id),
      ),
    );
    const exportedAt = deps.clock.now();
    const limit = deps.exportByteLimit ?? CASE_LIMITS['export-bytes'].value;
    const text =
      claimed.format === 'csv'
        ? csvOf(rows, held, claimed.includePersonalData, limit)
        : await bundleOf(deps, claimed, rows, held, exportedAt, limit);
    const bytes = Buffer.from(text, 'utf8');
    const sealed = encryptBytes(bytes, deps.keyring, { context: exportId });
    storageKey = newStorageKey(environmentId);
    await deps.storage.put(storageKey, sealed.ciphertext);
    const key = storageKey;
    const staged: StagedEvent[] = [];
    await deps.db.transaction(async (tx) => {
      const done = await completeCaseExportRow(tx, environmentId, exportId, {
        caseCount: rows.length,
        byteSize: bytes.byteLength,
        storageKey: key,
        wrappedDek: sealed.wrappedDek,
        completedAt: exportedAt,
        expiresAt: new Date(exportedAt.getTime() + EXPORT_KEPT_MS),
      });
      if (done === null) {
        throw new Error('the export was finished elsewhere');
      }
      await appendCaseHistory(
        tx,
        environmentId,
        rows.map((row) => ({
          caseId: row.id,
          kind: 'exported' as const,
          actorType: claimed.creatorType,
          actorId: claimed.creatorId,
          to: { 'case-export-id': exportId },
        })),
      );
      for (const row of rows) {
        staged.push(
          await deps.events.stage(tx, {
            environmentId,
            name: 'case.exported',
            payload: {
              data: await caseEventResource(tx, environmentId, row),
              meta: { context: { 'case-export-id': exportId } },
            },
          }),
        );
      }
    });
    await deps.events.dispatch(staged);
  } catch (error) {
    deps.logger.error(
      { caseExportId: exportId, error: error instanceof Error ? error.name : 'unknown' },
      'case export failed',
    );
    const code = error instanceof ExportTooLargeError ? 'export_too_large' : EXPORT_FAILED;
    await deps.db.transaction((tx) => failCaseExportRow(tx, environmentId, exportId, code));
    if (storageKey !== null) {
      await deps.storage.delete(storageKey).catch(() => undefined);
    }
  }
}
