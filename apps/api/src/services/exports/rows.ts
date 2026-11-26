/**
 * C166.1, C166.3 (Workflow 9B, `api-exports`; the 7B refresh's defaults): the rows of an export, one
 * page at a time, in the list's own order (`created_at DESC, id DESC`) and under the list's own
 * filters: the inquiry and transaction lists through their filter hooks, the others through the same
 * repository options their routes read.
 *
 * Columns (`EXPORT_CSV_COLUMNS`, each with its `pii` mark): a `pii` column is written only when the
 * export includes personal data; otherwise a value column is empty and a JSON column (`fields`,
 * `query`, `extracted-fields`) keeps its keys with every value `null` (a transaction's
 * `{ type, value: null }`), as the API masks it (C15). A redacted object's `pii` columns read
 * `"redacted"`, never an empty value (C166.3). Never included (Phase 8 C138.4): secrets, tokens,
 * storage keys, wrapped keys, face templates, embeddings, raw fingerprints, EXIF, other
 * environments' data; a transaction `file` field is its id and name as the API serves it, never
 * content.
 *
 * Lists (`filter[list-id]`): only a list with an importer (`assertExportableList`), whose header is
 * exactly `importColumns(kind)`, so the file re-imports through the 7B importer unchanged (C100.5:
 * the importer strips the neutraliser); a pending or redacted item holds no value and is left out.
 * List values are third-party personal data (C107.5): every cell is masked without personal data.
 */
import { importColumns, writeCsv } from '@openverify/checks';
import {
  EXPORT_CSV_COLUMNS,
  filterValues,
  idSchema,
  reportResourceTypeSchema,
  tagInputSchema,
  toReportResourceType,
  transactionStatusSchema,
} from '@openverify/contracts';
import {
  fromReportResourceType,
  inquiryStatusSchema,
  listItemStatusSchema,
  normalizeTag,
  reportStatusSchema,
  type ExportObjectType,
  type ReportType,
  type VerificationType,
} from '@openverify/core';
import {
  accounts,
  getList,
  listExportVerifications,
  listGovernmentIdExtractions,
  listInquiries as findInquiries,
  listListItems as listListItemRows,
  listReports,
  listTransactions as listTransactionRows,
  type Db,
  type Page,
} from '@openverify/db';
import { and, eq, inArray } from 'drizzle-orm';
import { piiMaskFor } from '../../auth/pii.js';
import { flowInquiryAttributes } from '../../flow-engine/inquiry-attributes.js';
import type { Principal } from '../../ports.js';
import { listAccountViews } from '../accounts.js';
import type { ApiDependencies } from '../context.js';
import { inquiryListFilters } from '../list-filters/inquiries.js';
import { transactionListFilters } from '../list-filters/transactions.js';
import { transactionResources } from '../transactions/resources.js';
import { fieldValueKey } from '../transactions/write-checks.js';
import { publicVerificationType, type ExportFilter } from './selection.js';
import { UNMASKED } from '../../auth/pii.js';

/** One CSV cell, as `writeCsv` takes it. */
export type Cell = string | number | boolean | null;

/** What an export page holds: its rows, in the header's order, and the next page's cursor. */
export interface ExportPage {
  rows: Cell[][];
  next: string | null;
}

/** An export's columns and its pages. */
export interface ExportReader {
  header: readonly string[];
  page(after: string | undefined): Promise<ExportPage>;
}

export interface ExportReadDeps {
  db: Db;
  /** The blind-index key a string filter reads; without it such a filter fails the export. */
  blindIndexKey?: Uint8Array | undefined;
}

/** Rows read per page. */
export const EXPORT_PAGE_SIZE = 100;

/** What a redacted object's personal columns read (C166.3). */
export const REDACTED = 'redacted';

/** The mask of a reader without `pii:view`: what an export without personal data writes. */
const MASKED = piiMaskFor({ kind: 'api-key', piiMasked: true } as unknown as Principal);

/** Thrown when an export's filter needs what the job does not hold (the blind-index key). */
export class ExportUnreadableError extends Error {
  override name = 'ExportUnreadableError';
}

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;

const one = (filter: ExportFilter, key: string): string | undefined => {
  const value = filter[key];
  return typeof value === 'string' ? value : undefined;
};

const dateOf = (value: string | undefined) => (value === undefined ? undefined : new Date(value));

/** The personal cell writer of one row: redacted, included, or masked. */
function personal(include: boolean, redacted: boolean) {
  return {
    value: (value: Cell | undefined): Cell =>
      redacted ? REDACTED : include ? (value ?? null) : null,
    json: (value: Readonly<Record<string, unknown>> | null | undefined): Cell => {
      if (redacted || value === null || value === undefined) {
        return redacted ? REDACTED : null;
      }
      return JSON.stringify(include ? value : MASKED.fields(value));
    },
  };
}

const headerOf = (objectType: Exclude<ExportObjectType, 'lists'>): string[] =>
  (EXPORT_CSV_COLUMNS[objectType] ?? []).map(({ name }) => name);

async function inquiryReader(
  deps: ExportReadDeps,
  environmentId: string,
  filter: ExportFilter,
  include: boolean,
): Promise<ExportReader> {
  const { db } = deps;
  const added = await inquiryListFilters(db, {
    environmentId,
    query: filter,
    piiVisible: true,
  });
  return {
    header: headerOf('inquiries'),
    async page(after) {
      const page = await findInquiries(db, environmentId, {
        where: added.where,
        after,
        size: EXPORT_PAGE_SIZE,
        status: filterValues(one(filter, 'filter[status]'), inquiryStatusSchema),
        referenceId: one(filter, 'filter[reference-id]'),
        accountId: filterValues(one(filter, 'filter[account-id]'), idSchema('acc')),
        inquiryTemplateId: filterValues(
          one(filter, 'filter[inquiry-template-id]'),
          idSchema('itmpl'),
        ),
        tag: filterValues(one(filter, 'filter[tag]'), tagInputSchema)?.map(normalizeTag),
        createdAtStart: dateOf(one(filter, 'filter[created-at-start]')),
        createdAtEnd: dateOf(one(filter, 'filter[created-at-end]')),
      });
      const rows: Cell[][] = [];
      for (const inquiry of page.items) {
        const cell = personal(include, inquiry.redactedAt !== null);
        const step =
          inquiry.flowStepId === null
            ? null
            : (await flowInquiryAttributes(db, inquiry, { visible: true }))['next-step-name'];
        rows.push([
          inquiry.id,
          inquiry.status,
          cell.value(inquiry.referenceId),
          inquiry.inquiryTemplateId,
          inquiry.inquiryTemplateVersionId,
          inquiry.accountId,
          inquiry.redactedAt === null ? inquiry.tags.join(' ') : REDACTED,
          cell.value(step),
          iso(inquiry.createdAt),
          iso(inquiry.startedAt),
          iso(inquiry.completedAt),
          iso(inquiry.failedAt),
          iso(inquiry.expiredAt),
          iso(inquiry.decisionedAt),
          iso(inquiry.redactedAt),
          cell.json(inquiry.fields),
        ]);
      }
      return { rows, next: page.next };
    },
  };
}

/** The `page[after]` of a next link, or `null`. */
function afterOf(link: string | null): string | null {
  if (link === null) {
    return null;
  }
  return new URL(link, 'https://openverify.invalid').searchParams.get('page[after]');
}

function accountReader(
  deps: ExportReadDeps,
  environmentId: string,
  filter: ExportFilter,
  include: boolean,
): ExportReader {
  return {
    header: headerOf('accounts'),
    async page(after) {
      const page = await listAccountViews(
        { db: deps.db } as unknown as ApiDependencies,
        environmentId,
        {
          ...(filter as Record<string, string>),
          'page[size]': EXPORT_PAGE_SIZE,
          ...(after === undefined ? {} : { 'page[after]': after }),
        },
      );
      const rows = page.views.map(({ account }): Cell[] => {
        const cell = personal(include, account.redactedAt !== null);
        return [
          account.id,
          account.accountTypeId,
          account.status,
          cell.value(account.referenceId),
          account.redactedAt === null ? account.tags.join(' ') : REDACTED,
          iso(account.createdAt),
          iso(account.updatedAt),
          iso(account.redactedAt),
          cell.json(account.fields),
        ];
      });
      return { rows, next: afterOf(page.next) };
    },
  };
}

/** The reference ids of the accounts of `ids`. */
async function referenceIdsOf(
  db: Db,
  environmentId: string,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: accounts.id, referenceId: accounts.referenceId })
    .from(accounts)
    .where(and(eq(accounts.environmentId, environmentId), inArray(accounts.id, [...ids])));
  return new Map(rows.map((row) => [row.id, row.referenceId]));
}

function reportReader(
  deps: ExportReadDeps,
  environmentId: string,
  filter: ExportFilter,
  include: boolean,
): ExportReader {
  const hasMatch = one(filter, 'filter[has-match]');
  const types = filterValues(one(filter, 'filter[type]'), reportResourceTypeSchema)
    ?.map((type) => fromReportResourceType(type))
    .filter((type): type is ReportType => type !== null);
  return {
    header: headerOf('reports'),
    async page(after) {
      const page: Page<Awaited<ReturnType<typeof listReports>>['items'][number]> =
        await listReports(deps.db, environmentId, {
          after,
          size: EXPORT_PAGE_SIZE,
          reportTemplateId: filterValues(
            one(filter, 'filter[report-template-id]'),
            idSchema('rptp'),
          ),
          status: filterValues(one(filter, 'filter[status]'), reportStatusSchema),
          hasMatch: hasMatch === undefined ? undefined : hasMatch === 'true',
          accountId: filterValues(one(filter, 'filter[account-id]'), idSchema('acc')),
          inquiryId: filterValues(one(filter, 'filter[inquiry-id]'), idSchema('inq')),
          referenceId: one(filter, 'filter[reference-id]'),
          tag: filterValues(one(filter, 'filter[tag]'), tagInputSchema),
          reportType: types,
        });
      const references = await referenceIdsOf(
        deps.db,
        environmentId,
        page.items.flatMap(({ accountId }) => (accountId === null ? [] : [accountId])),
      );
      const rows = page.items.map((report): Cell[] => {
        const cell = personal(include, report.redactedAt !== null);
        return [
          report.id,
          toReportResourceType(report.reportType),
          report.status,
          report.reportTemplateId,
          report.inquiryId,
          report.accountId,
          cell.value(report.accountId === null ? null : (references.get(report.accountId) ?? null)),
          report.hasMatch,
          iso(report.createdAt),
          iso(report.redactedAt),
          cell.json(report.query),
        ];
      });
      return { rows, next: page.next };
    },
  };
}

async function listItemReader(
  deps: ExportReadDeps,
  environmentId: string,
  filter: ExportFilter,
  include: boolean,
): Promise<ExportReader> {
  const listId = one(filter, 'filter[list-id]') ?? '';
  const list = await getList(deps.db, environmentId, listId);
  const kind = list?.type ?? 'string';
  const header = [...importColumns(kind)];
  const statuses = filterValues(one(filter, 'filter[status]'), listItemStatusSchema);
  return {
    header,
    async page(after) {
      const page = await listListItemRows(
        deps.db,
        environmentId,
        { listId, statuses },
        { after, size: EXPORT_PAGE_SIZE },
      );
      const rows = page.items
        .filter(
          (item) => item.status !== 'pending' && item.redactedAt === null && item.value !== null,
        )
        .map((item): Cell[] =>
          header.map((column) => {
            const value = item.value?.[column.replaceAll('_', '-')];
            const cell =
              typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                ? value
                : null;
            return include ? cell : null;
          }),
        );
      return { rows, next: page.next };
    },
  };
}

async function transactionReader(
  deps: ExportReadDeps,
  environmentId: string,
  filter: ExportFilter,
  include: boolean,
): Promise<ExportReader> {
  const { db } = deps;
  const added = await transactionListFilters(db, {
    environmentId,
    query: filter as never,
    piiVisible: true,
    blindIndexKey: deps.blindIndexKey,
  });
  const key = one(filter, 'filter[identifier][key]');
  const value = one(filter, 'filter[identifier][value]');
  if (key !== undefined && value !== undefined && deps.blindIndexKey === undefined) {
    throw new ExportUnreadableError('filter[identifier] needs the blind-index key');
  }
  const identifier =
    key === undefined || value === undefined || deps.blindIndexKey === undefined
      ? undefined
      : { fieldKey: key, valueKey: fieldValueKey(deps.blindIndexKey, environmentId, key, value) };
  return {
    header: headerOf('transactions'),
    async page(after) {
      const page = await listTransactionRows(
        db,
        environmentId,
        {
          referenceId: one(filter, 'filter[reference-id]'),
          transactionTypeIds: filterValues(
            one(filter, 'filter[transaction-type-id]'),
            idSchema('txntp'),
          ),
          statuses: filterValues(one(filter, 'filter[status]'), transactionStatusSchema),
          identifier,
          createdAtStart: dateOf(one(filter, 'filter[created-at-start]')),
          createdAtEnd: dateOf(one(filter, 'filter[created-at-end]')),
          where: added.where,
        },
        { after, size: EXPORT_PAGE_SIZE },
      );
      const resources = await transactionResources(db, environmentId, page.items, {
        mask: UNMASKED,
      });
      const fieldsOf = new Map(
        resources.map((resource) => [
          resource.id,
          (resource.attributes as { fields?: Readonly<Record<string, unknown>> | null }).fields ??
            null,
        ]),
      );
      const rows = page.items.map((transaction): Cell[] => {
        const cell = personal(include, transaction.redactedAt !== null);
        return [
          transaction.id,
          transaction.transactionTypeId,
          transaction.transactionTypeVersionId,
          transaction.status,
          cell.value(transaction.referenceId),
          iso(transaction.createdAt),
          iso(transaction.updatedAt),
          iso(transaction.redactedAt),
          cell.json(fieldsOf.get(transaction.id) ?? null),
        ];
      });
      return { rows, next: page.next };
    },
  };
}

function verificationReader(
  deps: ExportReadDeps,
  environmentId: string,
  filter: ExportFilter,
  include: boolean,
): ExportReader {
  const types = (one(filter, 'filter[type]') ?? '')
    .split(',')
    .map((type) => type.trim().replaceAll('-', '_') as VerificationType);
  const statuses = one(filter, 'filter[status]')?.split(',');
  const inquiryIds = one(filter, 'filter[inquiry-id]')?.split(',');
  return {
    header: headerOf('verifications'),
    async page(after) {
      const page = await listExportVerifications(
        deps.db,
        environmentId,
        {
          types,
          statuses,
          inquiryIds,
          createdAtStart: dateOf(one(filter, 'filter[created-at-start]')),
          createdAtEnd: dateOf(one(filter, 'filter[created-at-end]')),
        },
        { after, size: EXPORT_PAGE_SIZE },
      );
      const extractions = await listGovernmentIdExtractions(
        deps.db,
        environmentId,
        page.items.map(({ id }) => id),
      );
      const rows = page.items.map((verification): Cell[] => {
        const cell = personal(include, verification.redactedAt !== null);
        const extracted = extractions.get(verification.id)?.fields ?? null;
        return [
          verification.id,
          publicVerificationType(verification.type),
          verification.status,
          verification.inquiryId,
          verification.country,
          verification.idClass,
          verification.checks.join(' '),
          iso(verification.createdAt),
          iso(verification.submittedAt),
          iso(verification.completedAt),
          iso(verification.redactedAt),
          cell.json(extracted),
        ];
      });
      return { rows, next: page.next };
    },
  };
}

/** The reader of an export of `objectType` under `filter`. */
export async function exportReader(
  deps: ExportReadDeps,
  environmentId: string,
  objectType: ExportObjectType,
  filter: ExportFilter,
  includePersonalData: boolean,
): Promise<ExportReader> {
  switch (objectType) {
    case 'inquiries':
      return inquiryReader(deps, environmentId, filter, includePersonalData);
    case 'verifications':
      return verificationReader(deps, environmentId, filter, includePersonalData);
    case 'accounts':
      return accountReader(deps, environmentId, filter, includePersonalData);
    case 'reports':
      return reportReader(deps, environmentId, filter, includePersonalData);
    case 'lists':
      return listItemReader(deps, environmentId, filter, includePersonalData);
    case 'transactions':
      return transactionReader(deps, environmentId, filter, includePersonalData);
  }
}

/**
 * The columns a principal's blocklist leaves (C169.3, `blockExportColumns`), and each row cut to them.
 */
export function keepColumns(
  header: readonly string[],
  kept: readonly string[],
): (row: readonly Cell[]) => Cell[] {
  const indexes = kept.map((column) => header.indexOf(column));
  return (row) => indexes.map((index) => row[index] ?? null);
}

/** The CSV text of the header alone, which each page's text starts with. */
export const headerText = (header: readonly string[]): string => writeCsv(header, []);
