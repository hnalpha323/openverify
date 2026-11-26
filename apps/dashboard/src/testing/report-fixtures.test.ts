// @vitest-environment node
import { PII_REPORT_ATTRIBUTES } from '@openverify/contracts';
import { REPORT_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { pendingReport, report, reportAction, reportPiiValues, reportRun } from './report-fixtures';

describe('the report test fixtures (C70.3)', () => {
  it.each(REPORT_TYPES)('mask a %s report as the API does: its query member-wise', (type) => {
    const masked = report(type, { masked: true }).attributes as Record<string, unknown>;

    for (const name of PII_REPORT_ATTRIBUTES.filter((each) => each in masked)) {
      if (name === 'query') {
        expect(Object.values(masked.query as object).every((value) => value === null)).toBe(true);
      } else {
        expect(masked[name], name).toBeNull();
      }
    }
  });

  it.each(REPORT_TYPES)('find the distinctive personal values of a %s report', (type) => {
    const values = reportPiiValues(type);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => !/^[a-z_-]+$/.test(value))).toBe(true);
  });

  it('build a pending report, and history entries of the golden history', () => {
    expect(pendingReport('watchlist').attributes).toMatchObject({
      status: 'pending',
      'has-match': false,
      matches: [],
    });
    expect(reportRun({ notes: ['recurring_limit'] }).attributes.notes).toEqual(['recurring_limit']);
    expect(reportAction({ 'action-type': 'pause' }).attributes['action-type']).toBe('pause');
  });
});
