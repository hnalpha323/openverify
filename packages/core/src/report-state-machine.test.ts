import { describe, expect, it } from 'vitest';
import {
  InvalidReportTransitionError,
  REPORT_ACTOR_TYPES,
  REPORT_COVERAGE_LIMITS,
  REPORT_ERROR_CODES,
  REPORT_EVENT_ACTION_BY_STATUS,
  REPORT_RUN_NOTES,
  REPORT_SOURCE_ERROR_CODES,
  REPORT_STATUSES,
  REPORT_TRANSITIONS,
  canTransitionReport,
  reportErrorCodeSchema,
  reportStatusOfRun,
  transitionReport,
  type ReportStatus,
} from './report-state-machine.js';

describe('REPORT_STATUSES and REPORT_TRANSITIONS (C69.2)', () => {
  it('has the four public statuses, submitted reserved', () => {
    expect(REPORT_STATUSES).toEqual(['pending', 'submitted', 'ready', 'errored']);
  });

  it('declares exactly the C69.2 table', () => {
    expect(REPORT_TRANSITIONS).toEqual({
      pending: ['ready', 'errored'],
      submitted: [],
      ready: ['ready', 'errored'],
      errored: ['ready', 'errored'],
    });
    expect(Object.isFrozen(REPORT_TRANSITIONS)).toBe(true);
  });

  it('never enters pending or submitted again (decision 3)', () => {
    for (const from of REPORT_STATUSES) {
      expect(canTransitionReport(from, 'pending')).toBe(false);
      expect(canTransitionReport(from, 'submitted')).toBe(false);
    }
  });

  it('lets a recurrable report run again, ready or errored, and a one-off end once', () => {
    const later: [ReportStatus, ReportStatus][] = [
      ['ready', 'ready'],
      ['ready', 'errored'],
      ['errored', 'ready'],
      ['errored', 'errored'],
    ];
    for (const [from, to] of later) {
      expect(canTransitionReport(from, to)).toBe(true);
      expect(canTransitionReport(from, to, { recurrable: true })).toBe(true);
      expect(canTransitionReport(from, to, { recurrable: false })).toBe(false);
    }
    expect(canTransitionReport('pending', 'ready', { recurrable: false })).toBe(true);
    expect(canTransitionReport('pending', 'errored', { recurrable: false })).toBe(true);
  });

  it('names the event action of the status entered, and refuses the rest', () => {
    expect(REPORT_EVENT_ACTION_BY_STATUS).toEqual({ ready: 'ready', errored: 'errored' });
    expect(transitionReport('pending', 'ready')).toBe('ready');
    expect(transitionReport('ready', 'errored')).toBe('errored');
    expect(() => transitionReport('ready', 'pending')).toThrow(InvalidReportTransitionError);
    expect(() => transitionReport('ready', 'ready', { recurrable: false })).toThrow(
      'Report cannot transition from "ready" to "ready"',
    );
    expect(() => transitionReport('constructor' as ReportStatus, 'ready')).toThrow(
      InvalidReportTransitionError,
    );
    try {
      transitionReport('errored', 'submitted');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_report_transition',
        from: 'errored',
        to: 'submitted',
      });
    }
  });

  it('gives a report the status of its latest completed run', () => {
    expect(reportStatusOfRun('ready')).toBe('ready');
    expect(reportStatusOfRun('errored')).toBe('errored');
  });
});

describe('report vocabularies (C69.3, C73.2, C78.5)', () => {
  it('has the C69.3 error codes, and the ones that name a source', () => {
    expect(REPORT_ERROR_CODES).toEqual([
      'insufficient_input',
      'list_unavailable',
      'list_stale',
      'result_truncated',
      'matcher_data_unavailable',
      'provider_not_configured',
      'provider_error',
      'execution_error',
    ]);
    expect(reportErrorCodeSchema.options).toEqual([...REPORT_ERROR_CODES]);
    expect(REPORT_SOURCE_ERROR_CODES).toEqual([
      'list_unavailable',
      'list_stale',
      'matcher_data_unavailable',
    ]);
  });

  it('has the C73.2 run notes and the C78.5 coverage limits, codes only', () => {
    expect(REPORT_RUN_NOTES).toEqual([
      'inquiry_already_decided',
      'report_match',
      'report_errored',
      'recurring_limit',
      'evidence_changed',
      'risk_data_changed',
      'match_not_found_in_run',
    ]);
    expect(REPORT_COVERAGE_LIMITS).toEqual([
      'lossy_script',
      'not_compared',
      'truncated',
      'unclassified_format',
      'title_only',
      'window_90_days',
      'lexicon_languages',
    ]);
  });
});

describe('REPORT_ACTOR_TYPES (C121.1)', () => {
  it('names a workflow run beside a user, an API key and the system', () => {
    expect(REPORT_ACTOR_TYPES).toEqual(['user', 'api_key', 'system', 'workflow_run']);
  });
});
