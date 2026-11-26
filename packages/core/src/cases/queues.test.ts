import { describe, expect, it } from 'vitest';
import {
  CASE_ASSIGNMENT_DISTRIBUTIONS,
  CASE_ASSIGNMENT_SORTS,
  CASE_ASSIGNMENT_SOURCE_TYPES,
  CASE_ASSIGNMENT_STRATEGIES,
  CASE_LIMITS,
  CASE_QUEUE_STATUSES,
  CASE_SLA_ON_REOPEN,
  CASE_SLA_STATES,
  CASE_WEEKDAYS,
  caseAssignmentStrategySchema,
  caseSlaStateSchema,
  caseWeekdaySchema,
} from '../index.js';

describe('the queue, assignment and SLA vocabularies (C132, C133)', () => {
  it('holds the public queue statuses and the policy distributions (C132.1, C132.2)', () => {
    expect(CASE_QUEUE_STATUSES).toEqual(['active', 'archived']);
    expect(CASE_ASSIGNMENT_DISTRIBUTIONS).toEqual([
      'round-robin',
      'fewest-open',
      'case-creator',
      'inquiry-creator',
    ]);
    expect(CASE_ASSIGNMENT_SORTS).toEqual(['created-at', 'sla-expires-at']);
    expect(CASE_ASSIGNMENT_SOURCE_TYPES).toEqual(['case-template', 'case-queue']);
  });

  it('names every strategy a history row can explain an assignment by (C132.3, C132.4)', () => {
    expect(CASE_ASSIGNMENT_STRATEGIES).toEqual([
      'manual',
      'pull',
      'round-robin',
      'fewest-open',
      'case-creator',
      'inquiry-creator',
    ]);
    expect(caseAssignmentStrategySchema.safeParse('availability').success).toBe(false);
  });

  it('holds the SLA states and what a reopen does (C133.1, C133.4, decision 58)', () => {
    expect(CASE_SLA_STATES).toEqual(['none', 'running', 'paused', 'met', 'expired']);
    expect(caseSlaStateSchema.safeParse('breached').success).toBe(false);
    expect(CASE_SLA_ON_REOPEN).toEqual(['continue', 'restart']);
  });

  it('holds the week in ISO order (C133.2)', () => {
    expect(CASE_WEEKDAYS).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]);
    expect(caseWeekdaySchema.safeParse('Monday').success).toBe(false);
  });

  it('states the (Q) limits with their basis (C132.1, C133.1-C133.3)', () => {
    expect(CASE_LIMITS['member-max-open'].value).toBe(500);
    expect(CASE_LIMITS['member-max-open-default'].value).toBe(50);
    expect(CASE_LIMITS['sla-target-minutes'].value).toBe(525_600);
    expect(CASE_LIMITS['calendar-validation-days'].value).toBe(730);
    expect(CASE_LIMITS['business-time-scan-days'].value).toBe(3660);
    expect(CASE_LIMITS['calendar-week-minutes-minimum'].value).toBe(60);
    for (const name of [
      'config-name-characters',
      'queue-members',
      'policy-agents',
      'policy-sources',
      'calendar-intervals-per-day',
      'calendar-holidays',
      'calendar-closures',
      'calendar-label-characters',
      'holiday-csv-characters',
    ] as const) {
      expect(CASE_LIMITS[name].basis, name).toBe('provisional');
      expect(CASE_LIMITS[name].source, name).toMatch(/C13[23]/);
    }
  });
});
