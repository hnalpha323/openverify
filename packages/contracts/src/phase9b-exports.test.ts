/**
 * C165, C166 (Workflow 9B Stage 1a, (X)): exports, saved views, bulk report creation, the new inquiry
 * and transaction list filters, and the webhook delivery search. Read through the package root, so
 * the index lines are held too.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as contracts from './index.js';
import { readFixture } from './test-support.js';

const pick = (name: string): unknown => (contracts as Readonly<Record<string, unknown>>)[name];
const schema = (name: string): z.ZodType => {
  const found = pick(name);
  expect(found, name).toBeDefined();
  return found as z.ZodType;
};
const parses = (name: string, value: unknown) => schema(name).safeParse(value).success;
const body = (attributes: Record<string, unknown>) => ({ data: { type: 'export', attributes } });

describe('exports (C166.1-C166.4)', () => {
  it('cuts one CSV of a list filter or a saved view, with personal data only when asked', () => {
    expect(
      parses(
        'createExportBodySchema',
        body({
          'object-type': 'inquiries',
          format: 'csv',
          filter: { 'filter[status]': ['completed'] },
        }),
      ),
    ).toBe(true);
    expect(
      parses(
        'createExportBodySchema',
        body({
          'object-type': 'accounts',
          format: 'csv',
          'saved-view-id': 'svw_01M5CN00000000000000009B30',
          'include-personal-data': true,
        }),
      ),
    ).toBe(true);
    expect(
      parses(
        'createExportBodySchema',
        body({
          'object-type': 'inquiries',
          format: 'csv',
          filter: {},
          'saved-view-id': 'svw_01M5CN00000000000000009B30',
        }),
      ),
    ).toBe(false);
    expect(
      parses('createExportBodySchema', body({ 'object-type': 'inquiries', format: 'json' })),
    ).toBe(false);
    expect(parses('createExportBodySchema', body({ 'object-type': 'cases', format: 'csv' }))).toBe(
      false,
    );
  });

  it('needs filter[type] for verifications and filter[list-id] for lists (C166.1)', () => {
    expect(
      parses('createExportBodySchema', body({ 'object-type': 'verifications', format: 'csv' })),
    ).toBe(false);
    expect(
      parses(
        'createExportBodySchema',
        body({
          'object-type': 'verifications',
          format: 'csv',
          filter: { 'filter[type]': 'government-id' },
        }),
      ),
    ).toBe(true);
    expect(
      parses(
        'createExportBodySchema',
        body({
          'object-type': 'lists',
          format: 'csv',
          filter: { 'filter[list-id]': 'lst_01M5CN00000000000000009B31' },
        }),
      ),
    ).toBe(true);
    expect(parses('createExportBodySchema', body({ 'object-type': 'lists', format: 'csv' }))).toBe(
      false,
    );
  });

  it('records the filter shape, the cut time, the row count and personal data (C166.6)', () => {
    const raw = readFixture('api/export.json');
    expect(schema('exportDocumentSchema').parse(raw)).toEqual(raw);
    expect(raw).toMatchObject({
      data: {
        type: 'export',
        attributes: {
          status: 'completed',
          'filter-keys': ['filter[status]'],
          'include-personal-data': false,
        },
      },
    });
    const list = readFixture('api/exports.json');
    expect(schema('exportListDocumentSchema').parse(list)).toEqual(list);
  });

  it('marks the export filter as personal data in logs, never its keys alone (C174.5)', () => {
    expect(pick('PII_EXPORT_ATTRIBUTES')).toEqual(['filter']);
  });

  it('documents the columns of every type, each with its personal-data mark, never a secret (C166.3)', () => {
    const columns = pick('EXPORT_CSV_COLUMNS') as Readonly<
      Record<string, readonly { name: string; pii: boolean }[]>
    >;
    // K9-29 (Workflow 9D): lists have no fixed columns; their header is the importer's for the kind.
    expect(Object.keys(columns).sort()).toEqual(
      ['accounts', 'inquiries', 'reports', 'transactions', 'verifications'].sort(),
    );
    for (const [type, list] of Object.entries(columns)) {
      expect(
        list.map((column) => column.name),
        type,
      ).toContain('id');
      for (const column of list) {
        expect(column.name, `${type} ${column.name}`).not.toMatch(
          /token|secret|storage|wrapped|template-vector|embedding|fingerprint|exif|password/,
        );
      }
    }
    expect(columns.inquiries?.find((column) => column.name === 'reference-id')?.pii).toBe(true);
  });
});

describe('saved views (C165.1, C165.2, C165.5)', () => {
  it('stores a view of one of nine lists, its filters, columns, sort and sharing', () => {
    expect(pick('SAVED_VIEW_LISTS')).toEqual([
      'inquiries',
      'accounts',
      'reports',
      'cases',
      'transactions',
      'api-logs',
      'webhook-deliveries',
      'events',
      'audit-logs',
    ]);
    const raw = readFixture('api/saved-view.json');
    expect(schema('savedViewDocumentSchema').parse(raw)).toEqual(raw);
    const list = readFixture('api/saved-views.json');
    expect(schema('savedViewListDocumentSchema').parse(list)).toEqual(list);
    expect(
      parses('createSavedViewBodySchema', {
        data: {
          type: 'saved-view',
          attributes: {
            list: 'inquiries',
            name: 'Completed this week',
            filters: { 'filter[status]': ['completed'] },
            shared: true,
          },
        },
      }),
    ).toBe(true);
  });

  it('validates a view filter with that list route own query schema', () => {
    const schemas = pick('SAVED_VIEW_QUERY_SCHEMAS') as Readonly<Record<string, z.ZodType>>;
    expect(Object.keys(schemas)).toEqual(pick('SAVED_VIEW_LISTS'));
    expect(schemas.inquiries?.safeParse({ 'filter[status]': 'completed' }).success).toBe(true);
    expect(schemas.inquiries?.safeParse({ 'filter[nothing]': 'x' }).success).toBe(false);
  });

  it('names the personal-data filter keys of each list, refused in a view (saved_view_pii_filter)', () => {
    const offending = pick('savedViewPiiFilterKeys') as (
      list: string,
      filters: Readonly<Record<string, unknown>>,
    ) => string[];
    expect(
      offending('inquiries', { 'filter[status]': 'completed', 'filter[reference-id]': 'ref-1' }),
    ).toEqual(['filter[reference-id]']);
    expect(offending('inquiries', { 'filter[next-step-name]': 's_minor001' })).toEqual([
      'filter[next-step-name]',
    ]);
    expect(
      offending('transactions', {
        'filter[identifier][value]': 'x',
        'filter[fields.merchant_name]': 'y',
      }),
    ).toEqual(['filter[identifier][value]', 'filter[fields.merchant_name]']);
    expect(offending('audit-logs', { 'filter[ip]': '192.0.2.1' })).toEqual(['filter[ip]']);
    expect(offending('events', { 'filter[name]': 'inquiry.completed' })).toEqual([]);
  });
});

describe('bulk report creation (C166.5)', () => {
  it('takes a report template and a CSV of at most 1,000 rows and 2 MiB', () => {
    expect(pick('REPORT_BULK_LIMITS')).toEqual({ rows: 1000, bytes: 2_097_152 });
    expect(pick('REPORT_BULK_FILE_FIELD')).toBe('file');
    expect(
      parses('createReportBulkJobFieldsSchema', {
        'report-template-id': 'rptp_01M5CN00000000000000009B32',
      }),
    ).toBe(true);
    expect(parses('createReportBulkJobFieldsSchema', {})).toBe(false);
  });

  it('reports each row as created or failed with a code, never skipped (C166.6)', () => {
    const raw = readFixture('api/report-bulk-job.json');
    expect(schema('reportBulkJobDocumentSchema').parse(raw)).toEqual(raw);
    const rows = (raw as { data: { attributes: { rows: { outcome: string }[] } } }).data.attributes
      .rows;
    expect(new Set(rows.map((row) => row.outcome))).toEqual(new Set(['created', 'failed']));
    expect(pick('PII_REPORT_BULK_ATTRIBUTES')).toEqual(['file']);
  });
});

describe('the new list filters (C165.3)', () => {
  const inquiries = (query: Record<string, unknown>) => parses('listInquiriesQuerySchema', query);

  it('filters inquiries by list match, list, check outcome and next step', () => {
    expect(inquiries({ 'filter[list-match]': 'matched' })).toBe(true);
    expect(inquiries({ 'filter[list-match]': 'not-matched' })).toBe(true);
    expect(inquiries({ 'filter[list-match]': 'unscreened' })).toBe(true);
    expect(inquiries({ 'filter[list-match]': 'skipped' })).toBe(false);
    expect(inquiries({ 'filter[list-id]': 'lst_01M5CN00000000000000009B31' })).toBe(true);
    expect(
      inquiries({ 'filter[check]': 'id_expired_detection', 'filter[check-status]': 'failed' }),
    ).toBe(true);
    expect(inquiries({ 'filter[check]': 'id_expired_detection' })).toBe(false);
    expect(inquiries({ 'filter[check-status]': 'failed' })).toBe(false);
    expect(inquiries({ 'filter[next-step-name]': 's_minor001' })).toBe(true);
  });

  it('filters transactions by a filterable field, at most ten at once', () => {
    const transactions = (query: Record<string, unknown>) =>
      parses('listTransactionsQuerySchema', query);
    expect(transactions({ 'filter[fields.amount_band]': 'high' })).toBe(true);
    expect(transactions({ 'filter[fields.Amount]': 'high' })).toBe(false);
    expect(transactions({ 'filter[other]': 'x' })).toBe(false);
    const many = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [`filter[fields.f${String(index)}]`, 'x']),
    );
    expect(transactions(many)).toBe(false);
  });
});

describe('the webhook delivery search (C165.4)', () => {
  const search = (query: unknown) => parses('webhookDeliverySearchBodySchema', { query });
  const clause = { attribute: 'status', operator: 'eq', value: 'failed' };

  it('takes and, or and not over four attributes', () => {
    expect(search(clause)).toBe(true);
    expect(
      search({
        and: [
          clause,
          { attribute: 'updated_at', operator: 'gte', value: '2026-10-01T00:00:00Z' },
          { not: { attribute: 'event_name', operator: 'eq', value: 'inquiry.started' } },
        ],
      }),
    ).toBe(true);
    expect(search({ attribute: 'body', operator: 'eq', value: 'x' })).toBe(false);
    expect(search({ attribute: 'status', operator: 'gte', value: 'failed' })).toBe(false);
  });

  it('refuses a depth past 2 and more than 20 clauses', () => {
    expect(search({ and: [{ or: [{ not: clause }] }] })).toBe(false);
    expect(search({ or: Array.from({ length: 21 }, () => clause) })).toBe(false);
    expect(search({ or: Array.from({ length: 20 }, () => clause) })).toBe(true);
  });
});
