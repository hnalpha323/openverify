/**
 * C165, C166 (Workflow 9B Stage 1a, (X)): the export, saved-view and bulk report vocabularies the
 * tables' CHECKs and the contracts share, and C165.3's `filterable` transaction field rule. Read
 * through the package root, so the index line is held too.
 */
import { describe, expect, it } from 'vitest';
import * as core from './index.js';

const pick = (name: string): unknown => (core as Readonly<Record<string, unknown>>)[name];

describe('exports (C166)', () => {
  it('exports six object types, as CSV only, with the statuses of a job', () => {
    expect(pick('EXPORT_OBJECT_TYPES')).toEqual([
      'inquiries',
      'verifications',
      'accounts',
      'reports',
      'lists',
      'transactions',
    ]);
    expect(pick('EXPORT_FORMATS')).toEqual(['csv']);
    expect(pick('EXPORT_STATUSES')).toEqual([
      'pending',
      'running',
      'completed',
      'failed',
      'expired',
    ]);
  });

  it('caps an export at 50,000 rows, kept 24 hours (provisional, C166.1)', () => {
    expect(pick('EXPORT_LIMITS')).toEqual({ rows: 50_000, 'retention-hours': 24 });
  });

  it('names the permission of each object type (C166.2)', () => {
    expect(pick('EXPORT_PERMISSIONS')).toEqual({
      inquiries: 'inquiries:export',
      verifications: 'verifications:export',
      accounts: 'accounts:export',
      reports: 'reports:export',
      lists: 'lists:export',
      transactions: 'transactions:export',
    });
  });
});

describe('saved views and bulk report jobs (C165.1, C166.5)', () => {
  it('lists the nine lists a view can save', () => {
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
  });

  it('gives a bulk job its statuses and each row an outcome, never skipped', () => {
    expect(pick('REPORT_BULK_JOB_STATUSES')).toEqual(['pending', 'running', 'completed', 'failed']);
    expect(pick('REPORT_BULK_ROW_OUTCOMES')).toEqual(['created', 'failed']);
  });

  it('screens inquiries by list match three ways, over Phase 7 screenings (C165.3, K10)', () => {
    expect(pick('INQUIRY_LIST_MATCH_FILTERS')).toEqual(['matched', 'not-matched', 'unscreened']);
  });
});

describe('filterable transaction fields (C165.3)', () => {
  const version = (fields: readonly Record<string, unknown>[]) =>
    core.transactionTypeVersionProblems({
      fieldSchemas: fields as unknown as readonly core.FieldSchema[],
      statuses: core.DEFAULT_TRANSACTION_STATUSES,
      relationSchemas: [],
      allowCardLikeStrings: false,
    });
  const pointers = (fields: readonly Record<string, unknown>[]) =>
    version(fields).map((problem) => problem.pointer);

  it('takes filterable on a choices, boolean, number, integer and date field', () => {
    expect(pick('FIELD_TYPES_FILTERABLE')).toEqual([
      'choices',
      'boolean',
      'integer',
      'number',
      'date',
    ]);
    for (const type of ['boolean', 'integer', 'number', 'date']) {
      expect(
        pointers([{ type, key: 'f', label: 'F', config: { filterable: true } }]),
        type,
      ).toEqual([]);
    }
  });

  it('takes a filterable string only when it is searchable, and never a nested field', () => {
    expect(
      pointers([{ type: 'string', key: 's', label: 'S', config: { filterable: true } }]),
    ).toEqual(['/field-schemas/0/config/filterable']);
    expect(
      pointers([
        { type: 'string', key: 's', label: 'S', config: { filterable: true, searchable: true } },
      ]),
    ).toEqual([]);
    expect(
      pointers([{ type: 'datetime', key: 'd', label: 'D', config: { filterable: true } }]),
    ).toEqual(['/field-schemas/0/config/filterable']);
  });
});
