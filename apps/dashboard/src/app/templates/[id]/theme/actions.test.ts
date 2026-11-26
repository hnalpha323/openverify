// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { problemDocument } from '../../../../testing/api-mock';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import { LIFECYCLE_IDS, draft } from '../../../../testing/lifecycle-fixtures';
import { COPY_EDITOR, THEME_IDS, VERSION_ETAG } from '../../../../testing/routes/themes-copy';
import { saveTemplateTheme } from './actions';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;
const PATH = `/inquiry-template-versions/${LIFECYCLE_IDS.draft}`;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: COPY_EDITOR });
});

afterEach(() => {
  api.restore();
});

const form = (themeSetId: string) => {
  const data = new FormData();
  data.set('inquiry-template-id', LIFECYCLE_IDS.template);
  data.set('version-id', LIFECYCLE_IDS.draft);
  data.set('etag', VERSION_ETAG);
  data.set('theme-set-id', themeSetId);
  return data;
};

describe('saveTemplateTheme (C160.7, C154.3)', () => {
  it('points the draft at a set with If-Match, or at the environment default with null', async () => {
    api.on('PATCH', PATH, 200, { data: draft() }, { etag: VERSION_ETAG });

    expect((await saveTemplateTheme(null, form(THEME_IDS.set))).ok).toBe(true);
    expect(api.find('PATCH', PATH)?.headers.get('if-match')).toBe(VERSION_ETAG);
    expect(api.find('PATCH', PATH)?.body).toMatchObject({
      data: { attributes: { 'theme-set-id': THEME_IDS.set } },
    });

    await saveTemplateTheme(null, form(''));
    expect(api.find('PATCH', PATH)?.body).toMatchObject({
      data: { attributes: { 'theme-set-id': null } },
    });
  });

  it('says a draft changed meanwhile in words, and refuses a malformed set id', async () => {
    api.on('PATCH', PATH, 412, problemDocument(412, undefined, { code: 'precondition_failed' }));

    const stale = await saveTemplateTheme(null, form(THEME_IDS.set));
    expect(!stale.ok && stale.problem.title).toMatch(/The draft changed/);

    expect((await saveTemplateTheme(null, form('nope'))).ok).toBe(false);
  });

  it('refuses without inquiry-templates:write', async () => {
    api.me({ permissions: ['inquiry-templates:read', 'theme-sets:read'] });

    expect((await saveTemplateTheme(null, form(THEME_IDS.set))).ok).toBe(false);
    expect(api.find('PATCH', PATH)).toBeUndefined();
  });
});
