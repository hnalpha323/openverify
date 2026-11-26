import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExportsPage from '../../app/exports/page';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { rscPayloadOf } from '../../testing/rsc-payload';
import {
  ANALYTICS_IDS,
  ANALYTICS_READER,
  INQUIRY_EXPORTER,
  casesAnswer,
  exportResource,
  serveAnalytics,
  serveExports,
} from '../../testing/routes/analytics';
import { renderAnalyticsView } from './analytics-view-page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

describe('what the analytics and exports pages send to a reader without pii:view (C31.6)', () => {
  it('sends no reviewer id to a reader without users:write, even if an answer held one', async () => {
    api.me({ permissions: ANALYTICS_READER });
    serveAnalytics(api, 'cases', casesAnswer({ assignees: true }));

    const payload = await rscPayloadOf(
      await renderAnalyticsView({
        view: 'cases',
        params: { from: '2026-10-01', to: '2026-10-03' },
        now: new Date('2026-10-03T12:00:00.000Z'),
      }),
    );

    expect(payload).toContain('Cases per reviewer are shown only to readers');
    expect(payload).not.toContain(ANALYTICS_IDS.reviewer);
  });

  it('sends an export’s filter keys only, and offers no personal data', async () => {
    api.me({ permissions: INQUIRY_EXPORTER });
    serveExports(api, [exportResource({ filterKeys: ['filter[reference-id]'] })]);

    const payload = await rscPayloadOf(await ExportsPage({ searchParams: Promise.resolve({}) }));

    expect(payload).toContain('filtered by filter[reference-id]');
    expect(payload).toContain('"canIncludePersonalData":false');
    expect(payload).not.toContain('Include personal data');
  });
});
