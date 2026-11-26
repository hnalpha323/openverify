import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  ANALYTICS_IDS,
  ANALYTICS_MANAGER,
  ANALYTICS_READER,
  casesAnswer,
  checksAnswer,
  funnelAnswer,
  inquiriesAnswer,
  serveAnalytics,
  signalsAnswer,
  verificationsAnswer,
} from '../../testing/routes/analytics';
import type { AnalyticsView } from './analytics-query';
import { renderAnalyticsView } from './analytics-view-page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const NOW = new Date('2026-10-03T12:00:00.000Z');
const WINDOW = { from: '2026-10-01', to: '2026-10-03' };

async function show(view: AnalyticsView, params: Record<string, string> = WINDOW) {
  render(await renderAnalyticsView({ view, params, now: NOW }));
}

const table = (name: string | RegExp) => within(screen.getByRole('table', { name }));
const cellsOf = (name: string | RegExp, row: string) =>
  within(table(name).getByRole('rowheader', { name: row }).closest('tr') as HTMLElement)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

describe('the overview (C164.1)', () => {
  beforeEach(() => {
    api.me({ permissions: ANALYTICS_READER });
  });

  it('shows the suppression marks in the table: fewer than the threshold, hidden, live', async () => {
    serveAnalytics(api, 'inquiries', inquiriesAnswer());

    await show('overview');

    const live = cellsOf('Inquiries by day', '2026-10-03 (live)');
    expect(live[0]).toBe('fewer than 11');
    expect(live[1]).toBe('0');
    expect(live[2]).toBe('not shown live');
    const totals = table('Inquiries over the window');
    expect(
      within(
        totals
          .getByRole('rowheader', { name: 'Completed with fallback' })
          .closest('tr') as HTMLElement,
      ).getByText('fewer than 11'),
    ).toBeVisible();
    expect(
      within(
        totals
          .getByRole('rowheader', { name: 'Completed unverified' })
          .closest('tr') as HTMLElement,
      ).getByText('hidden'),
    ).toBeVisible();
    expect(cellsOf('Inquiries over the window', 'Time to finish')[0]).toBe(
      'between 4 and 6 minutes (approximate)',
    );
  });

  it('splits success three ways, each rate with its terms, bounds and hidden rates in words', async () => {
    serveAnalytics(api, 'inquiries', inquiriesAnswer());

    await show('overview');

    expect(cellsOf('Rates over the window', 'Success rate')).toEqual([
      '83.3%',
      'Finished inquiries now completed or approved, over finished inquiries. (completed + approved over finished, counted in inquiries.)',
    ]);
    expect(cellsOf('Rates over the window', 'Completed with fallback rate')[0]).toBe('under 42%');
    expect(cellsOf('Rates over the window', 'Completed unverified rate')[0]).toBe(
      'not shown (too few)',
    );
    expect(screen.getByText(/Success is split three ways/)).toBeVisible();
  });

  it('captions the chart from the suppressed answer only', async () => {
    serveAnalytics(api, 'inquiries', inquiriesAnswer());

    await show('overview');

    const figure = screen.getByRole('figure');
    expect(
      within(figure).getByRole('img', { name: 'Inquiries created and started by day' }),
    ).toBeInTheDocument();
    expect(figure.querySelector('figcaption')?.textContent).toBe(
      'From 2026-10-01 to 2026-10-03 (UTC): 40 inquiries created, 30 started and 24 finished. Success rate 83.3% of finished inquiries: 12 completed with every verification passed, fewer than 11 through a fallback, hidden with no verification.',
    );
  });

  it('states the zone, window, freshness, live day, settle window, threshold and limits', async () => {
    serveAnalytics(api, 'inquiries', inquiriesAnswer());

    await show('overview');

    const about = within(screen.getByRole('region', { name: 'About these figures' }));
    expect(about.getByText('Time zone: UTC. Days are local days in it.')).toBeVisible();
    expect(about.getByText('Window: 2026-10-01 to 2026-10-03, both included.')).toBeVisible();
    expect(about.getByText(/^Counted up to Oct 3, 2026, 11:55 AM UTC/)).toBeVisible();
    expect(about.getByText(/^Outcomes of open days as of Oct 3, 2026, 12:05 AM UTC/)).toBeVisible();
    expect(
      about.getByText(/^Today \(2026-10-03\) is live: it shows created and started only/),
    ).toBeVisible();
    expect(about.getByText(/recounted for 30 days after it, then frozen/)).toBeVisible();
    expect(
      about.getByText(/Counts from 1 to 10 show as "fewer than 11".*\(2 hidden in this answer\)/),
    ).toBeVisible();
    expect(
      about.getByText(/^Suppression does not stop someone comparing two overlapping windows/),
    ).toBeVisible();
    expect(
      about.getByText(/only once every started inquiry has finished or expired/),
    ).toBeVisible();
    expect(
      about.getByText('Inquiries whose first step the server served (pending).'),
    ).toBeInTheDocument();
  });

  it('marks a range that mixes zones, and freshness before the first count', async () => {
    serveAnalytics(
      api,
      'inquiries',
      inquiriesAnswer({
        zones: ['Europe/Paris', 'UTC'],
        rolledUpThrough: null,
        outcomesAsOf: null,
      }),
    );

    await show('overview');

    expect(screen.getByText(/This range mixes time zones \(Europe\/Paris, UTC\)/)).toBeVisible();
    expect(
      table('Inquiries by day').getByRole('rowheader', { name: '2026-10-01 counted in UTC' }),
    ).toBeVisible();
    expect(screen.getByText(/^Not counted yet/)).toBeVisible();
    expect(screen.getByText('Outcomes of open days not refreshed yet.')).toBeVisible();
  });

  it('says what a tag filter counts', async () => {
    serveAnalytics(api, 'inquiries', inquiriesAnswer());

    await show('overview', { ...WINDOW, tag: 'vip' });

    expect(api.find('GET', '/analytics/inquiries')?.query.get('filter[tag]')).toBe('vip');
    expect(
      screen.getByText(/With a tag filter only created, started, finished and completed/),
    ).toBeVisible();
  });
});

describe('the funnel (C164.2)', () => {
  beforeEach(() => {
    api.me({ permissions: ANALYTICS_READER });
  });

  it('shows "no step data" before the first step record, never 0', async () => {
    serveAnalytics(api, 'funnel', funnelAnswer());

    await show('funnel');

    expect(cellsOf('Inquiries started by day', '2026-10-01')).toEqual(['no step data']);
    expect(cellsOf('Inquiries started by day', '2026-10-02')).toEqual(['20']);
    expect(
      screen.getByText('Step data from 2026-10-02; earlier days show "no step data".'),
    ).toBeVisible();
  });

  it('lists each version’s steps with both shares, its transitions and its paths', async () => {
    serveAnalytics(api, 'funnel', funnelAnswer());

    await show('funnel');

    const steps = `Steps of version ${ANALYTICS_IDS.version}`;
    expect(cellsOf(steps, 'consent')).toEqual([
      '40',
      '38',
      '0',
      '100%',
      'Its overall share stands for the entry step: no transition leads into it.',
    ]);
    expect(cellsOf(steps, 'government_id')).toEqual(['30', '25', 'fewer than 11', '75%', '78.9%']);
    expect(
      cellsOf(`Transitions of version ${ANALYTICS_IDS.version}`, 'consent to government_id'),
    ).toEqual(['38']);
    expect(cellsOf(`Most frequent paths of version ${ANALYTICS_IDS.version}`, 'consent')).toEqual([
      'fewer than 11',
    ]);
    expect(screen.getByRole('figure').querySelector('figcaption')?.textContent).toBe(
      `Version ${ANALYTICS_IDS.version}: 40 inquiries started; inquiries entering each of its 2 person-visible steps.`,
    );
  });

  it('says so when no step was ever recorded', async () => {
    serveAnalytics(api, 'funnel', funnelAnswer({ stepDataFrom: null }));

    await show('funnel');

    expect(screen.getByText(/^No step data yet: the server has not recorded a step/)).toBeVisible();
    expect(cellsOf('Inquiries started by day', '2026-10-03 (live)')).toEqual(['no step data']);
  });

  it('refuses a platform or device filter instead of asking', async () => {
    await show('funnel', { ...WINDOW, platform: 'web' });

    expect(api.all('GET', '/analytics/funnel')).toEqual([]);
    expect(
      screen.getByText(/Platform: This view cannot filter by platform or device kind/),
    ).toBeVisible();
    expect(screen.queryByLabelText('Platform')).toBeNull();
  });
});

describe('verifications (C164.3)', () => {
  it('labels each rate with its unit and denominator, capture method as client-reported', async () => {
    api.me({ permissions: ANALYTICS_READER });
    serveAnalytics(api, 'verifications', verificationsAnswer());

    await show('verifications');

    expect(
      screen.getByText(/^step passed over step entered, counted in people and steps\./),
    ).toBeVisible();
    expect(
      screen.getByText(/^passed over passed \+ failed \+ requires retry, counted in attempts\./),
    ).toBeVisible();
    const groups = table('Verification attempts by type, capture method and country');
    expect(
      groups.getByRole('columnheader', { name: 'Capture method (client-reported)' }),
    ).toBeVisible();
    expect(
      cellsOf('Verification attempts by type, capture method and country', 'selfie').slice(0, 2),
    ).toEqual(['not reported', 'unknown']);
    expect(
      cellsOf('Verification attempts by type, capture method and country', 'government-id').at(-1),
    ).toBe('over 70%');
    expect(cellsOf('Verification steps, per person', 'government_id (government-id)').at(-1)).toBe(
      '73.3%',
    );
    expect(
      screen.getByRole('columnheader', {
        name: 'Pass rate per person and step (people and steps)',
      }),
    ).toBeVisible();
  });
});

describe('checks (C164.4)', () => {
  it('shows "not run" for a check without results, beta labelled, errored apart', async () => {
    api.me({ permissions: ANALYTICS_READER });
    serveAnalytics(api, 'checks', checksAnswer());

    await show('checks');

    const notRun = cellsOf('Checks and their results', 'id_double_side_detection');
    expect(notRun.slice(0, 2)).toEqual(['government-id', 'Advisory']);
    expect(notRun[2]).toContain('beta');
    expect(notRun.slice(3)).toEqual(Array(8).fill('not run'));
    const ran = cellsOf('Checks and their results', 'id_barcode_detection');
    expect(ran.slice(3)).toEqual([
      '60',
      '45',
      '0',
      '0',
      'fewer than 11',
      '0',
      '0',
      'not shown (too few)',
    ]);
    expect(
      cellsOf('Reasons per check, a check used both ways combined', 'id_barcode_detection'),
    ).toEqual(['provider_unavailable', 'fewer than 11']);
    expect(screen.getByRole('figure').querySelector('figcaption')?.textContent).toContain(
      '1 of 2 checks ran; 1 did not run in the window',
    );
  });
});

describe('cases (C164.5)', () => {
  it('hides the per-reviewer figures from a reader without users:write', async () => {
    api.me({ permissions: ANALYTICS_READER });
    serveAnalytics(api, 'cases', casesAnswer({ assignees: true }));

    await show('cases');

    expect(screen.queryByRole('table', { name: 'Cases per reviewer' })).toBeNull();
    expect(screen.getByText(/only to readers who also hold users:write/)).toBeVisible();
    expect(screen.queryByText(ANALYTICS_IDS.reviewer)).toBeNull();
    expect(cellsOf('Resolution time', 'Median')[0]).toBe('between 60 and 90 minutes (approximate)');
    expect(cellsOf('Resolution time', '90th percentile')[0]).toBe('not shown (too few)');
    expect(screen.getByText('No availability figures are counted.')).toBeVisible();
  });

  it('shows them to a reader who also holds users:write, a former user as one row', async () => {
    api.me({ permissions: ANALYTICS_MANAGER });
    serveAnalytics(api, 'cases', casesAnswer({ assignees: true }));

    await show('cases');

    expect(cellsOf('Cases per reviewer', ANALYTICS_IDS.reviewer)).toEqual(['15', '12']);
    expect(cellsOf('Cases per reviewer', 'Former user')).toEqual(['fewer than 11', 'not counted']);
  });
});

describe('signals (C164.6)', () => {
  it('lists each signal’s bins, its tier and stage, and the inquiries not evaluated', async () => {
    api.me({ permissions: ANALYTICS_READER });
    serveAnalytics(api, 'signals', signalsAnswer());

    await show('signals');

    expect(cellsOf('Bins of inquiry/bot_score', 'not evaluated')).toEqual(['fewer than 11']);
    expect(cellsOf('Bins of inquiry/bot_score', '10-19')).toEqual(['fewer than 11']);
    expect(screen.getByText('Tier H, beta')).toBeVisible();
    expect(screen.getByRole('figure').querySelector('figcaption')?.textContent).toBe(
      'inquiry/bot_score over 3 bins; fewer than 11 not evaluated. The largest shown bin is 0-9 (30); hidden bins are not compared.',
    );
  });
});
