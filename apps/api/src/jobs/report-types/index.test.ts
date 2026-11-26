/**
 * C69.1: one job hook per report type, each under its own type, and a type whose owner has not
 * built it fails its runs with `ReportTypeNotBuiltError` (the framework ends them `errored`).
 */
import { REPORT_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  REPORT_TYPE_JOBS,
  reportTypeJob,
  ReportTypeNotBuiltError,
  unbuiltReportTypeJob,
  type ReportRunContext,
} from './index.js';

describe('the report type jobs (C69.1)', () => {
  it('register one job per report type, under its type', () => {
    expect(Object.keys(REPORT_TYPE_JOBS)).toEqual([...REPORT_TYPES]);
    for (const type of REPORT_TYPES) {
      expect(reportTypeJob(type).type).toBe(type);
    }
  });

  it('fail the run of a type not built yet, naming the type only', async () => {
    // The registered `watchlist` job is built (Workflow 6A Stage 3, `api-reports`).
    const job = unbuiltReportTypeJob('watchlist');

    await expect(job.run({} as ReportRunContext)).rejects.toThrow(ReportTypeNotBuiltError);
  });
});
