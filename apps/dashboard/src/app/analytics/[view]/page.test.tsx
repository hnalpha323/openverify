import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { expectNotFound } from '../../../testing/next-errors';
import { ANALYTICS_READER, checksAnswer, serveAnalytics } from '../../../testing/routes/analytics';
import AnalyticsOverview, { metadata as overviewMetadata } from '../page';
import AnalyticsViewRoute, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ANALYTICS_READER });
});

afterEach(() => {
  api.restore();
});

describe('the analytics routes', () => {
  it('serve each view at its own path', async () => {
    expect(metadata.title).toBe('Analytics');
    expect(overviewMetadata.title).toBe('Analytics');
    serveAnalytics(api, 'checks', checksAnswer());

    await AnalyticsViewRoute({
      params: Promise.resolve({ view: 'checks' }),
      searchParams: Promise.resolve({}),
    });

    expect(api.all('GET', '/analytics/checks')).toHaveLength(1);
  });

  it('answer not found for an unknown view, and for the overview’s own name', async () => {
    for (const view of ['sessions', 'overview']) {
      await expectNotFound(
        AnalyticsViewRoute({
          params: Promise.resolve({ view }),
          searchParams: Promise.resolve({}),
        }),
      );
    }
  });

  it('serve the overview at /analytics', async () => {
    api.on('GET', '/analytics/inquiries', 500, {});

    await expect(AnalyticsOverview({ searchParams: Promise.resolve({}) })).rejects.toThrow();
    expect(api.all('GET', '/analytics/inquiries').length).toBeGreaterThan(0);
  });
});
