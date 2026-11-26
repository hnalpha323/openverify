/** C84.1: the report list of an inquiry template version. */
import { describe, expect, it } from 'vitest';
import {
  INQUIRY_REPORT_CONFIG_DEFAULTS,
  INQUIRY_REPORT_CONFIG_LIMITS,
  ON_REPORT_MATCH_ACTIONS,
  reportConfigEntryPointer,
  reportConfigSchema,
  resolveReportConfig,
  resolvedReportConfigSchema,
} from './inquiry-report-config.js';

const TEMPLATE = 'rptp_01M5CJXHG07XPHF3HRM6NREDH8';
const entry = (id: string) => ({ 'report-template-id': id });
const template = (index: number) =>
  `rptp_01M5CJXHG07XPHF3HRM6NRED${String(index).padStart(2, '0')}`;

describe('reportConfigSchema (C84.1)', () => {
  it('runs 0 to 10 report templates on completion, from the inquiry by default', () => {
    expect(INQUIRY_REPORT_CONFIG_LIMITS).toEqual({ maxOnCompletion: 10 });
    expect(ON_REPORT_MATCH_ACTIONS).toEqual(['none', 'needs_review']);
    expect(reportConfigSchema.safeParse({}).success).toBe(true);
    expect(
      reportConfigSchema.safeParse({
        'on-completion': [entry(TEMPLATE), { ...entry(template(1)), 'query-source': 'inquiry' }],
        'on-report-match': 'needs_review',
      }).success,
    ).toBe(true);
    const eleven = Array.from({ length: 11 }, (_, index) => entry(template(index)));
    expect(reportConfigSchema.safeParse({ 'on-completion': eleven }).success).toBe(false);
  });

  it('lists a template once, at its own pointer, and refuses unknown members', () => {
    const duplicate = reportConfigSchema.safeParse({
      'on-completion': [entry(TEMPLATE), entry(template(1)), entry(TEMPLATE)],
    });
    expect(duplicate.success).toBe(false);
    expect(duplicate.error?.issues.map((issue) => issue.path)).toEqual([
      ['on-completion', 2, 'report-template-id'],
    ]);
    expect(reportConfigSchema.safeParse({ 'on-report-match': 'decline' }).success).toBe(false);
    expect(reportConfigSchema.safeParse({ reports: [] }).success).toBe(false);
    expect(
      reportConfigSchema.safeParse({
        'on-completion': [{ ...entry(TEMPLATE), 'query-source': 'account' }],
      }).success,
    ).toBe(false);
  });

  it('resolves to nothing on completion and no inquiry change by default (C69.4, decision 28)', () => {
    expect(INQUIRY_REPORT_CONFIG_DEFAULTS).toEqual({
      'on-completion': [],
      'on-report-match': 'none',
    });
    expect(resolveReportConfig({})).toEqual({ 'on-completion': [], 'on-report-match': 'none' });
    expect(resolveReportConfig({ 'on-completion': [entry(TEMPLATE)] })).toEqual({
      'on-completion': [{ 'report-template-id': TEMPLATE, 'query-source': 'inquiry' }],
      'on-report-match': 'none',
    });
    expect(resolvedReportConfigSchema.safeParse(resolveReportConfig({})).success).toBe(true);
    expect(resolvedReportConfigSchema.safeParse({}).success).toBe(false);
  });

  it('points the publish rule at the refused entry (F07)', () => {
    expect(reportConfigEntryPointer(0)).toBe('/data/attributes/report-config/on-completion/0');
    expect(reportConfigEntryPointer(9)).toBe('/data/attributes/report-config/on-completion/9');
  });
});
