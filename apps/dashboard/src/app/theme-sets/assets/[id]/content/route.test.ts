// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../../testing/api-routes';
import { fakeRequest } from '../../../../../testing/fake-request';
import { THEME_IDS } from '../../../../../testing/routes/themes-copy';
import { GET } from './route';

vi.mock('next/headers', () =>
  import('../../../../../testing/fake-request').then((m) => m.nextHeaders),
);

let api: RouteApi;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = () => new Request('http://dashboard.test/');

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

describe('GET /theme-sets/assets/:id/content (C160.6)', () => {
  it('reads the operator content route with the session, and passes a refusal on as a bare status', async () => {
    api.onProblem('GET', `/theme-sets/assets/${THEME_IDS.logo}/content`, 404);

    const response = await GET(request(), params(THEME_IDS.logo));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(
      api.find('GET', `/theme-sets/assets/${THEME_IDS.logo}/content`)?.headers.get('authorization'),
    ).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('asks nothing for an id that is not a theme asset, or without a session', async () => {
    expect((await GET(request(), params('nope'))).status).toBe(401);
    fakeRequest.reset();
    expect((await GET(request(), params(THEME_IDS.logo))).status).toBe(401);
    expect(api.requests).toEqual([]);
  });
});
