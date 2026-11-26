import { REPORT_REGISTRY, reportEventName } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  REPORT_QUERY_FIELDS,
  REPORT_QUERY_SCHEMAS,
  REPORT_QUERY_SOURCES,
} from './report-queries.js';
import {
  reportTemplateConfigSchema,
  resolveReportTemplateConfig,
  resolvedReportTemplateConfigSchema,
} from './report-template-config.js';
import { reportDocumentSchema, reportErrorSchema, reportMatchSchema } from './reports.js';
import { readFixture } from './test-support.js';

const LIST = 'lst_01M5CK3190XEVBM5ZXA76E1JSN';
const refused = (schema: z.ZodType, value: unknown) => !schema.safeParse(value).success;

describe('report/custom-list (C106.2)', () => {
  it('is a beta type reviewed match by match, with the six derived events', () => {
    expect(REPORT_REGISTRY['custom-list']).toMatchObject({
      stage: 'beta',
      tiers: ['R', 'H'],
      review: 'matches',
      sourceKind: null,
      recurrable: true,
      requiredProviderKind: null,
      events: ['ready', 'errored', 'matched', 'dismissed', 'reviewed', 'redacted'],
    });
    expect(reportEventName('custom-list', 'matched')).toBe('report/custom-list.matched');
  });

  it('takes any of its query members, with list-ids (1-20) or none (pinned on the template)', () => {
    const schema = REPORT_QUERY_SCHEMAS['custom-list'];
    expect(REPORT_QUERY_FIELDS['custom-list']).toEqual([
      'name-first',
      'name-last',
      'email-address',
      'phone-number',
      'government-id-number',
      'government-id-class',
      'ip-address',
      'country-code',
      'string',
      'list-ids',
    ]);
    expect(schema.safeParse({ 'email-address': 'listed@example.org' }).success).toBe(true);
    expect(
      schema.safeParse({ 'email-address': 'listed@example.org', 'list-ids': [LIST] }).success,
    ).toBe(true);
    expect(refused(schema, {})).toBe(true);
    expect(refused(schema, { 'list-ids': [LIST] })).toBe(true);
    expect(refused(schema, { 'email-address': 'listed@example.org', 'list-ids': [] })).toBe(true);
    expect(refused(schema, { unknown: 'x' })).toBe(true);
  });

  it('keeps the class with the number it qualifies', () => {
    const schema = REPORT_QUERY_SCHEMAS['custom-list'];
    expect(
      schema.safeParse({ 'government-id-number': 'X1', 'government-id-class': 'passport' }).success,
    ).toBe(true);
    expect(schema.safeParse({ 'government-id-number': 'X1' }).success).toBe(true);
    expect(refused(schema, { 'government-id-class': 'passport' })).toBe(true);
  });

  it('adds the government_id_country query source (C99.5)', () => {
    expect(REPORT_QUERY_SOURCES).toContain('government_id_country');
  });

  it('pins its lists on the template, and resolves without them', () => {
    const schema = reportTemplateConfigSchema('custom-list');
    expect(schema.safeParse({ 'list-ids': [LIST] }).success).toBe(true);
    expect(refused(schema, { 'list-ids': [LIST, LIST] })).toBe(true);
    expect(resolveReportTemplateConfig('custom-list', {})).toMatchObject({ 'list-ids': null });
    expect(
      resolvedReportTemplateConfigSchema('custom-list').safeParse(
        resolveReportTemplateConfig('custom-list', { 'list-ids': [LIST] }),
      ).success,
    ).toBe(true);
  });

  it('accepts a list as the source of an error and a match (a C70.2 amendment)', () => {
    expect(reportErrorSchema.safeParse({ code: 'list_unavailable', source: LIST }).success).toBe(
      true,
    );
    expect(reportErrorSchema.safeParse({ code: 'list_stale', source: 'ofac-sdn' }).success).toBe(
      true,
    );
    expect(reportMatchSchema.shape['source-id'].safeParse(LIST).success).toBe(true);
    expect(refused(reportErrorSchema, { code: 'list_unavailable', source: 'lst_short' })).toBe(
      true,
    );
  });

  const fixture = () =>
    structuredClone(readFixture('api/report-custom-list.json')) as {
      data: { attributes: Record<string, unknown> };
    };

  it('serves the list provenance of C106.2, never a sync', () => {
    const { data } = reportDocumentSchema.parse(fixture());
    expect(data.attributes.sources).toEqual([
      {
        'list-id': LIST,
        version: 3,
        'normaliser-version': 'lists-1',
        'item-count': 2,
        'screened-at': '2026-10-31T12:00:05.000Z',
      },
    ]);
  });

  it('is never ready with a list unscreened (ADR 0005)', () => {
    const report = fixture();
    report.data.attributes.unscreened = [{ 'list-id': LIST, reason: 'list_items_pending' }];
    expect(refused(reportDocumentSchema, report)).toBe(true);
  });

  it('names each unscreened list in its errors, and keeps its matches', () => {
    const report = fixture();
    report.data.attributes.status = 'errored';
    report.data.attributes.unscreened = [{ 'list-id': LIST, reason: 'normaliser_outdated' }];
    expect(refused(reportDocumentSchema, report)).toBe(true);
    report.data.attributes.errors = [{ code: 'list_unavailable', source: LIST }];
    expect(reportDocumentSchema.safeParse(report).success).toBe(true);
  });

  it('does not error for a list the subject has no value for (H16)', () => {
    const report = fixture();
    report.data.attributes['not-applicable'] = [
      { 'list-id': LIST, reason: 'subject_has_no_value' },
    ];
    expect(reportDocumentSchema.safeParse(report).success).toBe(true);
  });
});
