import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_VIEWS,
  analyticsViewFields,
  analyticsViewPath,
  defaultAnalyticsWindow,
  localDayIn,
  parseAnalyticsQuery,
} from './analytics-query';

const TEMPLATE = 'itmpl_01JF0000000000000000000001';
const VERSION = 'itmplv_01JF0000000000000000000002';
const CASE_TEMPLATE = 'ctmpl_01JF0000000000000000000004';
const TODAY = '2026-10-30';

describe('the analytics views', () => {
  it('has six views, the overview at /analytics', () => {
    expect(ANALYTICS_VIEWS.map(analyticsViewPath)).toEqual([
      '/analytics',
      '/analytics/funnel',
      '/analytics/verifications',
      '/analytics/checks',
      '/analytics/cases',
      '/analytics/signals',
    ]);
  });

  it('takes, per view, only the filters its answer takes (C164.8, AA1)', () => {
    expect(analyticsViewFields('overview')).toEqual([
      'template',
      'version',
      'platform',
      'device',
      'tag',
    ]);
    expect(analyticsViewFields('funnel')).toEqual(['template', 'version']);
    expect(analyticsViewFields('verifications')).toEqual(['template', 'version']);
    expect(analyticsViewFields('checks')).toEqual(['template', 'version']);
    expect(analyticsViewFields('signals')).toEqual(['template', 'version', 'platform', 'device']);
    expect(analyticsViewFields('cases')).toEqual(['case-template']);
  });
});

describe('the window', () => {
  it('defaults to the 30 local days ending today, both included', () => {
    expect(defaultAnalyticsWindow(TODAY)).toEqual({ from: '2026-10-01', to: TODAY });
    expect(defaultAnalyticsWindow('2026-03-01')).toEqual({ from: '2026-01-31', to: '2026-03-01' });
  });

  it('reads the local day of an instant in the reporting zone', () => {
    const instant = new Date('2026-10-30T23:30:00.000Z');
    expect(localDayIn(instant, 'UTC')).toBe('2026-10-30');
    expect(localDayIn(instant, 'Asia/Tokyo')).toBe('2026-10-31');
    expect(localDayIn(instant, 'America/Los_Angeles')).toBe('2026-10-30');
  });
});

describe('parseAnalyticsQuery', () => {
  it('fills the window, asks for days and sends nothing else', () => {
    const query = parseAnalyticsQuery('overview', {}, TODAY);
    expect(query.errors).toEqual({});
    expect(query.values.from).toBe('2026-10-01');
    expect(query.values.to).toBe(TODAY);
    expect(query.api).toEqual({
      'filter[from]': '2026-10-01',
      'filter[to]': TODAY,
      bucket: 'day',
    });
  });

  it('sends every filter the overview takes, as the route names it', () => {
    const query = parseAnalyticsQuery(
      'overview',
      {
        from: '2026-09-01',
        to: '2026-09-30',
        bucket: 'week',
        template: TEMPLATE,
        version: VERSION,
        platform: 'web',
        device: 'mobile-web',
        tag: 'vip',
      },
      TODAY,
    );
    expect(query.api).toEqual({
      'filter[from]': '2026-09-01',
      'filter[to]': '2026-09-30',
      bucket: 'week',
      'filter[inquiry-template-id]': TEMPLATE,
      'filter[inquiry-template-version-id]': VERSION,
      'filter[platform]': 'web',
      'filter[device-kind]': 'mobile-web',
      'filter[tag]': 'vip',
    });
    expect(query.notTaken).toEqual([]);
  });

  it('never sends a filter the view does not take, and says it was not applied', () => {
    const query = parseAnalyticsQuery(
      'funnel',
      { tag: 'vip', 'case-template': CASE_TEMPLATE, template: TEMPLATE },
      TODAY,
    );
    expect(query.api).toEqual({
      'filter[from]': '2026-10-01',
      'filter[to]': TODAY,
      bucket: 'day',
      'filter[inquiry-template-id]': TEMPLATE,
    });
    expect(query.notTaken).toEqual(['tag', 'case-template']);
  });

  it('refuses a platform or device filter on the funnel, verifications and checks (AA1)', () => {
    for (const view of ['funnel', 'verifications', 'checks'] as const) {
      const query = parseAnalyticsQuery(view, { platform: 'web', device: 'native' }, TODAY);
      expect(query.api).toBeNull();
      expect(query.errors.platform).toMatch(/cannot filter by platform or device kind/);
      expect(query.errors.device).toMatch(/cannot filter by platform or device kind/);
    }
  });

  it('cases take the case template only', () => {
    const query = parseAnalyticsQuery(
      'cases',
      { 'case-template': CASE_TEMPLATE, template: TEMPLATE },
      TODAY,
    );
    expect(query.api).toEqual({
      'filter[from]': '2026-10-01',
      'filter[to]': TODAY,
      bucket: 'day',
      'filter[case-template-id]': CASE_TEMPLATE,
    });
    expect(query.notTaken).toEqual(['template']);
  });

  it('explains every value the API would refuse, and asks for nothing then', () => {
    const query = parseAnalyticsQuery(
      'overview',
      {
        from: '2026-02-30',
        to: 'yesterday',
        bucket: 'year',
        template: 'itmpl_1',
        version: 'itmpl_01JF0000000000000000000001',
        platform: 'ios',
        device: 'tv',
        tag: 'Not a tag!',
      },
      TODAY,
    );
    expect(query.api).toBeNull();
    expect(query.errors).toEqual({
      from: 'Enter a date as YYYY-MM-DD.',
      to: 'Enter a date as YYYY-MM-DD.',
      bucket: 'Choose a value from the list.',
      template: 'Enter a template ID: itmpl_ followed by 26 letters and digits.',
      version: 'Enter a version ID: itmplv_ followed by 26 letters and digits.',
      platform: 'Choose a value from the list.',
      device: 'Choose a value from the list.',
      tag: 'Enter one tag as the inquiry list shows it.',
    });
    expect(query.values.from).toBe('2026-02-30');
  });

  it('refuses an end before the start and a window over 400 days', () => {
    expect(
      parseAnalyticsQuery('overview', { from: '2026-10-02', to: '2026-10-01' }, TODAY),
    ).toMatchObject({ api: null, errors: { to: 'The end must not be before the start.' } });
    expect(
      parseAnalyticsQuery('overview', { from: '2025-01-01', to: '2026-02-05' }, TODAY),
    ).toMatchObject({ api: null, errors: { to: 'The window is at most 400 days.' } });
    expect(
      parseAnalyticsQuery('overview', { from: '2025-01-01', to: '2026-02-04' }, TODAY).api,
    ).not.toBeNull();
  });

  it('reads the first of repeated values and trims them', () => {
    const query = parseAnalyticsQuery('signals', { from: [' 2026-10-05 ', 'x'] }, TODAY);
    expect(query.values.from).toBe('2026-10-05');
    expect(query.api?.['filter[from]']).toBe('2026-10-05');
  });
});
