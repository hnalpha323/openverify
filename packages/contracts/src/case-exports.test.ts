import { describe, expect, it } from 'vitest';
import {
  CASE_EXPORT_CSV_COLUMNS,
  CASE_EXPORT_PERSONAL_DATA_COLUMNS,
  buildCaseExportResource,
  caseExportAttributesSchema,
  caseExportBundleSchema,
  caseExportDocumentSchema,
  caseExportListDocumentSchema,
  createCaseExportBodySchema,
  listCaseExportsQuerySchema,
} from './case-exports.js';
import { readFixture } from './test-support.js';

const EXPORT = 'cexp_01M5CN00000000000000000014';
const TEMPLATE = 'ctmpl_01M5CN00000000000000000002';
const LATER = new Date('2026-10-20T12:05:00.000Z');
const EXPIRES = new Date('2026-10-21T12:05:00.000Z');

const golden = caseExportDocumentSchema.parse(readFixture('api/case-export.json'));
const fits = (patch: Record<string, unknown>) =>
  caseExportAttributesSchema.safeParse({ ...golden.data.attributes, ...patch }).success;
const create = (attributes: Record<string, unknown>) =>
  createCaseExportBodySchema.safeParse({ data: { type: 'case-export', attributes } }).success;

describe('case exports (C138)', () => {
  it('builds the golden export', () => {
    expect(
      buildCaseExportResource({
        id: EXPORT,
        status: 'completed',
        format: 'csv',
        includePersonalData: false,
        caseCount: 2,
        byteSize: 912,
        errorCode: null,
        createdAt: LATER,
        completedAt: LATER,
        expiresAt: EXPIRES,
      }),
    ).toEqual(golden.data);
  });

  it('names no filter and no value, only counts and times (P19)', () => {
    expect(Object.keys(golden.data.attributes)).not.toContain('filter');
    expect(Object.keys(golden.data.attributes)).not.toContain('search');
    expect(fits({ filter: { status: ['open'] } })).toBe(false);
  });

  it('holds a finished export to its count, time and expiry, and a kept file to its size', () => {
    const waiting = {
      'case-count': null,
      'byte-size': null,
      'completed-at': null,
      'expires-at': null,
    };
    expect(fits({ status: 'pending', ...waiting })).toBe(true);
    expect(fits({ status: 'running', ...waiting })).toBe(true);
    expect(fits({ status: 'pending' })).toBe(false);
    expect(fits({ status: 'expired', 'byte-size': null })).toBe(true);
    expect(fits({ status: 'expired' })).toBe(false);
    expect(fits({ 'expires-at': null })).toBe(false);
    expect(fits({ 'case-count': 10_001 })).toBe(false);
  });

  it('has a failure code exactly when it failed', () => {
    const failed = {
      status: 'failed',
      'case-count': null,
      'byte-size': null,
      'completed-at': null,
      'expires-at': null,
    };
    expect(fits({ ...failed, 'error-code': 'export_too_large' })).toBe(true);
    expect(fits(failed)).toBe(false);
    expect(fits({ 'error-code': 'export_too_large' })).toBe(false);
    expect(fits({ ...failed, 'error-code': 'More than 10,000 cases' })).toBe(false);
  });

  it('takes a format, and a filter or a search, never both (C138.1)', () => {
    expect(create({ format: 'csv' })).toBe(true);
    expect(
      create({
        format: 'json',
        'include-personal-data': true,
        filter: { 'case-template-id': [TEMPLATE], 'sla-state': ['expired'], status: ['open'] },
      }),
    ).toBe(true);
    expect(
      create({
        format: 'csv',
        search: { query: { attribute: 'status', operator: 'eq', value: 'open' } },
      }),
    ).toBe(true);
    expect(
      create({
        format: 'csv',
        filter: { status: ['open'] },
        search: { query: { attribute: 'status', operator: 'eq', value: 'open' } },
      }),
    ).toBe(false);
    expect(create({ format: 'xlsx' })).toBe(false);
    expect(create({ format: 'csv', filter: { name: ['KYC-6'] } })).toBe(false);
    expect(create({ format: 'csv', filter: { 'case-template-id': ['KYC'] } })).toBe(false);
  });

  it('lists the caller’s own by status, newest first', () => {
    expect(listCaseExportsQuerySchema.safeParse({ 'filter[status]': 'completed' }).success).toBe(
      true,
    );
    expect(listCaseExportsQuerySchema.safeParse({ 'filter[status]': 'done' }).success).toBe(false);
    expect(
      caseExportListDocumentSchema.safeParse({ data: [golden.data], links: { next: null } })
        .success,
    ).toBe(true);
  });

  it('writes the CSV columns of C138.2, and fields only with personal data on', () => {
    expect(CASE_EXPORT_CSV_COLUMNS.slice(0, 4)).toEqual([
      'id',
      'name',
      'case-template-id',
      'status',
    ]);
    expect(CASE_EXPORT_CSV_COLUMNS).toContain('sla-expires-at');
    expect(CASE_EXPORT_CSV_COLUMNS).toContain('tags');
    expect(CASE_EXPORT_CSV_COLUMNS).not.toContain('fields');
    expect(CASE_EXPORT_CSV_COLUMNS).not.toContain('comments');
    expect(CASE_EXPORT_PERSONAL_DATA_COLUMNS).toEqual(['fields']);
  });

  it('bundles each case with its timeline, comments and what it holds, as JSON (C138.2)', () => {
    const bundle = caseExportBundleSchema.parse(readFixture('api/case-export-bundle.json'));
    expect(bundle.meta['case-count']).toBe(bundle.data.length);
    expect(bundle.data[0]?.['held-objects'].map(({ type }: { type: string }) => type)).toEqual([
      'account',
      'inquiry',
      'report/watchlist',
    ]);
    expect(
      caseExportBundleSchema.safeParse({
        ...bundle,
        data: bundle.data.map((entry: object) => ({ ...entry, bytes: 'aGVsbG8=' })),
      }).success,
    ).toBe(false);
  });
});
