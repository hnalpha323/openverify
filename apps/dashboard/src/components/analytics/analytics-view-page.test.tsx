import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  ANALYTICS_READER,
  funnelAnswer,
  inquiriesAnswer,
  serveAnalytics,
} from '../../testing/routes/analytics';
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

const NOW = new Date('2026-10-30T12:00:00.000Z');

describe('an analytics view (C164.9)', () => {
  it('shows the forbidden panel without analytics:read and asks for nothing', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await renderAnalyticsView({ view: 'overview', params: {}, now: NOW }));

    expect(screen.getByTestId('forbidden-panel')).toHaveTextContent('analytics:read');
    expect(api.all('GET', '/analytics/inquiries')).toEqual([]);
  });

  it('names the section and links the six views, the current one marked', async () => {
    api.me({ permissions: ANALYTICS_READER });
    serveAnalytics(api, 'funnel', funnelAnswer());

    render(await renderAnalyticsView({ view: 'funnel', params: {}, now: NOW }));

    expect(screen.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    const tabs = within(screen.getByRole('navigation', { name: 'Analytics views' }));
    expect(tabs.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Overview',
      'Funnel',
      'Verifications',
      'Checks',
      'Cases',
      'Signals',
    ]);
    expect(tabs.getByRole('link', { name: 'Funnel' })).toHaveAttribute('aria-current', 'page');
  });

  it('asks for the 30 local days ending today when the URL names no window', async () => {
    api.me({ permissions: ANALYTICS_READER });
    serveAnalytics(api, 'inquiries', inquiriesAnswer());

    await renderAnalyticsView({ view: 'overview', params: {}, now: NOW });

    const asked = api.all('GET', '/analytics/inquiries');
    expect(asked).toHaveLength(1);
    expect(Object.fromEntries(asked[0]?.query ?? [])).toEqual({
      'filter[from]': '2026-10-01',
      'filter[to]': '2026-10-30',
      bucket: 'day',
    });
  });

  it('asks again once when today in the reporting zone is another day', async () => {
    api.me({ permissions: ANALYTICS_READER });
    serveAnalytics(api, 'inquiries', inquiriesAnswer({ zone: 'Asia/Tokyo' }));

    await renderAnalyticsView({
      view: 'overview',
      params: {},
      now: new Date('2026-10-30T23:30:00.000Z'),
    });

    const asked = api.all('GET', '/analytics/inquiries');
    expect(asked).toHaveLength(2);
    expect(asked[1]?.query.get('filter[to]')).toBe('2026-10-31');
    expect(asked[1]?.query.get('filter[from]')).toBe('2026-10-02');
  });

  it('keeps a window the URL names, whatever the zone', async () => {
    api.me({ permissions: ANALYTICS_READER });
    serveAnalytics(api, 'inquiries', inquiriesAnswer({ zone: 'Asia/Tokyo' }));

    await renderAnalyticsView({
      view: 'overview',
      params: { from: '2026-10-01', to: '2026-10-03' },
      now: new Date('2026-10-30T23:30:00.000Z'),
    });

    expect(api.all('GET', '/analytics/inquiries')).toHaveLength(1);
  });
});

/** The CSV a click on the download gives: its file name and its records, read back. */
async function downloadedCsv(): Promise<{ name: string; type: string; records: string[][] }> {
  const blobs: Blob[] = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:analytics-download';
  });
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
  const names: string[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  try {
    await userEvent.click(screen.getByRole('button', { name: 'Download this view as CSV' }));
  } finally {
    click.mockRestore();
    vi.unstubAllGlobals();
  }
  const [blob] = blobs;
  if (blob === undefined) {
    throw new Error('No file was made');
  }
  const text = await blob.text();
  const records = text
    .split('\r\n')
    .filter((line) => line !== '')
    .map((line) =>
      [...line.matchAll(/"((?:[^"]|"")*)"/gu)].map((match) =>
        (match[1] ?? '').replaceAll('""', '"'),
      ),
    );
  return { name: names[0] ?? '', type: blob.type, records };
}

describe('the analytics download (C164; K9-18)', () => {
  it('offers the view as CSV built from the suppressed answer the page holds, with what the figures mean first', async () => {
    api.me({ permissions: ANALYTICS_READER });
    serveAnalytics(api, 'inquiries', inquiriesAnswer());
    render(
      await renderAnalyticsView({
        view: 'overview',
        params: { from: '2026-10-01', to: '2026-10-03' },
        now: NOW,
      }),
    );

    const { name, type, records } = await downloadedCsv();

    expect(name).toMatch(/^analytics-overview-.+\.csv$/u);
    expect(type).toBe('text/csv;charset=utf-8');
    expect(api.all('GET', '/analytics/inquiries')).toHaveLength(1);
    const flat = records.map((record) => record.join(' | '));
    expect(flat).toContainEqual(
      expect.stringMatching(/^Time zone: UTC\. Days are local days in it\.$/u),
    );
    expect(flat).toContainEqual(expect.stringMatching(/^Counted up to /u));
    expect(flat).toContainEqual(expect.stringMatching(/show as "fewer than 11"/u));
    expect(flat).toContainEqual(
      expect.stringMatching(/^Definition \| Success rate \| .*over finished inquiries/u),
    );
    const totals = records.find((record) => record[0] === 'Completed with fallback');
    expect(totals?.[1]).toBe('fewer than 11');
    expect(records.find((record) => record[0] === 'Completed unverified')?.[1]).toBe('hidden');
    expect(records.find((record) => record[0] === 'Completed verified')?.[1]).toBe('12');
  });

  it('never writes a value the table hides: every suppressed cell is its mark', async () => {
    api.me({ permissions: ANALYTICS_READER });
    serveAnalytics(api, 'inquiries', inquiriesAnswer());
    render(
      await renderAnalyticsView({
        view: 'overview',
        params: { from: '2026-10-01', to: '2026-10-03' },
        now: NOW,
      }),
    );
    const shown = within(screen.getByRole('table', { name: /^Inquiries by/u }))
      .getAllByRole('row')
      .map((row) =>
        within(row)
          .queryAllByRole('cell')
          .map((cell) => cell.textContent),
      );

    const { records } = await downloadedCsv();

    const live = records.find((record) => /^\d{4}-\d{2}-\d{2} \(live\)$/u.test(record[0] ?? ''));
    expect(live?.[1]).toBe('fewer than 11');
    expect(records.map((record) => record.slice(1))).toEqual(
      expect.arrayContaining(shown.slice(1)),
    );
  });
});
