/**
 * C164.8 (Workflow 9B Stage 1a, (A)): the read-only aggregates API's queries and answers. Every
 * answer is one environment's (A13), names its time zone, window, threshold, suppressed cells and
 * freshness, and carries counts only after suppression: a visible count is 0 or at least the
 * threshold, which the answer schema itself refuses otherwise (rule 10: suppression is never
 * bypassed). Read through the package root, so the index line is held too.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as contracts from './index.js';
import { readFixture } from './test-support.js';

type Schema = z.ZodType;
const schema = (name: string): Schema => {
  const found = (contracts as Readonly<Record<string, unknown>>)[name];
  expect(found, name).toBeDefined();
  return found as Schema;
};
const parses = (name: string, value: unknown) => schema(name).safeParse(value).success;

const REPORTS = ['inquiries', 'funnel', 'verifications', 'checks', 'cases', 'signals'] as const;
const pascal = (report: string) => `${report.slice(0, 1).toUpperCase()}${report.slice(1)}`;
const querySchemaOf = (report: string) => `analytics${pascal(report)}QuerySchema`;
const documentSchemaOf = (report: string) => `analytics${pascal(report)}DocumentSchema`;

const window = { 'filter[from]': '2026-08-01', 'filter[to]': '2026-10-29' };

describe('the analytics queries (C164.8)', () => {
  it.each(REPORTS)('%s takes a local-date window and a bucket', (report) => {
    expect(parses(querySchemaOf(report), window)).toBe(true);
    expect(parses(querySchemaOf(report), { ...window, bucket: 'week' })).toBe(true);
    expect(parses(querySchemaOf(report), { ...window, bucket: 'hour' })).toBe(false);
    expect(parses(querySchemaOf(report), { 'filter[from]': '2026-08-01' })).toBe(false);
  });

  it.each(REPORTS)('%s refuses a window past 400 days, a reversed one and an instant', (report) => {
    expect(
      parses(querySchemaOf(report), { 'filter[from]': '2025-09-25', 'filter[to]': '2026-10-29' }),
    ).toBe(true);
    expect(
      parses(querySchemaOf(report), { 'filter[from]': '2025-09-24', 'filter[to]': '2026-10-29' }),
    ).toBe(false);
    expect(
      parses(querySchemaOf(report), { 'filter[from]': '2026-10-29', 'filter[to]': '2026-10-28' }),
    ).toBe(false);
    expect(
      parses(querySchemaOf(report), {
        'filter[from]': '2026-08-01T00:00:00Z',
        'filter[to]': '2026-10-29',
      }),
    ).toBe(false);
  });

  it('filters inquiries by template, version, platform, device kind and tag name', () => {
    expect(
      parses('analyticsInquiriesQuerySchema', {
        ...window,
        'filter[inquiry-template-id]': 'itmpl_01M5CN00000000000000009B10',
        'filter[inquiry-template-version-id]': 'itmplv_01M5CN00000000000000009B11',
        'filter[platform]': 'android',
        'filter[device-kind]': 'mobile-web',
        'filter[tag]': 'vip',
      }),
    ).toBe(true);
    expect(parses('analyticsInquiriesQuerySchema', { ...window, 'filter[platform]': 'ios' })).toBe(
      false,
    );
  });

  it('keeps the tag to inquiries and the case template to cases', () => {
    expect(parses('analyticsFunnelQuerySchema', { ...window, 'filter[tag]': 'vip' })).toBe(false);
    expect(
      parses('analyticsCasesQuerySchema', {
        ...window,
        'filter[case-template-id]': 'ctmpl_01M5CN00000000000000009B12',
      }),
    ).toBe(true);
    expect(parses('analyticsCasesQuerySchema', { ...window, 'filter[platform]': 'web' })).toBe(
      false,
    );
  });
});

describe('the analytics answers (C164.8, C164.7)', () => {
  it.each(REPORTS)('%s: its golden answer parses and re-serializes unchanged', (report) => {
    const raw = readFixture(`api/analytics-${report}.json`);
    const parsed = schema(documentSchemaOf(report)).parse(raw);
    expect(parsed).toEqual(raw);
    expect(parsed).toMatchObject({
      data: {
        type: `analytics-${report}`,
        attributes: { threshold: 11, 'time-zone': 'Europe/Paris' },
      },
    });
  });

  it('refuses an answer that shows a count from 1 to the threshold minus one', () => {
    const raw = readFixture('api/analytics-inquiries.json') as {
      data: { attributes: { totals: { counts: Record<string, unknown> } } };
    };
    const leaky = structuredClone(raw);
    leaky.data.attributes.totals.counts.declined = 4;
    expect(parses('analyticsInquiriesDocumentSchema', leaky)).toBe(false);
    leaky.data.attributes.totals.counts.declined = 0;
    expect(parses('analyticsInquiriesDocumentSchema', leaky)).toBe(true);
    leaky.data.attributes.totals.counts.declined = { suppressed: 'small-count' };
    expect(parses('analyticsInquiriesDocumentSchema', leaky)).toBe(true);
  });

  it('shows a rate as a fraction, a whole-percent bound, or nothing', () => {
    const cell = schema('analyticsRateCellSchema');
    for (const value of [{ value: 0.91 }, { below: 5 }, { above: 95 }, { suppressed: true }]) {
      expect(cell.safeParse(value).success, JSON.stringify(value)).toBe(true);
    }
    for (const value of [{ value: 1.2 }, { below: 0 }, { below: 4.5 }, { value: 0.9, below: 5 }]) {
      expect(cell.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it('serves a live day with created and started only, never an outcome (reviews H28, P21)', () => {
    const raw = readFixture('api/analytics-inquiries.json') as {
      data: { attributes: { buckets: { live: boolean; counts: Record<string, unknown> }[] } };
    };
    const live = raw.data.attributes.buckets.filter((bucket) => bucket.live);
    expect(live).toHaveLength(1);
    expect(Object.keys(live[0]?.counts ?? {}).sort()).toEqual(['created', 'started']);
    const leaky = structuredClone(raw);
    const day = leaky.data.attributes.buckets.find((bucket) => bucket.live);
    if (day !== undefined) day.counts.completed = 20;
    expect(parses('analyticsInquiriesDocumentSchema', leaky)).toBe(false);
  });

  it('marks a funnel bucket before the first step record as no step data, never 0 (H17)', () => {
    const raw = readFixture('api/analytics-funnel.json') as {
      data: { attributes: { buckets: { 'step-data': boolean }[] } };
    };
    expect(raw.data.attributes.buckets.some((bucket) => !bucket['step-data'])).toBe(true);
  });

  it('serves the assignee distribution only as a member a reader without users:write gets as null', () => {
    const raw = readFixture('api/analytics-cases.json') as {
      data: { attributes: { totals: { assignees: unknown } } };
    };
    const hidden = structuredClone(raw);
    hidden.data.attributes.totals.assignees = null;
    expect(parses('analyticsCasesDocumentSchema', hidden)).toBe(true);
  });

  it('says a check that never ran in the window is not run, never zero failures (C164.4)', () => {
    const raw = readFixture('api/analytics-checks.json') as {
      data: { attributes: { totals: { checks: { ran: boolean; counts: unknown }[] } } };
    };
    const notRun = raw.data.attributes.totals.checks.filter((check) => !check.ran);
    expect(notRun.length).toBeGreaterThan(0);
    for (const check of notRun) {
      expect(check.counts).toEqual({});
    }
  });
});

describe('the analytics answer type and id', () => {
  it('names each answer analytics-<report>, keyed by the query hash', () => {
    for (const report of REPORTS) {
      const raw = readFixture(`api/analytics-${report}.json`) as { data: { id: string } };
      expect(raw.data.id).toMatch(/^[0-9a-f]{64}$/);
    }
    expect((contracts as Readonly<Record<string, unknown>>).ANALYTICS_REPORTS).toEqual(REPORTS);
  });
});
