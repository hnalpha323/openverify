// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApiClient } from '../../lib/api/client';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { listResource } from '../../testing/lists-fixtures';
import { LIST_CHOICES_MAX, readListChoices } from './list-choices';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['lists:read'] });
});

afterEach(() => {
  api.restore();
});

const id = (index: number) => `lst_01JB${String(index).padStart(22, '0')}`;

describe('readListChoices (C99.5, C106.2): every active list a picker may offer', () => {
  it('reads the active lists page after page, not only the first', async () => {
    const lists = Array.from({ length: 150 }, (_, index) =>
      listResource('email-address', {
        id: id(index + 1),
        name: `Synthetic list ${String(index + 1)}`,
      }),
    );
    api.handle('GET', '/lists', (request) => {
      const after = request.query.get('page[after]');
      const start = after === null ? 0 : lists.findIndex((list) => list.id === after) + 1;
      const page = lists.slice(start, start + 100);
      const last = page.at(-1);
      return {
        status: 200,
        body: {
          data: page,
          links: {
            next:
              start + 100 < lists.length && last !== undefined
                ? // The API's next link keeps the filters.
                  `/api/v1/lists?filter%5Bstatus%5D=active&page%5Bafter%5D=${last.id}&page%5Bsize%5D=100`
                : null,
          },
        },
      };
    });

    const choices = await readListChoices(await getApiClient());

    expect(choices).toHaveLength(150);
    expect(choices[149]).toEqual({
      id: id(150),
      name: 'Synthetic list 150',
      kind: 'email-address',
    });
    const asked = api.all('GET', '/lists');
    expect(asked.every((request) => request.query.get('filter[status]') === 'active')).toBe(true);
  });

  it('stops at the active list cap', () => {
    expect(LIST_CHOICES_MAX).toBe(1000);
  });
});
